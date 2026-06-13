import { ZodError } from "zod";
import { tryStructureSampleOcrWithDeepSeek } from "./deepseek";
import { tryStructureScannedPdfWithDoubao } from "./doubao-vision";
import { extractRawTextWithOcrService, renderPdfImagesWithOcrService } from "./ocr-client";
import { parseJobStatusSchema, reportParseResultSchema, type ParseJobStatus, type ReportParseResult } from "../types/report-schema";

type ParseJob = {
  jobId: string;
  reportId: string;
  filename: string;
  fileSizeBytes: number;
  fileBuffer?: Buffer;
  clientRawText?: string;
  petNameHint?: string;
  pageImages?: string[];
  createdAt: number;
  result: ReportParseResult;
  resolvedAt?: number;
};

const jobs = new Map<string, ParseJob>();

const STATUS_TIMELINE: Array<{ afterMs: number; status: ParseJobStatus }> = [
  { afterMs: 0, status: "uploaded" },
  { afterMs: 400, status: "rasterizing" },
  { afterMs: 900, status: "ocr_running" },
  { afterMs: 1400, status: "llm_running" },
  { afterMs: 1900, status: "validating" },
];

function now() {
  return Date.now();
}

function createJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function inferReportDateFromFilename(filename: string) {
  const match = String(filename || "").match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (!match) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function inferVisitTypeFromFilename(filename: string) {
  const normalized = String(filename || "").toLowerCase();
  if (normalized.includes("初诊")) return "初诊";
  if (normalized.includes("复查") || normalized.includes("复诊")) return "复诊";
  if (normalized.includes("体检")) return "体检";
  if (normalized.includes("急诊")) return "急诊";
  if (normalized.includes("b超") || normalized.includes("尿检") || normalized.includes("生化") || normalized.includes("检查")) return "检查";
  return "其他";
}

function buildMockWarnings(extraWarnings: string[] = []) {
  return Array.from(new Set([
    "AI 服务未配置（DeepSeek Key 缺失 或 OCR 服务不可用）",
    "本次未对 PDF 内容进行任何 AI 识别，请按 PDF 原文手动录入",
    ...extraWarnings.filter(Boolean),
  ]));
}

/**
 * mock_fallback 模式：返回空白模板（不再无中生有给固定示例数据）。
 * 用户上传任意 PDF，都返回空候选 + 明显警告，提示按 PDF 原文手动录入。
 * 这是诚实的产品行为：没有真实 AI 解析能力时不假装有结果。
 */
function buildMockResult(reportId: string, filename: string, extraWarnings: string[] = []): ReportParseResult {
  const reportDate = inferReportDateFromFilename(filename);
  const visitType = inferVisitTypeFromFilename(filename);

  const result = {
    reportId,
    parseMeta: {
      sourceType: "mock_backend" as const,
      needsManualReview: true as const,
      warnings: buildMockWarnings(extraWarnings),
    },
    fieldMeta: {
      reportDate: { sourcePage: "文件名", confidence: 0.4, sourceText: `根据文件名推断报告日期：${reportDate}` },
      visitType: { sourcePage: "文件名", confidence: 0.35, sourceText: `根据文件名推断就诊类型：${visitType}` },
      hospital: { sourcePage: "未识别", confidence: 0, sourceText: "AI 未识别医院字段，请手动录入" },
      doctor: { sourcePage: "未识别", confidence: 0, sourceText: "AI 未识别医生字段，请手动录入" },
      chiefComplaint: { sourcePage: "未识别", confidence: 0, sourceText: "AI 未识别主诉字段，请手动录入" },
    },
    visitInfo: {
      catName: "",
      reportDate,
      visitDate: reportDate,
      hospital: "",
      doctor: "",
      visitType,
      chiefComplaint: "",
      complaint: "",
      weight: "",
      temperature: "",
      doctorNotes: "",
      notes: "",
      followupText: "",
      userNotes: "",
      syncToCatProfile: false,
    },
    // 空白：让用户按 PDF 原文手动录入
    labs: [],
    imaging: [],
    medications: [],
    followups: [],
    aiSummary:
      "AI 服务未配置（DeepSeek API Key 缺失，或 OCR 服务不可用）。系统未对本份 PDF 进行任何 AI 识别。\n" +
      "请打开左侧 PDF 原文，按需手动录入：检验指标、影像所见、医嘱处方、复查建议。\n" +
      "如需启用真实 AI 解析，请在 .env.local 配置 DEEPSEEK_API_KEY 并启动 Python OCR 服务后重启。",
    updatedAt: new Date().toISOString(),
  };

  return reportParseResultSchema.parse(result);
}

function computeStatus(job: ParseJob): ParseJobStatus {
  const createdAt = job.createdAt;
  const elapsed = now() - createdAt;
  let currentStatus: ParseJobStatus = "uploaded";

  for (const step of STATUS_TIMELINE) {
    if (elapsed >= step.afterMs) {
      currentStatus = step.status;
    }
  }

  if (elapsed >= 2400) {
    currentStatus = job.resolvedAt ? "ready" : "validating";
  }

  return parseJobStatusSchema.parse(currentStatus);
}

function resolveJob(job: ParseJob, result: ReportParseResult) {
  job.result = result;
  job.resolvedAt = now();
  job.fileBuffer = undefined;
}

// 文本型 PDF 至少应抽到 ~300 字符；少于此值大概率是扫描件元数据噪音（仅含表单字段名 / 页码 / 时间戳），
// 应转走豆包多模态而非把噪音喂给 DeepSeek 让它"无中生有"。
const MIN_RAW_TEXT_CHARS_FOR_DEEPSEEK = 300;

async function hydrateJobResult(job: ParseJob) {
  // 优先级 1：前端 pdfjs 已抽出"足够长"的 rawText（文本型 PDF）—— 直接喂给 DeepSeek
  const clientRawText = (job.clientRawText || "").trim();
  const pageImages = (job.pageImages || []).filter((s) => typeof s === "string" && s.length > 0);
  const hasMeaningfulText = clientRawText.length >= MIN_RAW_TEXT_CHARS_FOR_DEEPSEEK;
  const hasPageImages = pageImages.length > 0;

  if (hasMeaningfulText && !hasPageImages) {
    console.info("[report-parse] using client-side pdfjs rawText", {
      jobId: job.jobId,
      reportId: job.reportId,
      rawTextChars: clientRawText.length,
    });
    const deepSeekAttempt = await tryStructureSampleOcrWithDeepSeek({
      reportId: job.reportId,
      filename: job.filename,
      rawTextOverride: clientRawText,
      sampleNameOverride: "client_pdfjs_raw_text",
      promptSourceModeOverride: "ocr_real",
      parseSourceTypeOverride: "ocr_real_deepseek",
      parseWarningOverride: "PDF 原文由前端 pdfjs 抽取 + DeepSeek 结构化，请对照原文人工确认。",
      providerOverride: "client_pdfjs",
      petNameHint: job.petNameHint,
    });
    if (deepSeekAttempt.result) {
      console.info("[report-parse] resolved structured result via client rawText", {
        jobId: job.jobId,
        reportId: job.reportId,
        mode: deepSeekAttempt.mode,
        sourceType: deepSeekAttempt.result.parseMeta.sourceType,
      });
      resolveJob(job, deepSeekAttempt.result);
      return;
    }
    console.info("[report-parse] client rawText but DeepSeek failed", {
      jobId: job.jobId,
      reportId: job.reportId,
      error: deepSeekAttempt.errorSummary,
    });
    resolveJob(job, buildMockResult(job.reportId, job.filename, [deepSeekAttempt.errorSummary || "DeepSeek 结构化失败"]));
    return;
  }

  // 优先级 2：扫描件 / 伪文本型 PDF —— PaddleOCR 抽全文 → DeepSeek 结构化（主路径）
  // 信息完整度 > 豆包 vision（不会被 12k token 截断），成本约 1/40
  const ocrAttempt = job.fileBuffer
    ? await extractRawTextWithOcrService({
        filename: job.filename,
        fileBuffer: job.fileBuffer,
      })
    : null;

  if (ocrAttempt?.ok && ocrAttempt.data?.rawText && ocrAttempt.data.sourceType === "ocr_real") {
    console.info("[report-parse] ocr service returned rawText (PaddleOCR)", {
      jobId: job.jobId,
      reportId: job.reportId,
      provider: ocrAttempt.diagnostics.provider,
      rawTextChars: ocrAttempt.diagnostics.rawTextChars,
      pageCount: ocrAttempt.diagnostics.pageCount,
      reasonHint: hasMeaningfulText ? "client_text_too_short" : "no_client_text",
    });

    const deepSeekAttempt = await tryStructureSampleOcrWithDeepSeek({
      reportId: job.reportId,
      filename: job.filename,
      rawTextOverride: ocrAttempt.data.rawText,
      sampleNameOverride: "ocr_real_raw_text",
      promptSourceModeOverride: "ocr_real",
      parseSourceTypeOverride: "ocr_real_deepseek",
      parseWarningOverride: "PDF 原文由 PaddleOCR 抽取 + DeepSeek 结构化，请对照 PDF 原文人工确认。",
      providerOverride: "ocr_real",
      petNameHint: job.petNameHint,
    });

    if (deepSeekAttempt.result) {
      console.info("[report-parse] resolved structured result", {
        jobId: job.jobId,
        reportId: job.reportId,
        mode: deepSeekAttempt.mode,
        sourceType: deepSeekAttempt.result.parseMeta.sourceType,
      });
      resolveJob(job, deepSeekAttempt.result);
      return;
    }

    resolveJob(job, buildMockResult(job.reportId, job.filename, [deepSeekAttempt.errorSummary || "DeepSeek 结构化失败"]));
    return;
  }

  // 优先级 3：PaddleOCR 失败或返回空文本 —— 后端 PyMuPDF 按需渲染页面图，再兜底走豆包多模态。
  let visionPageImages = pageImages;
  if (!hasPageImages && job.fileBuffer) {
    const renderAttempt = await renderPdfImagesWithOcrService({
      filename: job.filename,
      fileBuffer: job.fileBuffer,
    });
    if (renderAttempt.ok) {
      visionPageImages = renderAttempt.images;
    }
  }

  if (visionPageImages.length > 0) {
    console.info("[report-parse] fallback to doubao vision", {
      jobId: job.jobId,
      reportId: job.reportId,
      pageImageCount: visionPageImages.length,
      ocrFailReason: ocrAttempt?.diagnostics?.fallbackReason || "ocr returned empty",
    });
    const doubaoAttempt = await tryStructureScannedPdfWithDoubao({
      reportId: job.reportId,
      filename: job.filename,
      pageImages: visionPageImages,
      petNameHint: job.petNameHint,
    });
    if (doubaoAttempt.result) {
      console.info("[report-parse] resolved structured result via doubao vision (fallback)", {
        jobId: job.jobId,
        reportId: job.reportId,
        mode: doubaoAttempt.mode,
        sourceType: doubaoAttempt.result.parseMeta.sourceType,
        durationMs: doubaoAttempt.diagnostics.requestDurationMs,
      });
      resolveJob(job, doubaoAttempt.result);
      return;
    }
    resolveJob(job, buildMockResult(job.reportId, job.filename, [
      "PaddleOCR + 豆包多模态都失败",
      doubaoAttempt.errorSummary || "豆包多模态结构化失败",
    ]));
    return;
  }

  // 兜底：完全没法处理 —— 空模板 + 明确提示
  const reasons: string[] = [];
  if (!ocrAttempt) {
    reasons.push("缺少 PDF 文件内容，无法调用 OCR 服务");
  } else if (!ocrAttempt.ok) {
    reasons.push(ocrAttempt.diagnostics.fallbackReason || "OCR 服务不可用");
  } else {
    reasons.push("PDF 中没有可抽取的文本（OCR 未识别 + 后端视觉渲染不可用）");
  }
  reasons.push("请检查 PaddleOCR service (5005) 是否启动；复杂扫描件将尝试后端 PyMuPDF 渲染 + 豆包视觉兜底");

  console.info("[report-parse] resolved mock fallback (no rawText available)", {
    jobId: job.jobId,
    reportId: job.reportId,
    reasons,
  });

  resolveJob(job, buildMockResult(job.reportId, job.filename, reasons));
}

export function createParseJob(input: { reportId: string; filename: string; fileSizeBytes: number; fileBuffer?: Buffer; clientRawText?: string; petNameHint?: string; pageImages?: string[] }) {
  const jobId = createJobId();
  let result: ReportParseResult;

  try {
    result = buildMockResult(input.reportId, input.filename);
  } catch (error) {
    if (error instanceof ZodError) {
      (error as any).jobId = jobId;
      (error as any).reportId = input.reportId;
      console.error("[report-parse] failed to build mock parse result", {
        jobId,
        reportId: input.reportId,
        issues: error.issues,
      });
    }
    throw error;
  }

  const job: ParseJob = {
    jobId,
    reportId: input.reportId,
    filename: input.filename,
    fileSizeBytes: input.fileSizeBytes,
    fileBuffer: input.fileBuffer,
    clientRawText: input.clientRawText,
    petNameHint: input.petNameHint,
    pageImages: input.pageImages,
    createdAt: now(),
    result,
    resolvedAt: undefined,
  };

  jobs.set(jobId, job);
  void hydrateJobResult(job).catch((error) => {
    console.error("[report-parse] background structure failed", {
      jobId: job.jobId,
      reportId: job.reportId,
      error,
    });
    try {
      resolveJob(
        job,
        buildMockResult(job.reportId, job.filename, ["DeepSeek 结构化失败，已回退到 mock_backend 结果"])
      );
    } catch (fallbackError) {
      console.error("[report-parse] fallback mock build failed", {
        jobId: job.jobId,
        reportId: job.reportId,
        error: fallbackError,
      });
    }
  });
  return job;
}

export function getParseJob(jobId: string) {
  return jobs.get(jobId) || null;
}

export function getParseJobState(jobId: string) {
  const job = getParseJob(jobId);
  if (!job) return null;

  return {
    jobId: job.jobId,
    reportId: job.reportId,
    filename: job.filename,
    status: computeStatus(job),
  };
}

export function getParseJobResult(jobId: string) {
  const job = getParseJob(jobId);
  if (!job) return null;
  return job.result;
}
