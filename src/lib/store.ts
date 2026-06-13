import { isVitalSign, normalizeLabCode, normalizeTrendCheckCategory } from "./indicatorCategories";

// v2：多宠物架构。schema 含 pets[] + currentPetId；所有 collection 加 petId 字段。
// 旧 v1（catcare_app_data_v1，单宠物示例数据）首次加载时自动清空。
// mock 数据已清空，用户首次访问需要在 Profile 页面创建宠物档案。
const STORE_KEY = "catcare_app_data_v2";
const LEGACY_STORE_KEY_V1 = "catcare_app_data_v1";

export const STORE_UPDATED_EVENT = "storeUpdated";
const CAT_PROFILE_UPDATED_EVENT = "catProfileUpdated";
const PETS_UPDATED_EVENT = "petsUpdated";

const DEFAULT_EXTRACTED = {
  visitCount: 0,
  labCount: 0,
  imagingCount: 0,
  medicationCount: 0,
  followupCount: 0,
};

// 空白宠物占位 —— 仅在没有当前选中宠物时返回，避免页面崩溃。
// 真实宠物数据由用户在 Profile 页面创建。
const EMPTY_PET_PLACEHOLDER = {
  id: "",
  name: "",
  species: "cat",
  avatar: "",
  birthday: "",
  estimatedAge: 0,
  gender: "",
  neutered: false,
  breed: "",
  weight: 0,
  weightLogs: [],
  dewormingLogs: [],
  bodyCondition: "",
  lifestyle: "",
  labels: [],
  allergies: "",
  history: "",
  hospital: "",
  doctor: "",
  nextCheckup: "",
  notes: ""
};

// 兼容旧代码 ——
// `INITIAL_CAT_PROFILE` 不再注入示例宠物默认值，仅作为读取空状态时的安全 fallback。
const INITIAL_CAT_PROFILE = EMPTY_PET_PLACEHOLDER;

function createPetId() {
  return `pet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePet(pet: any) {
  return {
    id: pet?.id || createPetId(),
    name: pet?.name || "",
    species: pet?.species || "cat",
    avatar: pet?.avatar || "",
    birthday: pet?.birthday || "",
    estimatedAge: Number(pet?.estimatedAge) || 0,
    gender: pet?.gender || "",
    neutered: Boolean(pet?.neutered),
    breed: pet?.breed || "",
    weight: Number(pet?.weight) || 0,
    weightLogs: Array.isArray(pet?.weightLogs) ? pet.weightLogs : [],
    dewormingLogs: Array.isArray(pet?.dewormingLogs) ? pet.dewormingLogs : [],
    bodyCondition: pet?.bodyCondition || "",
    lifestyle: pet?.lifestyle || "",
    labels: Array.isArray(pet?.labels) ? pet.labels : [],
    allergies: pet?.allergies || "",
    history: pet?.history || "",
    hospital: pet?.hospital || "",
    doctor: pet?.doctor || "",
    nextCheckup: pet?.nextCheckup || "",
    notes: pet?.notes || "",
    createdAt: pet?.createdAt || nowIso(),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function toDateOnly(value?: string) {
  if (!value) return nowIso().split("T")[0];
  return String(value).slice(0, 10);
}

function inferReportDateFromFilename(filename?: string) {
  if (!filename) return undefined;
  const match = String(filename).match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function isInfectiousReportFilename(filename?: string) {
  if (!filename) return false;
  const normalized = String(filename).toLowerCase();
  return ["传染病", "fiv", "felv", "病毒检测"].some((keyword) => normalized.includes(keyword));
}

function parseConfidence(value: any) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeExtracted(extracted: any = {}) {
  return {
    visitCount: Number(extracted.visitCount) || 0,
    labCount: Number(extracted.labCount) || 0,
    imagingCount: Number(extracted.imagingCount) || 0,
    medicationCount: Number(extracted.medicationCount) || 0,
    followupCount: Number(extracted.followupCount) || 0,
  };
}

function buildSourceLabel(sourcePdfName?: string, sourcePage?: string) {
  return [sourcePdfName, sourcePage].filter(Boolean).join(" ");
}

function normalizeDraftStatus(status: any) {
  switch (status) {
    case "normal":
    case "正常":
      return "正常";
    case "low":
    case "偏低":
      return "偏低";
    case "high":
    case "high_warning":
    case "偏高":
    case "待关注":
      return "偏高";
    case "negative":
    case "阴性":
      return "阴性";
    case "positive":
    case "阳性":
      return "阳性";
    case "abnormal":
    case "异常":
      return "异常";
    default:
      return typeof status === "string" && status ? status : "正常";
  }
}

function normalizeIndicatorStatus(status: any) {
  switch (status) {
    case "正常":
      return "normal";
    case "偏低":
      return "low";
    case "偏高":
      return "high";
    case "阴性":
      return "negative";
    case "阳性":
      return "positive";
    case "异常":
      return "abnormal";
    case "待关注":
    case "high_warning":
      return "high";
    default:
      return typeof status === "string" && status ? status : "normal";
  }
}

function normalizeIndicatorSystem(code: string, group?: string, system?: string, name?: string) {
  return normalizeTrendCheckCategory({ code, group, system, name });
}

function normalizeRange(min: any, max: any, range?: any) {
  if (typeof range === "string" && range.trim()) {
    return range;
  }

  const left = min ?? "-";
  const right = max ?? "-";
  return `${left} - ${right}`;
}

function normalizePdfRecord(pdf: any, index: number) {
  const uploadTime = pdf?.uploadTime || nowIso();
  const reportDate = pdf?.reportDate || pdf?.date || inferReportDateFromFilename(pdf?.filename) || toDateOnly(uploadTime);
  return {
    id: String(pdf?.id || `legacy_pdf_${index + 1}`),
    petId: pdf?.petId || "",
    filename: pdf?.filename || "未命名报告.pdf",
    fileName: pdf?.fileName || pdf?.filename || "未命名报告.pdf",
    uploadTime,
    reportDate,
    date: reportDate,
    parsedAt: pdf?.parsedAt,
    previewUrl: pdf?.previewUrl || "",
    pdfDataUrl: pdf?.pdfDataUrl || "",
    fileSizeBytes: Number(pdf?.fileSizeBytes) || 0,
    rawText: pdf?.rawText || "",
    textExtractionStatus: pdf?.textExtractionStatus || "",
    textExtractionMessage: pdf?.textExtractionMessage || "",
    parsedVisitInfo: pdf?.parsedVisitInfo || null,
    size: pdf?.size || "-",
    status: pdf?.status || "未解析",
    confidence: parseConfidence(pdf?.confidence),
    extracted: normalizeExtracted(pdf?.extracted || DEFAULT_EXTRACTED),
  };
}

function normalizeIndicatorRecord(record: any, indicator: any) {
  const sourcePdfName = record?.sourcePdfName;
  const sourcePage = record?.sourcePage;
  return {
    date: record?.date || record?.reportDate || toDateOnly(record?.uploadTime),
    reportDate: record?.reportDate || record?.date || toDateOnly(record?.uploadTime),
    petId: record?.petId || "",
    value: record?.value ?? "",
    status: normalizeIndicatorStatus(record?.status),
    code: String(record?.code || record?.type || indicator?.code || indicator?.type || indicator?.name || ""),
    sourcePdfId: record?.sourcePdfId,
    sourcePdfName,
    sourcePage,
    source: record?.source || buildSourceLabel(sourcePdfName, sourcePage),
  };
}

function sortIndicatorRecords(records: any[]) {
  return [...records].sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
}

function normalizeIndicator(indicator: any, index: number) {
  const code = String(indicator?.code || indicator?.type || indicator?.name || `IND_${index + 1}`);
  const normalizedRecords = Array.isArray(indicator?.records)
    ? indicator.records.map((record: any) => normalizeIndicatorRecord(record, indicator))
    : [];

  return {
    id: String(indicator?.id || `indicator_${code}`),
    code,
    type: indicator?.type || code,
    name: indicator?.name || code,
    unit: indicator?.unit || "",
    min: indicator?.min ?? "",
    max: indicator?.max ?? "",
    // group: PDF 原文里的检测项目类别（"血常规"/"生化"/"血气"等），用于 Trends 直接分类
    // system: 自动规范化的兜底分类（PDF 没写 group 时用）
    group: String(indicator?.group || "").trim(),
    system: normalizeIndicatorSystem(code, indicator?.group, indicator?.system, indicator?.name),
    records: sortIndicatorRecords(normalizedRecords),
  };
}

function normalizeMedication(med: any, index: number) {
  const name = med?.name || med?.drugName || "未命名药物";
  const sourcePdfName = med?.sourcePdfName;
  const sourcePage = med?.sourcePage;

  return {
    id: String(med?.id || `med_${index + 1}`),
    petId: med?.petId || "",
    name,
    drugName: med?.drugName || name,
    time: med?.time || "--:--",
    dosage: med?.dosage || "",
    frequency: med?.frequency || "",
    instruction: med?.instruction || "",
    duration: med?.duration || "",
    currentDay: Number(med?.currentDay) || 0,
    startDate: med?.startDate || med?.reportDate || toDateOnly(),
    status: med?.status || "pending",
    sourcePdfId: med?.sourcePdfId,
    sourcePdfName,
    sourcePage,
    sourceUploadTime: med?.sourceUploadTime || med?.uploadTime,
    source: med?.source || buildSourceLabel(sourcePdfName, sourcePage),
  };
}

function buildMedicationDedupKey(med: any) {
  return [
    med?.sourcePdfId || "",
    med?.drugName || med?.name || "",
    med?.time || "",
    med?.dosage || "",
    med?.instruction || "",
  ].join("__");
}

function normalizeTimelineItem(item: any, index: number) {
  const sourcePdfName = item?.sourcePdfName;
  const sourcePage = item?.sourcePage;

  return {
    id: String(item?.id || `timeline_${index + 1}`),
    petId: item?.petId || "",
    eventDate: item?.eventDate || item?.reportDate || item?.date || toDateOnly(item?.uploadTime),
    date: item?.eventDate || item?.reportDate || item?.date || toDateOnly(item?.uploadTime),
    title: item?.title || "健康记录",
    desc: item?.desc || "",
    type: item?.type || "report",
    sourcePdfId: item?.sourcePdfId,
    sourcePdfName,
    sourcePage,
    uploadTime: item?.uploadTime,
    source: item?.source || buildSourceLabel(sourcePdfName, sourcePage),
  };
}

function sortPdfs(pdfs: any[]) {
  return [...pdfs].sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());
}

function sortTimeline(timeline: any[]) {
  return [...timeline].sort((a, b) => {
    const left = a.eventDate || a.date;
    const right = b.eventDate || b.date;
    return new Date(right).getTime() - new Date(left).getTime();
  });
}

function normalizeReportDraft(draft: any) {
  const reportId = String(draft?.reportId || "");
  const reportDate = draft?.visitInfo?.reportDate || draft?.visitInfo?.visitDate || toDateOnly();
  const visitInfo = {
    catName: draft?.visitInfo?.catName || "未命名宠物",
    reportDate,
    visitDate: reportDate,
    hospital: draft?.visitInfo?.hospital || "待确认",
    doctor: draft?.visitInfo?.doctor || "待确认",
    weight: draft?.visitInfo?.weight || "",
    temperature: draft?.visitInfo?.temperature || "",
    visitType: draft?.visitInfo?.visitType || "其他",
    chiefComplaint: draft?.visitInfo?.chiefComplaint || draft?.visitInfo?.complaint || "请根据PDF原文补充",
    complaint: draft?.visitInfo?.chiefComplaint || draft?.visitInfo?.complaint || "请根据PDF原文补充",
    presentIllness: draft?.visitInfo?.presentIllness || draft?.visitInfo?.currentIllness || draft?.visitInfo?.historyOfPresentIllness || "",
    pastHistory: draft?.visitInfo?.pastHistory || draft?.visitInfo?.medicalHistory || draft?.visitInfo?.history || "",
    doctorNotes: draft?.visitInfo?.doctorNotes || draft?.visitInfo?.notes || "请根据PDF原文补充",
    notes: draft?.visitInfo?.doctorNotes || draft?.visitInfo?.notes || "请根据PDF原文补充",
    followupText: draft?.visitInfo?.followupText || draft?.followups?.[0]?.desc || "",
    userNotes: draft?.visitInfo?.userNotes || "",
    syncToCatProfile: Boolean(draft?.visitInfo?.syncToCatProfile),
  };

  return {
    reportId,
    parseMeta: draft?.parseMeta || null,
    fieldMeta: draft?.fieldMeta || {},
    previewUrl: draft?.previewUrl || "",
    pdfDataUrl: draft?.pdfDataUrl || "",
    fileSizeBytes: Number(draft?.fileSizeBytes) || 0,
    fileName: draft?.fileName || draft?.filename || "",
    rawText: draft?.rawText || "",
    textExtractionStatus: draft?.textExtractionStatus || "",
    textExtractionMessage: draft?.textExtractionMessage || "",
    visitInfo,
    labs: Array.isArray(draft?.labs)
      ? draft.labs.map((lab: any, index: number) => ({
          id: String(lab?.id || `${reportId}_lab_${lab?.code || lab?.type || index + 1}`),
          group: lab?.group || "其他",
          name: lab?.name || "",
          code: String(lab?.code || lab?.type || lab?.name || `LAB_${index + 1}`),
          value: lab?.value ?? "",
          unit: lab?.unit || "",
          range: normalizeRange(lab?.min, lab?.max, lab?.range),
          min: lab?.min ?? "",
          max: lab?.max ?? "",
          status: normalizeDraftStatus(lab?.status),
          sourcePage: lab?.sourcePage || lab?.source || "",
          reportDate: lab?.reportDate || lab?.date || reportDate,
          confidence: parseConfidence(lab?.confidence ?? lab?.conf) || 0,
          checked: lab?.checked !== false,
          error: Boolean(lab?.error),
        }))
      : [],
    imaging: Array.isArray(draft?.imaging)
      ? draft.imaging.map((item: any, index: number) => ({
          id: String(item?.id || `${reportId}_imaging_${index + 1}`),
          examType: item?.examType || item?.type || "",
          bodyPart: item?.bodyPart || "",
          finding: item?.finding || "",
          impression: item?.impression || "",
          sourcePage: item?.sourcePage || "",
          reportDate: item?.reportDate || item?.date || reportDate,
        }))
      : [],
    medications: Array.isArray(draft?.medications)
      ? draft.medications.map((med: any, index: number) => {
          const name = med?.name || med?.drugName || "未命名药物";
          return {
            id: String(med?.id || `${reportId}_med_${index + 1}`),
            name,
            drugName: med?.drugName || name,
            time: med?.time || "--:--",
            dosage: med?.dosage || "",
            frequency: med?.frequency || "",
            instruction: med?.instruction || "",
            duration: med?.duration || "",
            status: med?.status || "pending",
            sourcePage: med?.sourcePage || "第5页",
            reportDate: med?.reportDate || med?.date || reportDate,
          };
        })
      : [],
    followups: Array.isArray(draft?.followups)
      ? draft.followups.map((followup: any, index: number) => ({
          id: String(followup?.id || `${reportId}_followup_${index + 1}`),
          title: followup?.title || "复查建议",
          date: followup?.date || followup?.reportDate || reportDate,
          reportDate: followup?.reportDate || followup?.date || reportDate,
          desc: followup?.desc || draft?.visitInfo?.followupText || "",
          items: followup?.items || [],
          sourcePage: followup?.sourcePage || "第5页",
        }))
      : [],
    aiSummary: draft?.aiSummary || "",
    updatedAt: draft?.updatedAt || nowIso(),
  };
}

function syncDraftVisitInfo(draft: any) {
  const normalizedDraft = normalizeReportDraft(draft);
  const followupText = String(normalizedDraft.visitInfo.followupText || "").trim();
  const followups = [...normalizedDraft.followups];

  if (followupText) {
    if (followups.length > 0) {
      followups[0] = {
        ...followups[0],
        desc: followupText,
      };
    } else {
      followups.push({
        id: `${normalizedDraft.reportId}_followup_1`,
        title: "复查建议",
        date: normalizedDraft.visitInfo.reportDate || normalizedDraft.visitInfo.visitDate || toDateOnly(),
        desc: followupText,
        items: [],
        sourcePage: "第5页",
      });
    }
  }

  return {
    ...normalizedDraft,
    visitInfo: {
      ...normalizedDraft.visitInfo,
      complaint: normalizedDraft.visitInfo.chiefComplaint,
      currentIllness: normalizedDraft.visitInfo.presentIllness,
      medicalHistory: normalizedDraft.visitInfo.pastHistory,
      notes: normalizedDraft.visitInfo.doctorNotes,
    },
    followups,
  };
}

/**
 * Lazy migration：把 indicators 数组按 normalizeLabCode 重新 group，合并历史不一致的 code。
 * 解决：老 PDF 用旧 code（"%LYM"、"MONO"、"白细胞总数"）入库 → 新 PDF 用字典标准 code → 同指标
 * 在 store 里是两条 indicator，永远不会合并。每次 loadData 都自动 dedupe，立刻生效。
 */
function dedupeIndicatorsByNormalizedCode(indicators: any[]): any[] {
  const buckets = new Map<string, any>();
  const debugMap: Record<string, Array<{ oldCode: string; name: string }>> = {};
  indicators.forEach((ind: any) => {
    const normalizedCode = normalizeLabCode(ind.code, ind.name, ind.group);
    if (!debugMap[normalizedCode]) debugMap[normalizedCode] = [];
    debugMap[normalizedCode].push({ oldCode: String(ind.code || ""), name: String(ind.name || "") });

    const existing = buckets.get(normalizedCode);
    if (existing) {
      const allRecords = [...existing.records, ...ind.records];
      allRecords.sort((a: any, b: any) => {
        const da = String(a.date || a.reportDate || "");
        const db = String(b.date || b.reportDate || "");
        return da.localeCompare(db);
      });
      existing.records = allRecords;
      const candName = String(ind.name || "").trim();
      const existName = String(existing.name || "").trim();
      if (candName && candName.length > existName.length) existing.name = candName;
      existing.unit = existing.unit || ind.unit;
      existing.min = existing.min ?? ind.min;
      existing.max = existing.max ?? ind.max;
      existing.group = existing.group || ind.group;
      existing.system = existing.system || ind.system;
    } else {
      buckets.set(normalizedCode, { ...ind, code: normalizedCode });
    }
  });
  const result = Array.from(buckets.values());
  if (typeof window !== "undefined" && indicators.length > 0) {
    // 全量打印 normalize 结果，方便定位"该合并没合并"是哪个 case 没覆盖
    const allGroups = Object.entries(debugMap).map(([code, items]) =>
      `${code} × ${items.length}: [${items.map((i) => `(code="${i.oldCode || "''"}", name="${i.name || "''"}")`).join(", ")}]`
    );
    const mergedCount = indicators.length - result.length;
    console.info(`[catcare-store] indicator dedupe: ${indicators.length} indicators → ${result.length} buckets (合并掉 ${mergedCount} 个重复)`);
    console.info("[catcare-store] 全部 normalize 详情：");
    allGroups.forEach((g) => console.info(`  ${g}`));
  }
  return result;
}

function normalizeStoreData(raw: any) {
  const base = raw || {};
  const pets = Array.isArray(base.pets)
    ? base.pets.map((pet: any) => normalizePet(pet))
    : [];

  // 当前选中宠物：必须是 pets[] 里的有效 id，否则取第一只 / 留空
  let currentPetId = typeof base.currentPetId === "string" ? base.currentPetId : "";
  if (currentPetId && !pets.find((p: any) => p.id === currentPetId)) {
    currentPetId = "";
  }
  if (!currentPetId && pets.length > 0) {
    currentPetId = pets[0].id;
  }

  // 保留 catProfile 字段作为「当前选中宠物」的镜像，向下兼容老代码 loadCatProfile()
  const currentPet = pets.find((p: any) => p.id === currentPetId) || null;
  const catProfile = currentPet || { ...EMPTY_PET_PLACEHOLDER };

  const normalized = {
    storeVersion: "v2",
    pets,
    currentPetId,
    pdfs: sortPdfs((Array.isArray(base.pdfs) ? base.pdfs : []).map((pdf: any, index: number) => normalizePdfRecord(pdf, index))),
    indicators: dedupeIndicatorsByNormalizedCode(
      (Array.isArray(base.indicators) ? base.indicators : []).map((indicator: any, index: number) =>
        normalizeIndicator(indicator, index)
      )
    ),
    meds: (Array.isArray(base.meds) ? base.meds : []).map((med: any, index: number) => normalizeMedication(med, index)),
    timeline: sortTimeline((Array.isArray(base.timeline) ? base.timeline : []).map((item: any, index: number) =>
      normalizeTimelineItem(item, index)
    )),
    catProfile,
    reportDrafts: Object.fromEntries(
      Object.entries(base.reportDrafts || {}).map(([reportId, draft]) => [
        reportId,
        syncDraftVisitInfo({ ...(draft as object), reportId }),
      ])
    ),
  };

  return normalized;
}

// 多档剥离大字段：pdfDataUrl 几 MB，pageImages 单份 5-30 MB，rawText 1-50 KB
function stripPdfPreviewPayload(data: any, level: 1 | 2 | 3 = 1) {
  const stripFields = (obj: any) => {
    const out: any = { ...obj, pdfDataUrl: "" };
    if (level >= 2) {
      out.pageImages = [];
      out.previewUrl = ""; // blob URL 在新会话也用不了
    }
    if (level >= 3) {
      out.rawText = "";
      out.textExtractionMessage = "";
      out.parsedVisitInfo = undefined;
    }
    return out;
  };
  return {
    ...data,
    pdfs: (data?.pdfs || []).map((pdf: any) => stripFields(pdf)),
    reportDrafts: Object.fromEntries(
      Object.entries(data?.reportDrafts || {}).map(([reportId, draft]) => [
        reportId,
        stripFields(draft as any),
      ])
    ),
  };
}

function writeData(data: any, notify = true) {
  // 逐级剥离：先尝试原始 → 剥 pdfDataUrl → 剥 pageImages/previewUrl → 剥 rawText
  // 保证 visitInfo / labs / imaging / medications 这些核心结构化结果永远能写进去
  const attempts: Array<{ level: 0 | 1 | 2 | 3; payload: any }> = [
    { level: 0, payload: data },
    { level: 1, payload: stripPdfPreviewPayload(data, 1) },
    { level: 2, payload: stripPdfPreviewPayload(data, 2) },
    { level: 3, payload: stripPdfPreviewPayload(data, 3) },
  ];
  let lastError: any = null;
  for (const attempt of attempts) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(attempt.payload));
      if (attempt.level > 0) {
        console.warn(`LocalStorage quota exceeded, fell back to strip level ${attempt.level}.`, lastError);
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    // 最坏情况：连剥到 level 3 都失败 —— 报错让上层感知，不要静默
    console.error("LocalStorage write failed at all strip levels", lastError);
    throw lastError;
  }
  if (notify && typeof window !== "undefined") {
    window.dispatchEvent(new Event(STORE_UPDATED_EVENT));
  }
}

function createInitialStore() {
  // 空白起步：用户首次访问需要先到 Profile 页面创建宠物档案。
  return normalizeStoreData({
    pets: [],
    currentPetId: "",
    pdfs: [],
    indicators: [],
    meds: [],
    timeline: [],
    reportDrafts: {},
  });
}

export function loadData() {
  try {
    // 自动清理旧 v1 存储（含示例宠物数据）
    if (typeof localStorage !== "undefined") {
      const legacy = localStorage.getItem(LEGACY_STORE_KEY_V1);
      if (legacy) {
        localStorage.removeItem(LEGACY_STORE_KEY_V1);
        console.info("[catcare-store] migrated from v1 → v2，旧示例数据已清空");
      }
    }
    const data = localStorage.getItem(STORE_KEY);
    if (data) {
      const normalized = normalizeStoreData(JSON.parse(data));
      writeData(normalized, false);
      return normalized;
    }
  } catch (error) {
    console.error(error);
  }

  const initial = createInitialStore();
  writeData(initial, false);
  return initial;
}

export function saveData(data: any) {
  const normalized = normalizeStoreData(data);
  writeData(normalized, true);
  return normalized;
}

export function createReportId() {
  const timestamp = Date.now();
  const shortCode = Math.random().toString(36).slice(2, 8);
  return `report_${timestamp}_${shortCode}`;
}

export function createPdfRecord(input: any) {
  // 自动绑定当前选中宠物。如果调用方明确传了 petId 则尊重；否则用当前选中。
  const resolvedPetId = input?.petId || (typeof window !== "undefined" ? loadCurrentPetId() : "");
  return normalizePdfRecord(
    {
      id: input?.id,
      petId: resolvedPetId,
      filename: input?.filename,
      fileName: input?.fileName || input?.filename,
      uploadTime: input?.uploadTime || nowIso(),
      reportDate: input?.reportDate || inferReportDateFromFilename(input?.filename) || toDateOnly(input?.uploadTime || nowIso()),
      parsedAt: input?.parsedAt,
      previewUrl: input?.previewUrl || "",
      pdfDataUrl: input?.pdfDataUrl || "",
      fileSizeBytes: Number(input?.fileSizeBytes) || 0,
      rawText: input?.rawText || "",
      textExtractionStatus: input?.textExtractionStatus || "",
      textExtractionMessage: input?.textExtractionMessage || "",
      parsedVisitInfo: input?.parsedVisitInfo || null,
      size: input?.size || "-",
      status: input?.status || "未解析",
      confidence: input?.confidence,
      extracted: input?.extracted || DEFAULT_EXTRACTED,
    },
    0
  );
}

export function upsertPdfRecord(pdfRecord: any) {
  const store = loadData();
  const normalizedRecord = normalizePdfRecord(pdfRecord, store.pdfs.length);
  const existingIndex = store.pdfs.findIndex((item: any) => item.id === normalizedRecord.id);

  if (existingIndex >= 0) {
    store.pdfs[existingIndex] = {
      ...store.pdfs[existingIndex],
      ...normalizedRecord,
      extracted: normalizeExtracted(normalizedRecord.extracted),
    };
  } else {
    store.pdfs.unshift(normalizedRecord);
  }

  store.pdfs = sortPdfs(store.pdfs);
  saveData(store);
  return normalizedRecord;
}

export function updatePdfStatus(reportId: string, status: string, patch: any = {}) {
  const store = loadData();
  const existingIndex = store.pdfs.findIndex((item: any) => item.id === reportId);
  const baseRecord = existingIndex >= 0
    ? store.pdfs[existingIndex]
    : createPdfRecord({ id: reportId, filename: patch.filename || "未命名报告.pdf", size: patch.size || "-", status });

  const updatedRecord = normalizePdfRecord(
    {
      ...baseRecord,
      ...patch,
      id: reportId,
      status,
      reportDate: patch.reportDate || baseRecord.reportDate,
      parsedAt: patch.parsedAt || baseRecord.parsedAt,
      extracted: normalizeExtracted(patch.extracted || baseRecord.extracted || DEFAULT_EXTRACTED),
    },
    existingIndex >= 0 ? existingIndex : store.pdfs.length
  );

  if (existingIndex >= 0) {
    store.pdfs[existingIndex] = updatedRecord;
  } else {
    store.pdfs.unshift(updatedRecord);
  }

  store.pdfs = sortPdfs(store.pdfs);
  saveData(store);
  return updatedRecord;
}

export function loadPdfRecord(reportId: string) {
  const store = loadData();
  return store.pdfs.find((item: any) => item.id === reportId) || null;
}

export function loadReportDraft(reportId: string) {
  const store = loadData();
  const draft = store.reportDrafts?.[reportId];
  return draft ? syncDraftVisitInfo(draft) : null;
}

export function saveReportDraft(draft: any) {
  const store = loadData();
  const normalizedDraft = syncDraftVisitInfo({
    ...draft,
    updatedAt: nowIso(),
  });

  store.reportDrafts[normalizedDraft.reportId] = normalizedDraft;
  saveData(store);
  return normalizedDraft;
}

export function buildExtractedCountsFromDraft(draft: any) {
  const normalizedDraft = syncDraftVisitInfo(draft);
  const validLabs = normalizedDraft.labs.filter((lab: any) => lab.checked && !lab.error);
  const validImaging = normalizedDraft.imaging.filter((item: any) => (
    item.examType || item.bodyPart || item.finding || item.impression
  ));
  return {
    visitCount: normalizedDraft.visitInfo ? 1 : 0,
    labCount: validLabs.length,
    imagingCount: validImaging.length,
    medicationCount: normalizedDraft.medications.length,
    followupCount: normalizedDraft.followups.length,
  };
}

function buildDraftConfidence(draft: any) {
  const normalizedDraft = syncDraftVisitInfo(draft);
  const values = normalizedDraft.labs
    .filter((lab: any) => lab.checked && !lab.error && Number.isFinite(lab.confidence))
    .map((lab: any) => Number(lab.confidence))
    .filter((value: number) => value > 0);

  if (values.length === 0) {
    return undefined;
  }

  return Math.round(values.reduce((sum: number, value: number) => sum + value, 0) / values.length);
}

function parseIndicatorLimit(value: any) {
  if (value === "" || value === undefined || value === null) {
    return "";
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function upsertTimelineEvent(timeline: any[], reportId: string, event: any) {
  const filtered = timeline.filter((item: any) => !(item.type === event.type && item.sourcePdfId === reportId));
  filtered.unshift(normalizeTimelineItem(event, filtered.length));
  return sortTimeline(filtered);
}

function buildTimelineDesc(draft: any, extracted: any) {
  const sections = [
    extracted.visitCount ? "就诊信息" : "",
    extracted.labCount ? `检验指标${extracted.labCount}项` : "",
    extracted.imagingCount ? `影像报告${extracted.imagingCount}条` : "",
    extracted.medicationCount ? `医嘱处方${extracted.medicationCount}条` : "",
    extracted.followupCount ? `复查建议${extracted.followupCount}条` : "",
  ].filter(Boolean);

  const followupText = draft.followups[0]?.date ? `；最近复查建议：${draft.followups[0].date}` : "";
  return `已入库：${sections.join("、")}${followupText}`;
}

export function confirmReportDraft(reportId: string, draft: any) {
  const store = loadData();
  const normalizedDraft = syncDraftVisitInfo({
    ...draft,
    reportId,
    updatedAt: nowIso(),
  });
  const extracted = buildExtractedCountsFromDraft(normalizedDraft);
  const reportDate = normalizedDraft.visitInfo.reportDate || normalizedDraft.visitInfo.visitDate;
  const pdfRecord = loadPdfRecord(reportId) || createPdfRecord({
    id: reportId,
    filename: "未命名报告.pdf",
    status: "待确认",
  });
  const sourcePdfName = pdfRecord.filename;

  store.reportDrafts[reportId] = normalizedDraft;

  const existingPdfIndex = store.pdfs.findIndex((item: any) => item.id === reportId);
  const updatedPdf = normalizePdfRecord(
    {
      ...(existingPdfIndex >= 0 ? store.pdfs[existingPdfIndex] : pdfRecord),
      status: "已入库",
      reportDate,
      previewUrl: normalizedDraft.previewUrl || pdfRecord.previewUrl,
      pdfDataUrl: normalizedDraft.pdfDataUrl || pdfRecord.pdfDataUrl,
      fileSizeBytes: normalizedDraft.fileSizeBytes || pdfRecord.fileSizeBytes,
      rawText: normalizedDraft.rawText || pdfRecord.rawText,
      textExtractionStatus: normalizedDraft.textExtractionStatus || pdfRecord.textExtractionStatus,
      textExtractionMessage: normalizedDraft.textExtractionMessage || pdfRecord.textExtractionMessage,
      parsedVisitInfo: normalizedDraft.visitInfo,
      confidence: buildDraftConfidence(normalizedDraft),
      extracted,
    },
    existingPdfIndex >= 0 ? existingPdfIndex : store.pdfs.length
  );

  if (existingPdfIndex >= 0) {
    store.pdfs[existingPdfIndex] = updatedPdf;
  } else {
    store.pdfs.unshift(updatedPdf);
  }
  store.pdfs = sortPdfs(store.pdfs);

  const reportEvent = {
    id: `timeline_report_${reportId}`,
    petId: updatedPdf.petId || "",
    eventDate: reportDate || updatedPdf.reportDate,
    reportDate: reportDate || updatedPdf.reportDate,
    date: reportDate || updatedPdf.reportDate,
    title: `${reportDate || updatedPdf.reportDate} 解析并入库《${sourcePdfName}》`,
    desc: buildTimelineDesc(normalizedDraft, extracted),
    type: "report",
    sourcePdfId: reportId,
    sourcePdfName,
    sourcePage: "结构化摘要",
    uploadTime: updatedPdf.uploadTime,
  };
  store.timeline = upsertTimelineEvent(store.timeline || [], reportId, reportEvent);

  const incomingMeds = normalizedDraft.medications.map((med: any, index: number) =>
    normalizeMedication(
      {
        id: `${reportId}_${med.drugName || med.name}_${med.time || index}`,
        petId: updatedPdf.petId || "",
        name: med.name || med.drugName,
        drugName: med.drugName || med.name,
        time: med.time,
        dosage: med.dosage,
        frequency: med.frequency,
        instruction: med.instruction,
        duration: med.duration,
        startDate: med.startDate || reportDate,
        status: med.status || "pending",
        sourcePdfId: reportId,
        sourcePdfName,
        sourcePage: med.sourcePage,
        sourceUploadTime: updatedPdf.uploadTime,
      },
      index
    )
  );

  const existingReportMeds = (store.meds || []).filter((med: any) => med.sourcePdfId === reportId);
  const existingMedMap = new Map(
    existingReportMeds.map((med: any) => [buildMedicationDedupKey(med), med])
  );

  const dedupedIncomingMeds = Object.values(
    incomingMeds.reduce((acc: Record<string, any>, med: any) => {
      const key = buildMedicationDedupKey(med);
      const existing = existingMedMap.get(key) as any;
      acc[key] = existing
        ? normalizeMedication(
            {
              ...med,
              id: existing.id || med.id,
              status: existing.status || med.status,
              currentDay: existing.currentDay ?? med.currentDay,
            },
            0
          )
        : med;
      return acc;
    }, {})
  );

  store.meds = [
    ...dedupedIncomingMeds,
    ...(store.meds || []).filter((med: any) => med.sourcePdfId !== reportId),
  ];

  const remainingIndicators = (store.indicators || []).map((indicator: any) => ({
    ...indicator,
    records: indicator.records.filter((record: any) => record.sourcePdfId !== reportId),
  }));

  normalizedDraft.labs
    .filter((lab: any) => lab.checked && !lab.error)
    .filter((lab: any) => !isVitalSign(lab.code, lab.name)) // 体温/心率/CRT 等生命体征不算化验指标
    .forEach((lab: any) => {
      const code = normalizeLabCode(lab.code, lab.name, lab.group); // 中文别称 + group 上下文统一映射到英文 code
      const indicatorIndex = remainingIndicators.findIndex((indicator: any) => indicator.code === code);
      const record = normalizeIndicatorRecord(
        {
          date: reportDate || updatedPdf.reportDate,
          reportDate: reportDate || updatedPdf.reportDate,
          petId: updatedPdf.petId || "",
          value: lab.value,
          status: lab.status,
          code,
          sourcePdfId: reportId,
          sourcePdfName,
          sourcePage: lab.sourcePage,
        },
        { code }
      );

      if (indicatorIndex >= 0) {
        const target = remainingIndicators[indicatorIndex];
        target.name = lab.name || target.name;
        target.type = target.type || code;
        target.unit = lab.unit || target.unit;
        target.min = lab.min !== "" ? parseIndicatorLimit(lab.min) : target.min;
        target.max = lab.max !== "" ? parseIndicatorLimit(lab.max) : target.max;
        target.group = String(lab.group || "").trim() || target.group;
        target.system = normalizeIndicatorSystem(code, lab.group, target.system, lab.name);
        target.records = sortIndicatorRecords([...target.records, record]);
      } else {
        remainingIndicators.push(
          normalizeIndicator(
            {
              id: `indicator_${code}`,
              code,
              type: code,
              name: lab.name,
              unit: lab.unit,
              min: parseIndicatorLimit(lab.min),
              max: parseIndicatorLimit(lab.max),
              group: lab.group,
              system: normalizeIndicatorSystem(code, lab.group, undefined, lab.name),
              records: [record],
            },
            remainingIndicators.length
          )
        );
      }
    });

  store.indicators = remainingIndicators;

  if (normalizedDraft.visitInfo.syncToCatProfile) {
    store.catProfile = {
      ...store.catProfile,
      hospital: normalizedDraft.visitInfo.hospital || store.catProfile?.hospital,
      doctor: normalizedDraft.visitInfo.doctor || store.catProfile?.doctor,
    };
  }

  // —— PDF 识别的体重同步到宠物档案的 weightLogs。
  // 按 reportId 去重，便于重新解析时覆盖；删 PDF 时按同样 key 清理。
  const weightKg = parseWeightKg(normalizedDraft.visitInfo.weight);
  const targetPetId = updatedPdf.petId || store.currentPetId;
  let weightSynced = false;
  if (weightKg !== null && targetPetId && (reportDate || updatedPdf.reportDate)) {
    const useDate = reportDate || updatedPdf.reportDate;
    store.pets = (store.pets || []).map((p: any) => {
      if (p.id !== targetPetId) return p;
      const otherLogs = (p.weightLogs || []).filter((log: any) => log.sourceReportId !== reportId);
      const newLogs = [
        ...otherLogs,
        { date: useDate, weight: weightKg, sourceReportId: reportId, sourcePdfName },
      ].sort((a: any, b: any) => String(a.date || "").localeCompare(String(b.date || "")));
      return { ...p, weightLogs: newLogs };
    });
    weightSynced = true;
    // 当前宠物的快照同步更新，UI 立即生效
    if (targetPetId === store.currentPetId) {
      store.catProfile = store.pets.find((p: any) => p.id === store.currentPetId) || store.catProfile;
    }
  }

  saveData(store);
  if ((normalizedDraft.visitInfo.syncToCatProfile || weightSynced) && typeof window !== "undefined") {
    window.dispatchEvent(new Event(CAT_PROFILE_UPDATED_EVENT));
  }
  return {
    pdf: updatedPdf,
    draft: normalizedDraft,
  };
}

// 解析 "4.5 kg" / "4.5" / "4.5 公斤" / "4500 g" 等形式为公斤数字。
// 合理范围 0.1–50 kg（家养猫），超出视作识别错误返回 null。
function parseWeightKg(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).trim();
  const m = str.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 含 "g" 但不含 "kg"，按克处理
  if (/\bg\b|克/.test(str) && !/kg|公斤|千克/i.test(str)) {
    n = n / 1000;
  }
  if (n < 0.1 || n > 50) return null;
  return Math.round(n * 100) / 100; // 保留 2 位小数
}

export function deleteReport(reportId: string) {
  const store = loadData();
  const deletedPdf = store.pdfs.find((item: any) => item.id === reportId) || null;

  store.pdfs = (store.pdfs || []).filter((item: any) => item.id !== reportId);
  store.timeline = (store.timeline || []).filter((item: any) => item.sourcePdfId !== reportId);
  store.meds = (store.meds || []).filter((med: any) => med.sourcePdfId !== reportId);
  store.indicators = (store.indicators || [])
    .map((indicator: any) => ({
      ...indicator,
      records: (indicator.records || []).filter((record: any) => record.sourcePdfId !== reportId),
    }))
    .filter((indicator: any) => indicator.records.length > 0);

  // 同步清理 PDF 写入的 weightLogs（保留用户手工录入的）
  let weightTouched = false;
  store.pets = (store.pets || []).map((p: any) => {
    const filtered = (p.weightLogs || []).filter((log: any) => log.sourceReportId !== reportId);
    if (filtered.length !== (p.weightLogs || []).length) weightTouched = true;
    return { ...p, weightLogs: filtered };
  });
  if (weightTouched && store.currentPetId) {
    store.catProfile = store.pets.find((p: any) => p.id === store.currentPetId) || store.catProfile;
  }

  if (store.reportDrafts?.[reportId]) {
    delete store.reportDrafts[reportId];
  }

  saveData(store);
  if (weightTouched && typeof window !== "undefined") {
    window.dispatchEvent(new Event(CAT_PROFILE_UPDATED_EVENT));
  }
  return deletedPdf;
}

export function clearReportTestData() {
  const store = loadData();
  const clearedStore = {
    ...store,
    pdfs: [],
    indicators: [],
    meds: [],
    timeline: [],
    reportDrafts: {},
  };

  return saveData(clearedStore);
}

export function loadCatProfile() {
  const store = loadData();
  return store.catProfile || INITIAL_CAT_PROFILE;
}

// 多宠物架构下，saveCatProfile / updateCatProfile 等价于「修改当前选中宠物」。
// 同时同步到 pets[] 数组，避免下次 normalize 被覆盖。
export function saveCatProfile(catProfile: any) {
  const store = loadData();
  if (!store.currentPetId) {
    // 没有当前宠物时，把传入数据作为新宠物添加（兼容老页面在空状态下尝试初始化档案的场景）
    if (catProfile && (catProfile.name || catProfile.breed)) {
      addPet(catProfile);
    }
    return;
  }
  store.pets = (store.pets || []).map((p: any) =>
    p.id === store.currentPetId ? normalizePet({ ...p, ...catProfile, id: p.id }) : p,
  );
  store.catProfile = store.pets.find((p: any) => p.id === store.currentPetId) || { ...EMPTY_PET_PLACEHOLDER };
  saveData(store);
}

export function updateCatProfile(partialData: any) {
  const current = loadCatProfile();
  saveCatProfile({ ...current, ...partialData });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CAT_PROFILE_UPDATED_EVENT));
  }
}

// ============================================================
// 多宠物架构 API（v2 新增）
// ============================================================

function notifyPetsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PETS_UPDATED_EVENT));
    window.dispatchEvent(new Event(CAT_PROFILE_UPDATED_EVENT));
    // 同时触发通用 store 更新事件，让现有页面（监听 STORE_UPDATED_EVENT）自动响应宠物切换
    window.dispatchEvent(new Event(STORE_UPDATED_EVENT));
  }
}

export function loadPets() {
  const store = loadData();
  return Array.isArray(store.pets) ? store.pets : [];
}

export function loadCurrentPetId() {
  const store = loadData();
  return store.currentPetId || "";
}

export function loadCurrentPet() {
  const store = loadData();
  if (!store.currentPetId) return null;
  return (store.pets || []).find((p: any) => p.id === store.currentPetId) || null;
}

export function setCurrentPetId(petId: string) {
  const store = loadData();
  if (!petId) {
    store.currentPetId = "";
  } else if ((store.pets || []).find((p: any) => p.id === petId)) {
    store.currentPetId = petId;
  } else {
    return store;
  }
  // 同步刷新 catProfile 镜像
  const pet = (store.pets || []).find((p: any) => p.id === store.currentPetId) || null;
  store.catProfile = pet || { ...EMPTY_PET_PLACEHOLDER };
  saveData(store);
  notifyPetsUpdated();
  return store;
}

export function addPet(petInput: any) {
  const store = loadData();
  const newPet = normalizePet({ ...petInput, id: petInput?.id || createPetId() });
  store.pets = [...(store.pets || []), newPet];
  // 首只宠物自动设为当前
  if (!store.currentPetId) {
    store.currentPetId = newPet.id;
    store.catProfile = newPet;
  }
  saveData(store);
  notifyPetsUpdated();
  return newPet;
}

export function updatePet(petId: string, partial: any) {
  const store = loadData();
  const pets = (store.pets || []).map((p: any) =>
    p.id === petId ? normalizePet({ ...p, ...partial, id: petId }) : p,
  );
  store.pets = pets;
  // 同步 catProfile 镜像
  if (store.currentPetId === petId) {
    store.catProfile = pets.find((p: any) => p.id === petId) || { ...EMPTY_PET_PLACEHOLDER };
  }
  saveData(store);
  notifyPetsUpdated();
}

export function deletePet(petId: string) {
  const store = loadData();
  store.pets = (store.pets || []).filter((p: any) => p.id !== petId);
  // 级联清理该 pet 的所有数据
  store.pdfs = (store.pdfs || []).filter((pdf: any) => pdf.petId !== petId);
  store.indicators = (store.indicators || [])
    .map((indicator: any) => ({
      ...indicator,
      records: (indicator.records || []).filter((r: any) => r.petId !== petId),
    }))
    .filter((indicator: any) => indicator.records.length > 0);
  store.meds = (store.meds || []).filter((m: any) => m.petId !== petId);
  store.timeline = (store.timeline || []).filter((t: any) => t.petId !== petId);
  // 删除该 pet 相关草稿
  store.reportDrafts = Object.fromEntries(
    Object.entries(store.reportDrafts || {}).filter(([, draft]: [string, any]) => draft?.petId !== petId),
  );
  // 切换 currentPetId 到第一只剩余 / 清空
  if (store.currentPetId === petId) {
    store.currentPetId = store.pets[0]?.id || "";
    store.catProfile = store.pets[0] || { ...EMPTY_PET_PLACEHOLDER };
  }
  saveData(store);
  notifyPetsUpdated();
}

// ----- per-pet selectors（页面用这些 helper 避免重复 filter 逻辑）-----

export function loadPdfsForCurrentPet() {
  const store = loadData();
  const petId = store.currentPetId;
  if (!petId) return [];
  return (store.pdfs || []).filter((p: any) => p.petId === petId);
}

export function loadIndicatorsForCurrentPet() {
  const store = loadData();
  const petId = store.currentPetId;
  if (!petId) return [];
  return (store.indicators || [])
    .map((indicator: any) => ({
      ...indicator,
      records: (indicator.records || []).filter((r: any) => r.petId === petId),
    }))
    .filter((indicator: any) => indicator.records.length > 0);
}

export function loadMedsForCurrentPet() {
  const store = loadData();
  const petId = store.currentPetId;
  if (!petId) return [];
  return (store.meds || []).filter((m: any) => m.petId === petId);
}

export function loadTimelineForCurrentPet() {
  const store = loadData();
  const petId = store.currentPetId;
  if (!petId) return [];
  return (store.timeline || []).filter((t: any) => t.petId === petId);
}

export const PETS_UPDATED = PETS_UPDATED_EVENT;
export const CAT_PROFILE_UPDATED = CAT_PROFILE_UPDATED_EVENT;

// ============================================================
// 用户登录（前端伪登录，不接后端 —— Demo 性质，只持久化昵称/头像 URL）
// ============================================================
export const USER_UPDATED_EVENT = "catcareUserUpdated";
const USER_STORAGE_KEY = "catcare_user_v1";

export type CatcareUser = {
  nickname: string;
  avatarUrl?: string;
  loggedInAt: string;
};

export function loadUser(): CatcareUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.nickname !== "string" || !parsed.nickname.trim()) return null;
    return {
      nickname: String(parsed.nickname).trim(),
      avatarUrl: typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : undefined,
      loggedInAt: typeof parsed.loggedInAt === "string" ? parsed.loggedInAt : nowIso(),
    };
  } catch {
    return null;
  }
}

export function saveUser(user: { nickname: string; avatarUrl?: string }) {
  if (typeof window === "undefined") return;
  const normalized: CatcareUser = {
    nickname: String(user.nickname || "").trim() || "猫主子",
    avatarUrl: user.avatarUrl?.trim() || undefined,
    loggedInAt: nowIso(),
  };
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(USER_UPDATED_EVENT));
}

export function clearUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USER_STORAGE_KEY);
  window.dispatchEvent(new Event(USER_UPDATED_EVENT));
}

/**
 * 返回 filter 到「当前选中宠物」的 store 副本。
 * 各页面替换 loadData() → loadDataForCurrentPet() 即可获得仅当前宠物的数据。
 * 当 currentPetId 为空时返回空数据（页面应渲染"请先创建宠物"引导）。
 */
export function loadDataForCurrentPet() {
  const store = loadData();
  const petId = store.currentPetId;
  if (!petId) {
    return {
      ...store,
      pdfs: [],
      indicators: [],
      meds: [],
      timeline: [],
      reportDrafts: {},
    };
  }
  const currentPdfs = (store.pdfs || []).filter((p: any) => p.petId === petId);
  const currentPdfIds = new Set(currentPdfs.map((pdf: any) => pdf.id));

  return {
    ...store,
    pdfs: currentPdfs,
    reportDrafts: Object.fromEntries(
      Object.entries(store.reportDrafts || {}).filter(([reportId]) => currentPdfIds.has(reportId))
    ),
    indicators: (store.indicators || [])
      .map((indicator: any) => ({
        ...indicator,
        records: (indicator.records || []).filter((r: any) => r.petId === petId),
      }))
      .filter((indicator: any) => indicator.records.length > 0),
    meds: (store.meds || []).filter((m: any) => m.petId === petId),
    timeline: (store.timeline || []).filter((t: any) => t.petId === petId),
  };
}
