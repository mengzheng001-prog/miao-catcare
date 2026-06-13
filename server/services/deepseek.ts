import { ZodError } from "zod";
import { buildReportStructureSystemPrompt, buildReportStructureUserPrompt } from "../prompts/report-structure-prompt";
import { getSampleOcrText, normalizeSampleMode, type DeepSeekSampleMode } from "./sample-ocr-text";
import { reportParseResultSchema, type ReportParseResult } from "../types/report-schema";

type PromptSourceMode = DeepSeekSampleMode | "ocr_stub" | "ocr_real";

type DeepSeekInput = {
  reportId: string;
  filename: string;
  forceSampleMode?: DeepSeekSampleMode;
  rawTextOverride?: string;
  sampleNameOverride?: string;
  promptSourceModeOverride?: PromptSourceMode;
  parseSourceTypeOverride?: "deepseek_sample_ocr" | "ocr_stub_deepseek" | "ocr_real_deepseek";
  parseWarningOverride?: string;
  providerOverride?: string;
  petNameHint?: string;
};

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
};

export type DeepSeekAttemptMode = "stub" | "real_api" | "mock_fallback";

export type DeepSeekDiagnostics = {
  mode: DeepSeekAttemptMode;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  sampleMode: PromptSourceMode;
  sampleName: string;
  rawTextChars: number;
  promptChars: number;
  requestDurationMs: number;
  sourceType: string;
  schemaValid: boolean;
  fallbackReason?: string;
};

export type DeepSeekAttemptResult = {
  mode: DeepSeekAttemptMode;
  result: ReportParseResult | null;
  errorSummary?: string;
  diagnostics: DeepSeekDiagnostics;
};

type DeepSeekRuntimeConfig = {
  apiKey: string;
  useStub: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  sampleMode: DeepSeekSampleMode;
};

type PromptContext = {
  sampleMode: PromptSourceMode;
  sampleName: string;
  sampleOcrText: string;
  systemPrompt: string;
  userPrompt: string;
  promptChars: number;
  rawTextChars: number;
  parseSourceType: "deepseek_sample_ocr" | "ocr_stub_deepseek" | "ocr_real_deepseek";
  parseWarning: string;
  providerLabel: string;
  sourceLabel: string;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function envFlag(name: string) {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

function parseTimeoutMs(value?: string) {
  const parsed = Number(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 120000;
  }
  return parsed;
}

function getRuntimeConfig(forceSampleMode?: DeepSeekSampleMode): DeepSeekRuntimeConfig {
  return {
    apiKey: String(process.env.DEEPSEEK_API_KEY || "").trim(),
    useStub: envFlag("DEEPSEEK_USE_STUB"),
    baseUrl: trimTrailingSlash(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"),
    model: String(process.env.DEEPSEEK_MODEL || "deepseek-chat").trim() || "deepseek-chat",
    timeoutMs: parseTimeoutMs(process.env.DEEPSEEK_TIMEOUT_MS),
    sampleMode: forceSampleMode || normalizeSampleMode(process.env.DEEPSEEK_SAMPLE_MODE),
  };
}

function getSourcePresentation(parseSourceType: "deepseek_sample_ocr" | "ocr_stub_deepseek" | "ocr_real_deepseek") {
  if (parseSourceType === "ocr_stub_deepseek") {
    return {
      sourceLabel: "OCR skeleton 模拟文本",
      parseWarning: "当前为 OCR skeleton 模拟文本 + DeepSeek 结构化结果，请对照 PDF 原文人工确认。",
      summaryLead: "已基于 OCR skeleton 模拟文本整理本次",
    };
  }

  if (parseSourceType === "ocr_real_deepseek") {
    return {
      sourceLabel: "真实 OCR 文本",
      parseWarning: "当前为真实 OCR 文本 + DeepSeek 结构化结果，请对照 PDF 原文人工确认。",
      summaryLead: "已基于真实 OCR 文本整理本次",
    };
  }

  return {
    sourceLabel: "sample OCR text",
    parseWarning: "当前为 sample OCR text + DeepSeek 结构化结果，请对照PDF原文人工确认。",
    summaryLead: "已基于 sample OCR text 整理本次",
  };
}

function buildPromptContext(input: DeepSeekInput, config: DeepSeekRuntimeConfig): PromptContext {
  const parseSourceType = input.parseSourceTypeOverride || "deepseek_sample_ocr";
  const sourcePresentation = getSourcePresentation(parseSourceType);
  const sample = input.rawTextOverride
    ? {
        sampleMode: input.promptSourceModeOverride || "ocr_stub",
        sampleName: input.sampleNameOverride || "ocr_stub_raw_text",
        rawText: input.rawTextOverride,
      }
    : getSampleOcrText(input.filename, config.sampleMode);
  const parseWarning = input.parseWarningOverride || sourcePresentation.parseWarning;
  const systemPrompt = buildReportStructureSystemPrompt({
    parseSourceType,
    parseWarning,
    petNameHint: input.petNameHint,
  });
  const userPrompt = buildReportStructureUserPrompt({
    reportId: input.reportId,
    filename: input.filename,
    sampleName: sample.sampleName,
    sampleOcrText: sample.rawText,
    parseSourceType,
    sourceLabel: sourcePresentation.sourceLabel,
    parseWarning,
    petNameHint: input.petNameHint,
  });

  return {
    sampleMode: sample.sampleMode,
    sampleName: sample.sampleName,
    sampleOcrText: sample.rawText,
    systemPrompt,
    userPrompt,
    promptChars: systemPrompt.length + userPrompt.length,
    rawTextChars: sample.rawText.length,
    parseSourceType,
    parseWarning,
    providerLabel: input.providerOverride || (sample.sampleMode === "ocr_stub" ? "ocr_stub" : "sample_ocr_text"),
    sourceLabel: sourcePresentation.sourceLabel,
  };
}

function createDiagnostics(
  mode: DeepSeekAttemptMode,
  config: DeepSeekRuntimeConfig,
  prompt: PromptContext,
  overrides: Partial<DeepSeekDiagnostics> = {}
): DeepSeekDiagnostics {
  return {
    mode,
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    sampleMode: prompt.sampleMode,
    sampleName: prompt.sampleName,
    rawTextChars: prompt.rawTextChars,
    promptChars: prompt.promptChars,
    requestDurationMs: 0,
    sourceType: "mock_backend",
    schemaValid: false,
    ...overrides,
  };
}

function logDeepSeek(event: string, diagnostics: DeepSeekDiagnostics, extra: Record<string, any> = {}) {
  const payload = {
    mode: diagnostics.mode,
    model: diagnostics.model,
    baseUrl: diagnostics.baseUrl,
    timeoutMs: diagnostics.timeoutMs,
    sampleMode: diagnostics.sampleMode,
    sampleName: diagnostics.sampleName,
    rawTextChars: diagnostics.rawTextChars,
    promptChars: diagnostics.promptChars,
    requestDurationMs: diagnostics.requestDurationMs,
    sourceType: diagnostics.sourceType,
    schemaValid: diagnostics.schemaValid,
    fallbackReason: diagnostics.fallbackReason,
    ...extra,
  };

  if (diagnostics.mode === "mock_fallback" || diagnostics.fallbackReason) {
    console.error(`[deepseek] ${event}`, payload);
    return;
  }

  console.info(`[deepseek] ${event}`, payload);
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
  if (!text || !text.includes("-")) {
    return { min: "", max: "" };
  }

  const [left, right] = text.split("-").map((part) => part.trim());
  return {
    min: left || "",
    max: right || "",
  };
}

function buildRange(min: any, max: any, range?: any) {
  const explicitRange = toText(range);
  if (explicitRange) return explicitRange;
  return `${toText(min, "-")} - ${toText(max, "-")}`;
}

function buildSafeSummary(result: Omit<ReportParseResult, "aiSummary" | "updatedAt">) {
  const visitInfo = result.visitInfo;
  const summaryLead = getSourcePresentation(
    result.parseMeta.sourceType === "ocr_stub_deepseek"
      ? "ocr_stub_deepseek"
      : result.parseMeta.sourceType === "ocr_real_deepseek"
        ? "ocr_real_deepseek"
        : "deepseek_sample_ocr"
  ).summaryLead;
  const pieces = [
    `${summaryLead}${visitInfo.visitType || "就诊"}报告`,
    visitInfo.reportDate ? `报告日期为 ${visitInfo.reportDate}` : "",
    visitInfo.hospital && visitInfo.hospital !== "待确认" ? `医院为 ${visitInfo.hospital}` : "",
    `共提取 ${result.labs.length} 项检验指标`,
    result.imaging.length > 0 ? `${result.imaging.length} 条影像摘要` : "",
    result.medications.length > 0 ? `${result.medications.length} 条医嘱处方` : "",
    result.followups.length > 0 ? `${result.followups.length} 条复查建议` : "",
    "请对照 PDF 原文人工确认后再入库",
  ].filter(Boolean);

  return `${pieces.join("，")}。`;
}

function normalizeWarningsBySourceType(
  warnings: string[],
  parseSourceType: "deepseek_sample_ocr" | "ocr_stub_deepseek" | "ocr_real_deepseek",
  canonicalWarning: string
) {
  const normalized = warnings
    .map((entry) => toText(entry))
    .filter(Boolean)
    .map((entry) => {
      if (parseSourceType === "ocr_stub_deepseek" || parseSourceType === "ocr_real_deepseek") {
        if (/sample OCR text|sample OCR|基于 sample OCR text/u.test(entry)) {
          return canonicalWarning;
        }
      }
      return entry;
    });

  return Array.from(new Set([canonicalWarning, ...normalized]));
}

function normalizeFieldMeta(fieldMeta: any) {
  if (!fieldMeta || typeof fieldMeta !== "object" || Array.isArray(fieldMeta)) {
    return {};
  }

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
      items: Array.isArray(item?.items) ? item.items.map((entry: any) => toText(entry)).filter(Boolean) : [],
      sourcePage: toText(item?.sourcePage, "待确认"),
    }));
  }

  if (!followupText) {
    return [];
  }

  return [{
    id: `${reportId}_followup_1`,
    title: "复查建议",
    date: reportDate,
    desc: followupText,
    items: [],
    sourcePage: "待确认",
  }];
}

function normalizeDeepSeekCandidate(
  candidate: any,
  reportId: string,
  provider: string,
  model: string,
  sampleName: string,
  prompt: PromptContext
) {
  const visitInfo = candidate?.visitInfo && typeof candidate.visitInfo === "object" ? candidate.visitInfo : {};
  const parseMeta = candidate?.parseMeta && typeof candidate.parseMeta === "object" ? candidate.parseMeta : {};
  const reportDate = toText(visitInfo.reportDate || visitInfo.visitDate, "待确认");
  const chiefComplaint = toText(visitInfo.chiefComplaint || visitInfo.complaint, "请根据PDF原文补充");
  const presentIllness = toText(visitInfo.presentIllness || visitInfo.currentIllness || visitInfo.historyOfPresentIllness, "");
  const pastHistory = toText(visitInfo.pastHistory || visitInfo.medicalHistory || visitInfo.history, "");
  const doctorNotes = toText(visitInfo.doctorNotes || visitInfo.notes, "请根据PDF原文补充");
  const followupText = toText(visitInfo.followupText, "");

  const baseResult = {
    reportId,
    parseMeta: {
      sourceType: prompt.parseSourceType,
      needsManualReview: true as const,
      warnings: normalizeWarningsBySourceType(
        (Array.isArray(parseMeta.warnings) ? parseMeta.warnings : []).map((entry: any) => toText(entry)).filter(Boolean),
        prompt.parseSourceType,
        prompt.parseWarning
      ),
      provider:
        prompt.providerLabel === "ocr_stub"
          ? "ocr_stub_deepseek"
          : prompt.providerLabel === "ocr_real"
            ? "ocr_real_deepseek"
            : provider,
      model,
      sampleOcrTextName: sampleName,
    },
    fieldMeta: normalizeFieldMeta(candidate?.fieldMeta),
    visitInfo: {
      catName: toText(visitInfo.catName, "未命名宠物"),
      reportDate,
      visitDate: toText(visitInfo.visitDate, reportDate),
      hospital: toText(visitInfo.hospital, "待确认"),
      doctor: toText(visitInfo.doctor, "待确认"),
      visitType: toText(visitInfo.visitType, "其他"),
      chiefComplaint,
      complaint: chiefComplaint,
      presentIllness,
      pastHistory,
      weight: toText(visitInfo.weight, ""),
      temperature: toText(visitInfo.temperature, ""),
      doctorNotes,
      notes: doctorNotes,
      followupText: followupText || "请根据PDF原文补充复查日期和复查项目",
      userNotes: "",
      syncToCatProfile: false,
    },
    labs: normalizeLabs(candidate?.labs, reportId),
    imaging: normalizeImaging(candidate?.imaging, reportId),
    medications: normalizeMedications(candidate?.medications, reportId),
    followups: [] as Array<any>,
  };

  const followups = normalizeFollowups(
    candidate?.followups,
    reportId,
    baseResult.visitInfo.reportDate,
    baseResult.visitInfo.followupText
  );

  return reportParseResultSchema.parse({
    ...baseResult,
    followups,
    aiSummary: buildSafeSummary({
      ...baseResult,
      followups,
    }),
    updatedAt: new Date().toISOString(),
  });
}

function parseMessageContentToJson(content: string) {
  const trimmed = String(content || "").trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(withoutFence);
}

function buildShortStubCandidate(reportId: string) {
  return {
    reportId,
    parseMeta: {
      sourceType: "deepseek_sample_ocr",
      needsManualReview: true,
      warnings: [
        "当前为 sample OCR text + DeepSeek 结构化结果，请对照PDF原文人工确认",
        "当前使用本地 DeepSeek stub 结果，仅用于联调验证",
      ],
    },
    fieldMeta: {
      reportDate: {
        sourcePage: "第1页",
        confidence: 0.92,
        sourceText: "报告日期：2026-04-20",
      },
      hospital: {
        sourcePage: "第1页",
        confidence: 0.9,
        sourceText: "华城宠物诊疗中心",
      },
      catName: {
        sourcePage: "第1页",
        confidence: 0.9,
        sourceText: "宠物姓名：豆咪",
      },
    },
    visitInfo: {
      catName: "示例宠物",
      reportDate: "2026-04-20",
      visitDate: "2026-04-20",
      hospital: "华城宠物诊疗中心",
      doctor: "待确认",
      visitType: "复诊",
      chiefComplaint: "请根据PDF原文补充",
      complaint: "请根据PDF原文补充",
      weight: "",
      temperature: "",
      doctorNotes: "请根据PDF原文补充",
      notes: "请根据PDF原文补充",
      followupText: "2026-04-29 复查血常规。",
      userNotes: "",
      syncToCatProfile: false,
    },
    labs: [
      {
        id: `${reportId}_lab_WBC_1`,
        group: "血常规",
        name: "白细胞",
        code: "WBC",
        value: "16.2",
        unit: "10^9/L",
        range: "5.5 - 19.5",
        min: "5.5",
        max: "19.5",
        status: "正常",
        sourcePage: "第1页",
        confidence: 0.95,
        checked: true,
        error: false,
      },
    ],
    imaging: [],
    medications: [
      {
        id: `${reportId}_med_1`,
        name: "速诺 50mg",
        drugName: "速诺 50mg",
        time: "08:00",
        dosage: "一次1片",
        frequency: "一日2次",
        instruction: "饭后",
        duration: "连续7天",
        status: "pending",
        sourcePage: "第1页",
      },
    ],
    followups: [
      {
        id: `${reportId}_followup_1`,
        title: "复查建议",
        date: "2026-04-29",
        desc: "2026-04-29 复查血常规。",
        items: ["血常规"],
        sourcePage: "第1页",
      },
    ],
    aiSummary: "结构化摘要，仅供人工确认，不含诊断建议。",
  };
}

function buildFullStubCandidate(reportId: string, infectious: boolean) {
  const labs = [
    {
      id: `${reportId}_lab_WBC_1`,
      group: "血常规",
      name: "白细胞",
      code: "WBC",
      value: "16.2",
      unit: "10^9/L",
      range: "5.5 - 19.5",
      min: "5.5",
      max: "19.5",
      status: "正常",
      sourcePage: "第2页",
      confidence: 0.95,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_RBC_2`,
      group: "血常规",
      name: "红细胞",
      code: "RBC",
      value: "5.1",
      unit: "10^12/L",
      range: "6.5 - 10.0",
      min: "6.5",
      max: "10.0",
      status: "偏低",
      sourcePage: "第2页",
      confidence: 0.94,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_HGB_3`,
      group: "血常规",
      name: "血红蛋白",
      code: "HGB",
      value: "83",
      unit: "g/L",
      range: "93 - 153",
      min: "93",
      max: "153",
      status: "偏低",
      sourcePage: "第2页",
      confidence: 0.95,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_HCT_4`,
      group: "血常规",
      name: "红细胞压积",
      code: "HCT",
      value: "27",
      unit: "%",
      range: "30 - 45",
      min: "30",
      max: "45",
      status: "偏低",
      sourcePage: "第2页",
      confidence: 0.94,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_PLT_5`,
      group: "血常规",
      name: "血小板",
      code: "PLT",
      value: "410",
      unit: "10^9/L",
      range: "300 - 800",
      min: "300",
      max: "800",
      status: "正常",
      sourcePage: "第2页",
      confidence: 0.97,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_CREA_6`,
      group: "生化",
      name: "肌酐",
      code: "CREA",
      value: "190",
      unit: "umol/L",
      range: "70 - 165",
      min: "70",
      max: "165",
      status: "偏高",
      sourcePage: "第3页",
      confidence: 0.94,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_BUN_7`,
      group: "生化",
      name: "尿素氮",
      code: "BUN",
      value: "13",
      unit: "mmol/L",
      range: "5.7 - 12.9",
      min: "5.7",
      max: "12.9",
      status: "偏高",
      sourcePage: "第3页",
      confidence: 0.93,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_ALT_8`,
      group: "生化",
      name: "谷丙转氨酶",
      code: "ALT",
      value: "82",
      unit: "U/L",
      range: "12 - 130",
      min: "12",
      max: "130",
      status: "正常",
      sourcePage: "第3页",
      confidence: 0.94,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_USG_9`,
      group: "尿检",
      name: "尿比重",
      code: "USG",
      value: "1.016",
      unit: "",
      range: ">1.035 - -",
      min: ">1.035",
      max: "-",
      status: "偏低",
      sourcePage: "第3页",
      confidence: 0.9,
      checked: true,
      error: false,
    },
    {
      id: `${reportId}_lab_PRO_10`,
      group: "尿检",
      name: "尿蛋白",
      code: "PRO",
      value: "弱阳性",
      unit: "",
      range: "阴性 - -",
      min: "阴性",
      max: "-",
      status: "异常",
      sourcePage: "第3页",
      confidence: 0.89,
      checked: true,
      error: false,
    },
  ];

  if (infectious) {
    labs.push(
      {
        id: `${reportId}_lab_FIV_11`,
        group: "传染病",
        name: "猫艾滋",
        code: "FIV",
        value: "阴性",
        unit: "",
        range: "- - -",
        min: "-",
        max: "-",
        status: "阴性",
        sourcePage: "第6页",
        confidence: 0.97,
        checked: true,
        error: false,
      },
      {
        id: `${reportId}_lab_FeLV_12`,
        group: "传染病",
        name: "猫白血病",
        code: "FeLV",
        value: "阴性",
        unit: "",
        range: "- - -",
        min: "-",
        max: "-",
        status: "阴性",
        sourcePage: "第6页",
        confidence: 0.97,
        checked: true,
        error: false,
      }
    );
  }

  return {
    reportId,
    parseMeta: {
      sourceType: "deepseek_sample_ocr",
      needsManualReview: true,
      warnings: [
        "当前为 sample OCR text + DeepSeek 结构化结果，请对照PDF原文人工确认",
        "当前使用本地 DeepSeek stub 结果，仅用于联调验证",
      ],
    },
    fieldMeta: {
      reportDate: {
        sourcePage: "第1页",
        confidence: 0.92,
        sourceText: "报告日期：2026-04-20",
      },
      hospital: {
        sourcePage: "第1页",
        confidence: 0.9,
        sourceText: "华城宠物诊疗中心",
      },
      doctor: {
        sourcePage: "第1页",
        confidence: 0.87,
        sourceText: "主诊医生：李医生",
      },
      chiefComplaint: {
        sourcePage: "第1页",
        confidence: 0.85,
        sourceText: "主诉：复查血常规、生化及尿检，评估贫血与肾功能相关指标变化，近期饮水偏多。",
      },
      visitType: {
        sourcePage: "第1页",
        confidence: 0.88,
        sourceText: "就诊类型：复诊",
      },
    },
    visitInfo: {
      catName: "示例宠物",
      reportDate: "2026-04-20",
      visitDate: "2026-04-20",
      hospital: "华城宠物诊疗中心",
      doctor: "李医生",
      visitType: "复诊",
      chiefComplaint: "复查血常规、生化及尿检，评估贫血与肾功能相关指标变化，近期饮水偏多。",
      complaint: "复查血常规、生化及尿检，评估贫血与肾功能相关指标变化，近期饮水偏多。",
      weight: "3.10 kg",
      temperature: "38.4℃",
      doctorNotes: "继续按时服药，观察食欲、饮水和排尿情况。",
      notes: "继续按时服药，观察食欲、饮水和排尿情况。",
      followupText: "2026-04-29 复查血常规、生化、尿检。",
      userNotes: "",
      syncToCatProfile: false,
    },
    labs,
    imaging: [
      {
        id: `${reportId}_imaging_1`,
        examType: "腹部B超",
        bodyPart: "肾脏、膀胱、腹腔",
        finding: "双肾回声改变，膀胱壁轻度增厚。",
        impression: "建议结合肾功能指标、尿检结果进一步评估。",
        sourcePage: "第4页",
      },
    ],
    medications: [
      {
        id: `${reportId}_med_1`,
        name: "速诺 50mg",
        drugName: "速诺 50mg",
        time: "08:00",
        dosage: "一次1片",
        frequency: "一日2次",
        instruction: "饭后",
        duration: "连续7天",
        status: "pending",
        sourcePage: "第5页",
      },
      {
        id: `${reportId}_med_2`,
        name: "速诺 50mg",
        drugName: "速诺 50mg",
        time: "20:00",
        dosage: "一次1片",
        frequency: "一日2次",
        instruction: "饭后",
        duration: "连续7天",
        status: "pending",
        sourcePage: "第5页",
      },
      {
        id: `${reportId}_med_3`,
        name: "护肝药",
        drugName: "护肝药",
        time: "08:00",
        dosage: "一次1粒",
        frequency: "一日1次",
        instruction: "随餐",
        duration: "连续14天",
        status: "pending",
        sourcePage: "第5页",
      },
    ],
    followups: [
      {
        id: `${reportId}_followup_1`,
        title: "复查建议",
        date: "2026-04-29",
        desc: "2026-04-29 复查血常规、生化、尿检。",
        items: ["血常规", "生化", "尿检"],
        sourcePage: "第5页",
      },
    ],
    aiSummary: "结构化摘要，仅供人工确认，不含诊断建议。",
  };
}

function buildStubCandidate(reportId: string, sampleMode: DeepSeekSampleMode, infectious: boolean) {
  return sampleMode === "short"
    ? buildShortStubCandidate(reportId)
    : buildFullStubCandidate(reportId, infectious);
}

function summarizeHttpError(bodyText: string) {
  const compact = String(bodyText || "").replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 200) : "empty_response";
}

function buildFallbackResult(config: DeepSeekRuntimeConfig, prompt: PromptContext, reason: string, durationMs = 0): DeepSeekAttemptResult {
  const diagnostics = createDiagnostics("mock_fallback", config, prompt, {
    requestDurationMs: durationMs,
    sourceType: "mock_backend",
    schemaValid: false,
    fallbackReason: reason,
  });
  logDeepSeek("finished", diagnostics);
  return {
    mode: "mock_fallback",
    result: null,
    errorSummary: reason,
    diagnostics,
  };
}

async function tryStructureWithStub(
  reportId: string,
  config: DeepSeekRuntimeConfig,
  prompt: PromptContext
): Promise<DeepSeekAttemptResult> {
  const startedAt = Date.now();
  try {
    const infectious = /\bFIV\b|\bFeLV\b|传染病/u.test(prompt.sampleOcrText);
    const sampleModeForStub = (prompt.sampleMode === "ocr_stub" || prompt.sampleMode === "ocr_real") ? "short" : prompt.sampleMode;
    const candidate = buildStubCandidate(reportId, sampleModeForStub, infectious);
    const result = normalizeDeepSeekCandidate(candidate, reportId, "deepseek_stub", config.model || "deepseek-stub", prompt.sampleName, prompt);
    const diagnostics = createDiagnostics("stub", config, prompt, {
      requestDurationMs: Date.now() - startedAt,
      sourceType: result.parseMeta.sourceType,
      schemaValid: true,
    });
    logDeepSeek("finished", diagnostics);
    return {
      mode: "stub",
      result,
      diagnostics,
    };
  } catch (error: any) {
    if (error instanceof ZodError) {
      return buildFallbackResult(config, prompt, "DeepSeek stub 结果未通过 schema 校验，已回退到 mock_backend 结果", Date.now() - startedAt);
    }
    return buildFallbackResult(config, prompt, "DeepSeek stub 结构化失败，已回退到 mock_backend 结果", Date.now() - startedAt);
  }
}

async function tryStructureWithRealApi(
  reportId: string,
  config: DeepSeekRuntimeConfig,
  prompt: PromptContext
): Promise<DeepSeekAttemptResult> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  const startedDiagnostics = createDiagnostics("real_api", config, prompt, {
    requestDurationMs: 0,
  });
  logDeepSeek("request_started", startedDiagnostics);

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
          {
            role: "system",
            content: prompt.systemPrompt,
          },
          {
            role: "user",
            content: prompt.userPrompt,
          },
        ],
        response_format: {
          type: "json_object",
        },
        max_tokens: 12000,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = summarizeHttpError(await response.text());
      return buildFallbackResult(
        config,
        prompt,
        `DeepSeek 请求失败(${response.status})，已回退到 mock_backend 结果`,
        Date.now() - startedAt
      );
    }

    const payload = await response.json() as DeepSeekResponse;
    const content = payload?.choices?.[0]?.message?.content;
    if (!content || !String(content).trim()) {
      return buildFallbackResult(
        config,
        prompt,
        "DeepSeek 返回空内容，已回退到 mock_backend 结果",
        Date.now() - startedAt
      );
    }

    // 临时调试：打 DeepSeek 输入 + 输出 preview，判断是 OCR 文本没料还是 DeepSeek 提取失败
    console.info("[deepseek] raw_text_input_preview", {
      reportId,
      sampleName: prompt.sampleName,
      rawTextChars: prompt.rawTextChars,
      rawTextHead: (prompt.sampleOcrText || "").slice(0, 400).replace(/\n/g, " ⏎ "),
    });
    console.info("[deepseek] raw_content_output_preview", {
      reportId,
      contentChars: String(content).length,
      contentHead: String(content).slice(0, 600),
    });

    const parsed = parseMessageContentToJson(content);
    const result = normalizeDeepSeekCandidate(parsed, reportId, "deepseek_api", config.model, prompt.sampleName, prompt);
    console.info("[deepseek] structured_result_summary", {
      reportId,
      catName: result.visitInfo?.catName,
      hospital: result.visitInfo?.hospital,
      doctor: result.visitInfo?.doctor,
      weight: result.visitInfo?.weight,
      temperature: result.visitInfo?.temperature,
      labsCount: result.labs?.length || 0,
      imagingCount: result.imaging?.length || 0,
      medicationsCount: result.medications?.length || 0,
    });
    const diagnostics = createDiagnostics("real_api", config, prompt, {
      requestDurationMs: Date.now() - startedAt,
      sourceType: result.parseMeta.sourceType,
      schemaValid: true,
    });
    logDeepSeek("finished", diagnostics);
    return {
      mode: "real_api",
      result,
      diagnostics,
    };
  } catch (error: any) {
    if (error instanceof ZodError) {
      return buildFallbackResult(
        config,
        prompt,
        "DeepSeek 结构化结果未通过 schema 校验，已回退到 mock_backend 结果",
        Date.now() - startedAt
      );
    }

    if (error instanceof SyntaxError) {
      return buildFallbackResult(
        config,
        prompt,
        "DeepSeek 返回内容不是合法 JSON，已回退到 mock_backend 结果",
        Date.now() - startedAt
      );
    }

    if (error?.name === "AbortError") {
      return buildFallbackResult(
        config,
        prompt,
        "DeepSeek 请求超时，已回退到 mock_backend 结果",
        Date.now() - startedAt
      );
    }

    return buildFallbackResult(
      config,
      prompt,
      "DeepSeek 结构化失败，已回退到 mock_backend 结果",
      Date.now() - startedAt
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function tryStructureSampleOcrWithDeepSeek(input: DeepSeekInput): Promise<DeepSeekAttemptResult> {
  const config = getRuntimeConfig(input.forceSampleMode);
  const prompt = buildPromptContext(input, config);

  if (!config.apiKey) {
    return buildFallbackResult(config, prompt, "未配置 DEEPSEEK_API_KEY，已回退到 mock_backend 结果");
  }

  if (config.useStub) {
    return tryStructureWithStub(input.reportId, config, prompt);
  }

  return tryStructureWithRealApi(input.reportId, config, prompt);
}

export async function runDeepSeekConnectivityTest() {
  const attempt = await tryStructureSampleOcrWithDeepSeek({
    reportId: "deepseek_test_report",
    filename: "deepseek-connectivity-test.pdf",
    forceSampleMode: "short",
  });

  return {
    ok: attempt.mode !== "mock_fallback" && Boolean(attempt.result),
    mode: attempt.mode,
    model: attempt.diagnostics.model,
    baseUrl: attempt.diagnostics.baseUrl,
    timeoutMs: attempt.diagnostics.timeoutMs,
    sampleMode: attempt.diagnostics.sampleMode,
    sampleName: attempt.diagnostics.sampleName,
    rawTextChars: attempt.diagnostics.rawTextChars,
    promptChars: attempt.diagnostics.promptChars,
    durationMs: attempt.diagnostics.requestDurationMs,
    sourceType: attempt.result?.parseMeta?.sourceType || attempt.diagnostics.sourceType,
    schemaValid: attempt.diagnostics.schemaValid,
    fallbackReason: attempt.errorSummary || attempt.diagnostics.fallbackReason,
  };
}
