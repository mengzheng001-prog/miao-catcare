import { ZodError } from "zod";
import { buildReportStructureSystemPrompt, buildReportStructureUserPrompt } from "../prompts/report-structure-prompt";
import { reportParseResultSchema, type ReportParseResult } from "../types/report-schema";

type DoubaoVisionInput = {
  reportId: string;
  filename: string;
  pageImages: string[];
  petNameHint?: string;
};

type DoubaoResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type DoubaoAttemptResult = {
  mode: "real_api" | "mock_fallback";
  result: ReportParseResult | null;
  errorSummary?: string;
  diagnostics: {
    model: string;
    baseUrl: string;
    timeoutMs: number;
    pageImageCount: number;
    promptChars: number;
    requestDurationMs: number;
    sourceType: string;
    schemaValid: boolean;
    fallbackReason?: string;
  };
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function parseIntEnv(value: string | undefined, fallback: number) {
  const parsed = Number(String(value || "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDoubaoConfig() {
  return {
    apiKey: String(process.env.DOUBAO_API_KEY || "").trim(),
    model: String(process.env.DOUBAO_MODEL || "").trim(),
    baseUrl: trimTrailingSlash(process.env.DOUBAO_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"),
    timeoutMs: parseIntEnv(process.env.DOUBAO_TIMEOUT_MS, 180000),
    maxPages: parseIntEnv(process.env.DOUBAO_MAX_PAGES, 20),
  };
}

function logDoubao(event: string, payload: Record<string, any>) {
  if (payload.mode === "mock_fallback" || payload.fallbackReason) {
    console.error(`[doubao-vision] ${event}`, payload);
  } else {
    console.info(`[doubao-vision] ${event}`, payload);
  }
}

function summarizeHttpError(bodyText: string) {
  const compact = String(bodyText || "").replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 200) : "empty_response";
}

function stripJsonComments(text: string): string {
  // 清理 LLM 输出中的非标准 JSON 注释（// 行注释 + /* */ 块注释）
  // 注意：用一遍扫描区分"在字符串内"和"在外面"，避免误伤真实内容里的 //
  let out = "";
  let inString = false;
  let stringQuote = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) {
        // 转义下一个字符整体保留
        out += next;
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }

    // // 行注释：跳到下一个换行
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    // /* ... */ 块注释
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  // 清理末尾多余逗号（如 "},\n}" 或 "],\n]"）
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * 修复 LLM 输出被 max_tokens 截断的 JSON：扫描所有 `{`/`[`/字符串状态，
 * 找到截断之前最后一个安全的"item 闭合 + 数组逗号"位置，截掉残缺部分，
 * 然后用未闭合的栈反向补齐外层 `]` 和 `}`。
 *
 * 适用：豆包返回 finish_reason='length' 时 labs/imaging 数组中途被砍。
 */
function tryRepairTruncatedJson(text: string): string | null {
  let inString = false;
  let escape = false;
  const stack: string[] = []; // 记录已打开但未闭合的 `{` / `[`
  let lastSafeCut = -1; // 截断点：截到此 index 之后（含）应丢弃

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      // 如果当前栈深度 == 1（最外层 { ... }）说明刚关闭了一个顶级字段（如 visitInfo 对象、labs 数组）
      // 如果栈深度 == 2，说明刚关闭了 labs 数组里的一个 item —— 这是最常被截的层
      if (stack.length <= 2) {
        lastSafeCut = i; // 记录这个完整闭合的位置
      }
      continue;
    }
    if (ch === "," && stack.length <= 2) {
      // 数组 / 顶层对象的字段分隔逗号，也是一个安全切点（逗号前是闭合的 item）
      lastSafeCut = i - 1;
    }
  }

  if (lastSafeCut < 0) return null;

  // 截到最后一个安全位置，并按栈反向补齐
  let repaired = text.slice(0, lastSafeCut + 1);

  // 重新扫描截断后的栈状态
  const finalStack: string[] = [];
  let inStr2 = false;
  let esc2 = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (esc2) { esc2 = false; continue; }
    if (inStr2) {
      if (ch === "\\") esc2 = true;
      else if (ch === '"') inStr2 = false;
      continue;
    }
    if (ch === '"') { inStr2 = true; continue; }
    if (ch === "{" || ch === "[") finalStack.push(ch);
    else if (ch === "}" || ch === "]") finalStack.pop();
  }

  // 反向补齐
  while (finalStack.length > 0) {
    const opener = finalStack.pop()!;
    repaired += opener === "{" ? "}" : "]";
  }

  return repaired;
}

function parseMessageContentToJson(content: string) {
  const trimmed = String(content || "").trim();

  // 1. 先去 markdown ``` 围栏
  let candidate = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // 2. 鲁棒切片：从第一个 `{` 开始
  const firstBrace = candidate.indexOf("{");
  if (firstBrace > 0) candidate = candidate.slice(firstBrace);

  // 3. 直接 parse
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to repair attempts */
  }

  // 4. 清理 // 注释 + 尾随逗号
  const cleaned = stripJsonComments(candidate);
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to truncation repair */
  }

  // 5. 尝试修复被 max_tokens 截断的 JSON
  const repaired = tryRepairTruncatedJson(cleaned);
  if (repaired) {
    try {
      const result = JSON.parse(repaired);
      console.warn("[doubao-vision] json_truncation_repaired", {
        originalChars: cleaned.length,
        repairedChars: repaired.length,
      });
      return result;
    } catch {
      /* give up */
    }
  }

  throw new SyntaxError("JSON parse + repair both failed");
}

function clampConfidence(value: any, fallback = 0.5) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace("%", "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed > 1 && parsed <= 100) return Math.max(0, Math.min(1, parsed / 100));
  return Math.max(0, Math.min(1, parsed));
}

function toText(value: any, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function toValue(value: any, fallback = "") {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  return text || fallback;
}

function extractMinMax(range?: string) {
  const text = toText(range);
  if (!text || !text.includes("-")) return { min: "", max: "" };
  const [left, right] = text.split("-").map((p) => p.trim());
  return { min: left || "", max: right || "" };
}

function buildRange(min: any, max: any, range?: any) {
  const explicit = toText(range);
  if (explicit) return explicit;
  return `${toText(min, "-")} - ${toText(max, "-")}`;
}

function normalizeFieldMeta(fieldMeta: any) {
  if (!fieldMeta || typeof fieldMeta !== "object" || Array.isArray(fieldMeta)) return {};
  return Object.fromEntries(
    Object.entries(fieldMeta).map(([key, value]) => {
      const item = value && typeof value === "object" ? value as Record<string, any> : {};
      return [
        key,
        {
          sourcePage: toText(item.sourcePage, "待确认"),
          confidence: clampConfidence(item.confidence, 0.4),
          sourceText: toText(item.sourceText, "待确认"),
        },
      ];
    })
  );
}

function normalizeLabs(labs: any, reportId: string) {
  if (!Array.isArray(labs)) return [];
  return labs.map((lab, index) => {
    const fallbackRange = extractMinMax(toText(lab?.range));
    const min = toValue(lab?.min, fallbackRange.min);
    const max = toValue(lab?.max, fallbackRange.max);
    const code = toText(lab?.code || lab?.name, `LAB_${index + 1}`);
    return {
      id: toText(lab?.id, `${reportId}_lab_${code}_${index + 1}`),
      group: toText(lab?.group, "其他"),
      name: toText(lab?.name, code),
      code,
      value: toValue(lab?.value, ""),
      unit: toText(lab?.unit, ""),
      range: buildRange(min, max, lab?.range),
      min,
      max,
      status: toText(lab?.status, "待确认"),
      sourcePage: toText(lab?.sourcePage, "待确认"),
      reportDate: toText(lab?.reportDate, ""),
      confidence: clampConfidence(lab?.confidence, 0.75),
      checked: lab?.checked !== false,
      error: Boolean(lab?.error),
    };
  });
}

function normalizeImaging(imaging: any, reportId: string) {
  if (!Array.isArray(imaging)) return [];
  return imaging.map((item, index) => ({
    id: toText(item?.id, `${reportId}_imaging_${index + 1}`),
    examType: toText(item?.examType || item?.type, "腹部B超"),
    bodyPart: toText(item?.bodyPart, "待确认"),
    finding: toText(item?.finding, "待确认"),
    impression: toText(item?.impression, "待确认"),
    sourcePage: toText(item?.sourcePage, "待确认"),
    reportDate: toText(item?.reportDate, ""),
  }));
}

function normalizeMedications(medications: any, reportId: string) {
  if (!Array.isArray(medications)) return [];
  return medications.map((med, index) => {
    const drugName = toText(med?.drugName || med?.name, "未命名药物");
    return {
      id: toText(med?.id, `${reportId}_med_${index + 1}`),
      name: toText(med?.name, drugName),
      drugName,
      time: toText(med?.time, "--:--"),
      dosage: toText(med?.dosage, ""),
      frequency: toText(med?.frequency, ""),
      instruction: toText(med?.instruction, ""),
      duration: toText(med?.duration, ""),
      status: "pending",
      sourcePage: toText(med?.sourcePage, "待确认"),
      reportDate: toText(med?.reportDate, ""),
    };
  });
}

function normalizeFollowups(followups: any, reportId: string, reportDate: string, followupText: string) {
  if (Array.isArray(followups) && followups.length > 0) {
    return followups.map((item, index) => ({
      id: toText(item?.id, `${reportId}_followup_${index + 1}`),
      title: toText(item?.title, "复查建议"),
      date: toText(item?.date, reportDate),
      desc: toText(item?.desc, followupText),
      items: Array.isArray(item?.items) ? item.items.map((e: any) => toText(e)).filter(Boolean) : [],
      sourcePage: toText(item?.sourcePage, "待确认"),
    }));
  }
  if (!followupText) return [];
  return [{
    id: `${reportId}_followup_1`,
    title: "复查建议",
    date: reportDate,
    desc: followupText,
    items: [],
    sourcePage: "待确认",
  }];
}

function normalizeWarnings(warnings: any[], canonical: string) {
  const list = (warnings || []).map((w) => toText(w)).filter(Boolean);
  return Array.from(new Set([canonical, ...list]));
}

function buildSafeSummary(result: { visitInfo: any; labs: any[]; imaging: any[]; medications: any[]; followups: any[] }) {
  const v = result.visitInfo;
  const pieces = [
    `已基于豆包多模态识别整理本次${v.visitType || "就诊"}报告`,
    v.reportDate ? `报告日期为 ${v.reportDate}` : "",
    v.hospital ? `医院为 ${v.hospital}` : "",
    `共提取 ${result.labs.length} 项检验指标`,
    result.imaging.length > 0 ? `${result.imaging.length} 条影像摘要` : "",
    result.medications.length > 0 ? `${result.medications.length} 条医嘱处方` : "",
    result.followups.length > 0 ? `${result.followups.length} 条复查建议` : "",
    "请对照 PDF 原文人工确认后再入库",
  ].filter(Boolean);
  return `${pieces.join("，")}。`;
}

function normalizeCandidate(candidate: any, reportId: string, model: string, parseWarning: string): ReportParseResult {
  const visitInfo = candidate?.visitInfo && typeof candidate.visitInfo === "object" ? candidate.visitInfo : {};
  const parseMeta = candidate?.parseMeta && typeof candidate.parseMeta === "object" ? candidate.parseMeta : {};
  const reportDate = toText(visitInfo.reportDate || visitInfo.visitDate, new Date().toISOString().slice(0, 10));
  const chiefComplaint = toText(visitInfo.chiefComplaint || visitInfo.complaint, "");
  const presentIllness = toText(visitInfo.presentIllness || visitInfo.currentIllness || visitInfo.historyOfPresentIllness, "");
  const pastHistory = toText(visitInfo.pastHistory || visitInfo.medicalHistory || visitInfo.history, "");
  const doctorNotes = toText(visitInfo.doctorNotes || visitInfo.notes, "");
  const followupText = toText(visitInfo.followupText, "");

  const baseResult = {
    reportId,
    parseMeta: {
      sourceType: "ocr_real_deepseek" as const,
      needsManualReview: true as const,
      warnings: normalizeWarnings(Array.isArray(parseMeta.warnings) ? parseMeta.warnings : [], parseWarning),
      provider: "doubao_vision",
      model,
      sampleOcrTextName: "doubao_vision_pages",
    },
    fieldMeta: normalizeFieldMeta(candidate?.fieldMeta),
    visitInfo: {
      catName: toText(visitInfo.catName, ""),
      reportDate,
      visitDate: toText(visitInfo.visitDate, reportDate),
      hospital: toText(visitInfo.hospital, ""),
      doctor: toText(visitInfo.doctor, ""),
      visitType: toText(visitInfo.visitType, "其他"),
      chiefComplaint,
      complaint: chiefComplaint,
      presentIllness,
      pastHistory,
      weight: toText(visitInfo.weight, ""),
      temperature: toText(visitInfo.temperature, ""),
      doctorNotes,
      notes: doctorNotes,
      followupText,
      userNotes: "",
      syncToCatProfile: false,
    },
    labs: normalizeLabs(candidate?.labs, reportId),
    imaging: normalizeImaging(candidate?.imaging, reportId),
    medications: normalizeMedications(candidate?.medications, reportId),
    followups: [] as Array<any>,
  };

  const followups = normalizeFollowups(candidate?.followups, reportId, baseResult.visitInfo.reportDate, baseResult.visitInfo.followupText);

  return reportParseResultSchema.parse({
    ...baseResult,
    followups,
    aiSummary: buildSafeSummary({ ...baseResult, followups }),
    updatedAt: new Date().toISOString(),
  });
}

export async function tryStructureScannedPdfWithDoubao(input: DoubaoVisionInput): Promise<DoubaoAttemptResult> {
  const config = getDoubaoConfig();
  const parseWarning = "PDF 由豆包多模态视觉模型识别 + 结构化，请对照原文人工确认。";
  const startedAt = Date.now();

  const baseDiagnostics = {
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    pageImageCount: input.pageImages.length,
    promptChars: 0,
    requestDurationMs: 0,
    sourceType: "mock_backend",
    schemaValid: false as boolean,
    fallbackReason: undefined as string | undefined,
  };

  if (!config.apiKey || !config.model) {
    const reason = !config.apiKey
      ? "DOUBAO_API_KEY 未配置"
      : "DOUBAO_MODEL 未配置（请填 ep-xxx 接入点 ID 或带版本号的 model id）";
    logDoubao("config_missing", { ...baseDiagnostics, mode: "mock_fallback", fallbackReason: reason });
    return { mode: "mock_fallback", result: null, errorSummary: reason, diagnostics: { ...baseDiagnostics, fallbackReason: reason } };
  }

  if (!input.pageImages || input.pageImages.length === 0) {
    const reason = "没有 PDF 页面图片可发送";
    return { mode: "mock_fallback", result: null, errorSummary: reason, diagnostics: { ...baseDiagnostics, fallbackReason: reason } };
  }

  const pages = input.pageImages.slice(0, config.maxPages);
  const pageDropped = input.pageImages.length - pages.length;

  const systemPrompt = buildReportStructureSystemPrompt({
    parseSourceType: "ocr_real_deepseek",
    parseWarning,
    petNameHint: input.petNameHint,
  });

  const userPromptText = buildReportStructureUserPrompt({
    reportId: input.reportId,
    filename: input.filename,
    sampleName: "doubao_vision_pages",
    sampleOcrText: `[图片型 PDF 已转为 ${pages.length} 张图片，每张 image 对应 PDF 的一页，请按顺序识别并整理结构化数据]${pageDropped > 0 ? `（注：原始 PDF 共 ${input.pageImages.length} 页，受限于上下文，仅发送前 ${pages.length} 页）` : ""}`,
    parseSourceType: "ocr_real_deepseek",
    sourceLabel: "豆包多模态识别原文",
    parseWarning,
    petNameHint: input.petNameHint,
  });

  const userContent: any[] = [{ type: "text", text: userPromptText }];
  pages.forEach((b64, idx) => {
    userContent.push({
      type: "image_url",
      image_url: {
        url: b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`,
      },
    });
    if (idx < pages.length - 1) {
      userContent.push({ type: "text", text: `\n[以上为第 ${idx + 1} 页，接下来是第 ${idx + 2} 页]` });
    }
  });

  baseDiagnostics.promptChars = systemPrompt.length + userPromptText.length;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  logDoubao("request_started", { ...baseDiagnostics, mode: "real_api" });

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        max_tokens: 12000,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = summarizeHttpError(await response.text());
      const reason = `豆包请求失败(${response.status}): ${errorText}`;
      const diagnostics = { ...baseDiagnostics, requestDurationMs: Date.now() - startedAt, fallbackReason: reason };
      logDoubao("http_error", { ...diagnostics, mode: "mock_fallback" });
      return { mode: "mock_fallback", result: null, errorSummary: reason, diagnostics };
    }

    const payload = await response.json() as DoubaoResponse;
    const content = payload?.choices?.[0]?.message?.content;
    const finishReason = payload?.choices?.[0]?.finish_reason;
    if (!content || !String(content).trim()) {
      const reason = "豆包返回空内容";
      const diagnostics = { ...baseDiagnostics, requestDurationMs: Date.now() - startedAt, fallbackReason: reason };
      return { mode: "mock_fallback", result: null, errorSummary: reason, diagnostics };
    }

    const contentPreview = String(content).slice(0, 600);
    console.info("[doubao-vision] raw_content_preview", {
      finishReason,
      contentChars: String(content).length,
      contentHead: contentPreview,
      contentTail: String(content).slice(-300),
    });

    let parsed;
    try {
      parsed = parseMessageContentToJson(content);
    } catch (parseErr: any) {
      const reason = `豆包返回内容不是合法 JSON (finishReason=${finishReason || "unknown"}, ${parseErr?.message || "parse failed"})`;
      console.error("[doubao-vision] json_parse_failed", {
        finishReason,
        contentHead: contentPreview,
        parseError: parseErr?.message,
      });
      const diagnostics = { ...baseDiagnostics, requestDurationMs: Date.now() - startedAt, fallbackReason: reason };
      return { mode: "mock_fallback", result: null, errorSummary: reason, diagnostics };
    }
    const result = normalizeCandidate(parsed, input.reportId, config.model, parseWarning);
    const diagnostics = {
      ...baseDiagnostics,
      requestDurationMs: Date.now() - startedAt,
      sourceType: result.parseMeta.sourceType,
      schemaValid: true,
    };
    logDoubao("finished", { ...diagnostics, mode: "real_api" });
    return { mode: "real_api", result, diagnostics };
  } catch (error: any) {
    let reason = "豆包结构化失败";
    if (error instanceof ZodError) reason = "豆包结果未通过 schema 校验";
    else if (error instanceof SyntaxError) reason = "豆包返回内容不是合法 JSON";
    else if (error?.name === "AbortError") reason = "豆包请求超时";
    else if (error?.message) reason = `豆包异常: ${String(error.message).slice(0, 200)}`;

    const diagnostics = { ...baseDiagnostics, requestDurationMs: Date.now() - startedAt, fallbackReason: reason };
    logDoubao("error", { ...diagnostics, mode: "mock_fallback" });
    return { mode: "mock_fallback", result: null, errorSummary: reason, diagnostics };
  } finally {
    clearTimeout(timeout);
  }
}
