import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, AlertTriangle, FileText, LayoutTemplate, XCircle, Pencil, Trash2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Disclaimer } from "../components/ui";
import { parseVisitInfoFromText } from "../lib/pdfParser";
import { buildExtractedCountsFromDraft, confirmReportDraft, isInfectiousReportFilename, loadCatProfile, loadPdfRecord, loadReportDraft, saveReportDraft, updatePdfStatus } from "../lib/store";
import { PdfPreview } from "../components/PdfPreview";
import { loadPdfBlob } from "../lib/pdfBlobStore";

const TABS = ["就诊信息", "检验指标", "影像报告", "医嘱处方", "AI解析摘要"];
const VISIT_TYPES = ["初诊", "复诊", "体检", "急诊", "其他"];

const COMMON_MOCK_LABS = [
  { group: "血常规", code: "WBC", name: "白细胞", value: "16.2", unit: "10^9/L", min: "5.5", max: "19.5", status: "正常", sourcePage: "第2页", confidence: 96 },
  { group: "血常规", code: "RBC", name: "红细胞", value: "5.1", unit: "10^12/L", min: "6.5", max: "10.0", status: "偏低", sourcePage: "第2页", confidence: 94 },
  { group: "血常规", code: "HGB", name: "血红蛋白", value: "83", unit: "g/L", min: "93", max: "153", status: "偏低", sourcePage: "第2页", confidence: 95 },
  { group: "血常规", code: "HCT", name: "红细胞压积", value: "27", unit: "%", min: "30", max: "45", status: "偏低", sourcePage: "第2页", confidence: 94 },
  { group: "血常规", code: "PLT", name: "血小板", value: "410", unit: "10^9/L", min: "300", max: "800", status: "正常", sourcePage: "第2页", confidence: 97 },
  { group: "生化", code: "CREA", name: "肌酐", value: "190", unit: "umol/L", min: "70", max: "165", status: "偏高", sourcePage: "第3页", confidence: 95 },
  { group: "生化", code: "BUN", name: "尿素氮", value: "13", unit: "mmol/L", min: "5.7", max: "12.9", status: "偏高", sourcePage: "第3页", confidence: 93 },
  { group: "生化", code: "ALT", name: "谷丙转氨酶", value: "82", unit: "U/L", min: "12", max: "130", status: "正常", sourcePage: "第3页", confidence: 96 },
  { group: "尿检", code: "USG", name: "尿比重", value: "1.016", unit: "", min: ">1.035", max: "-", status: "偏低", sourcePage: "第3页", confidence: 91 },
  { group: "尿检", code: "PRO", name: "尿蛋白", value: "弱阳性", unit: "", min: "阴性", max: "-", status: "异常", sourcePage: "第3页", confidence: 89 },
];

const INFECTIOUS_MOCK_LABS = [
  { group: "传染病", code: "FIV", name: "猫艾滋", value: "阴性", unit: "", min: "-", max: "-", status: "阴性", sourcePage: "第1页", confidence: 98 },
  { group: "传染病", code: "FeLV", name: "猫白血病", value: "阴性", unit: "", min: "-", max: "-", status: "阴性", sourcePage: "第1页", confidence: 98 },
];

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function shouldUseInfectiousMock(pdfRecord: any) {
  return isInfectiousReportFilename(pdfRecord?.filename)
    || pdfRecord?.templateType === "传染病检测报告"
    || pdfRecord?.mockTemplate === "传染病检测报告";
}

function isUserUploadedReport(pdfRecord: any) {
  return String(pdfRecord?.id || "").startsWith("report_");
}

function inferVisitTypeFromFilename(filename?: string) {
  const normalized = String(filename || "").toLowerCase();
  if (normalized.includes("初诊")) return "初诊";
  if (normalized.includes("复查")) return "复诊";
  if (normalized.includes("体检")) return "体检";
  if (normalized.includes("急诊")) return "急诊";
  return "其他";
}

function createInitialDraft(reportId: string, pdfRecord: any) {
  const catProfile = loadCatProfile();
  const reportDate = pdfRecord?.reportDate || pdfRecord?.date || new Date().toISOString().split("T")[0];
  const mockLabs = shouldUseInfectiousMock(pdfRecord)
    ? [...COMMON_MOCK_LABS, ...INFECTIOUS_MOCK_LABS]
    : COMMON_MOCK_LABS;
  const userUploaded = isUserUploadedReport(pdfRecord);
  const parsedVisitInfo = userUploaded
    ? (pdfRecord?.parsedVisitInfo || parseVisitInfoFromText(pdfRecord?.rawText || "", pdfRecord?.filename, catProfile?.name || "未命名宠物"))
    : null;
  const defaultVisitType = userUploaded
    ? (parsedVisitInfo?.visitType || inferVisitTypeFromFilename(pdfRecord?.filename))
    : "复诊";
  const defaultFollowupText = userUploaded
    ? (parsedVisitInfo?.followupText || "请根据PDF原文补充复查日期和复查项目")
    : "建议 2026-04-29 复查血常规、生化、尿检。";

  return {
    reportId,
    previewUrl: pdfRecord?.previewUrl || "",
    pdfDataUrl: pdfRecord?.pdfDataUrl || "",
    fileSizeBytes: Number(pdfRecord?.fileSizeBytes) || 0,
    fileName: pdfRecord?.fileName || pdfRecord?.filename || "",
    rawText: pdfRecord?.rawText || "",
    textExtractionStatus: pdfRecord?.textExtractionStatus || "",
    textExtractionMessage: pdfRecord?.textExtractionMessage || "",
    visitInfo: {
      catName: userUploaded ? (parsedVisitInfo?.catName || catProfile?.name || "未命名宠物") : (catProfile?.name || "未命名宠物"),
      reportDate: userUploaded ? (parsedVisitInfo?.reportDate || reportDate) : reportDate,
      visitDate: userUploaded ? (parsedVisitInfo?.visitDate || parsedVisitInfo?.reportDate || reportDate) : reportDate,
      hospital: userUploaded ? (parsedVisitInfo?.hospital || "待确认") : "XX动物医院",
      doctor: userUploaded ? (parsedVisitInfo?.doctor || "待确认") : "王医生",
      weight: userUploaded ? (parsedVisitInfo?.weight || "") : (catProfile?.weight ? `${catProfile.weight} kg` : ""),
      temperature: userUploaded ? (parsedVisitInfo?.temperature || "") : "",
      visitType: defaultVisitType,
      chiefComplaint: userUploaded ? (parsedVisitInfo?.chiefComplaint || "请根据PDF原文补充") : "复查血常规、生化及尿检，评估贫血及肾功能相关指标变化",
      complaint: userUploaded ? (parsedVisitInfo?.chiefComplaint || "请根据PDF原文补充") : "复查血常规、生化及尿检，评估贫血及肾功能相关指标变化",
      presentIllness: userUploaded ? (parsedVisitInfo?.presentIllness || "") : "",
      pastHistory: userUploaded ? (parsedVisitInfo?.pastHistory || "") : "",
      doctorNotes: userUploaded ? (parsedVisitInfo?.doctorNotes || "请根据PDF原文补充") : "建议按医嘱继续用药，3-7天后复查",
      notes: userUploaded ? (parsedVisitInfo?.doctorNotes || "请根据PDF原文补充") : "建议按医嘱继续用药，3-7天后复查",
      followupText: defaultFollowupText,
      userNotes: "",
      syncToCatProfile: false,
    },
    labs: mockLabs.map((lab, index) => ({
      id: `${reportId}_lab_${lab.code}_${index + 1}`,
      group: lab.group,
      name: lab.name,
      code: lab.code,
      value: lab.value,
      unit: lab.unit,
      range: `${lab.min} - ${lab.max}`,
      min: lab.min,
      max: lab.max,
      status: lab.status,
      sourcePage: lab.sourcePage,
      confidence: lab.confidence,
      checked: true,
      error: false,
    })),
    imaging: [
      {
        id: `${reportId}_imaging_1`,
        examType: "腹部B超",
        bodyPart: "肾脏、膀胱、腹腔",
        finding: "双肾回声改变，膀胱壁轻度增厚",
        impression: "建议结合肾功能指标、尿检结果进一步评估",
        sourcePage: "第4页",
      }
    ],
    medications: [
      {
        id: `${reportId}_med_1`,
        name: "速诺 50mg",
        drugName: "速诺 50mg",
        time: "08:00",
        dosage: "一次1片 / 饭后",
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
        dosage: "一次1片 / 饭后",
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
        dosage: "一次1粒 / 随餐",
        frequency: "一日1次",
        instruction: "随餐",
        duration: "连续14天",
        status: "pending",
        sourcePage: "第5页",
      }
    ],
    followups: [
      {
        id: `${reportId}_followup_1`,
        title: "复查建议",
        date: userUploaded ? (parsedVisitInfo?.reportDate || reportDate) : "2026-04-29",
        desc: defaultFollowupText,
        items: ["血常规", "生化", "尿检"],
        sourcePage: "第5页",
      }
    ],
    aiSummary: "本次PDF诊疗报告包含复诊信息、血常规、生化、尿检、腹部B超结果及医生医嘱。与2026-04-10初诊报告相比，WBC由28.0下降至16.2，炎症相关指标较前改善；HCT由22上升至27，贫血相关指标有所改善但仍低于参考范围；CREA仍偏高，USG尿比重偏低，建议复诊时结合医生意见继续关注肾功能及尿液浓缩能力。系统已根据医嘱结构化2条用药提醒和1条复查提醒。",
    updatedAt: new Date().toISOString(),
  };
}

function updateRange(min: string, max: string) {
  return `${min || "-"} - ${max || "-"}`;
}

function renderStatusLabel(status: string) {
  if (status === "正常") return <span className="text-slate-400 text-xs">正常</span>;
  if (status === "偏低") return <span className="text-amber-600 font-medium flex items-center text-xs"><AlertTriangle className="h-3 w-3 mr-1" /> 偏低</span>;
  if (status === "偏高") return <span className="text-red-600 font-medium flex items-center text-xs"><AlertTriangle className="h-3 w-3 mr-1" /> 待关注</span>;
  if (status === "异常") return <span className="text-red-600 font-medium text-xs">异常</span>;
  if (status === "阳性") return <span className="text-red-600 font-medium text-xs">阳性</span>;
  if (status === "阴性") return <span className="text-emerald-600 font-medium text-xs">阴性</span>;
  return <span className="text-slate-500 text-xs">{status}</span>;
}

function buildRecognitionFieldSummary(visitInfo: any) {
  const fields = [
    { label: "报告日期", value: visitInfo?.reportDate || visitInfo?.visitDate, pending: !visitInfo?.reportDate && !visitInfo?.visitDate },
    { label: "医院", value: visitInfo?.hospital, pending: !visitInfo?.hospital || visitInfo?.hospital === "待确认" },
    { label: "医生", value: visitInfo?.doctor, pending: !visitInfo?.doctor || visitInfo?.doctor === "待确认" },
    { label: "就诊类型", value: visitInfo?.visitType, pending: !visitInfo?.visitType || visitInfo?.visitType === "其他" },
    { label: "主诉", value: visitInfo?.chiefComplaint, pending: !visitInfo?.chiefComplaint || visitInfo?.chiefComplaint === "请根据PDF原文补充" },
    { label: "现病史", value: visitInfo?.presentIllness, pending: !visitInfo?.presentIllness },
    { label: "既往史", value: visitInfo?.pastHistory, pending: !visitInfo?.pastHistory },
    { label: "体重", value: visitInfo?.weight, pending: !visitInfo?.weight },
    { label: "体温", value: visitInfo?.temperature, pending: !visitInfo?.temperature },
    { label: "医生备注", value: visitInfo?.doctorNotes, pending: !visitInfo?.doctorNotes || visitInfo?.doctorNotes === "请根据PDF原文补充" },
    { label: "复查建议", value: visitInfo?.followupText, pending: !visitInfo?.followupText || visitInfo?.followupText.includes("请根据PDF原文补充") },
  ];

  return {
    recognized: fields.filter((field) => !field.pending).map((field) => field.label),
    pending: fields.filter((field) => field.pending).map((field) => field.label),
  };
}

export default function ReportConfirm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reportId = searchParams.get("reportId") || "";
  const [activeTab, setActiveTab] = useState(TABS[1]);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [pdfRecord, setPdfRecord] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [cachedPdfUrl, setCachedPdfUrl] = useState("");

  useEffect(() => {
    if (!reportId) return;

    const pdf = loadPdfRecord(reportId);
    const savedDraft = loadReportDraft(reportId);
    setPdfRecord(pdf);
    setDraft(savedDraft || createInitialDraft(reportId, pdf));
  }, [reportId]);

  useEffect(() => {
    if (!reportId || draft?.pdfDataUrl || pdfRecord?.pdfDataUrl) {
      setCachedPdfUrl("");
      return;
    }

    let cancelled = false;
    let objectUrl = "";
    void loadPdfBlob(reportId).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setCachedPdfUrl(objectUrl);
    }).catch((error) => {
      console.warn("loadPdfBlob failed", reportId, error);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reportId, draft?.pdfDataUrl, pdfRecord?.pdfDataUrl]);

  const displayToast = (msg: string) => {
    setToastMsg(msg);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 2000);
  };

  const updateDraftLabs = (updater: (labs: any[]) => any[]) => {
    setDraft((current: any) => {
      if (!current) return current;
      return {
        ...current,
        labs: updater(current.labs),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const updateDraftMedications = (updater: (meds: any[]) => any[]) => {
    setDraft((current: any) => {
      if (!current) return current;
      return {
        ...current,
        medications: updater(current.medications || []),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [medDraft, setMedDraft] = useState<{ drugName: string; dosage: string; frequency: string; instruction: string; duration: string }>(
    { drugName: "", dosage: "", frequency: "", instruction: "", duration: "" }
  );

  const startEditMed = (med: any) => {
    setEditingMedId(med.id);
    setMedDraft({
      drugName: String(med.drugName || med.name || ""),
      dosage: String(med.dosage || ""),
      frequency: String(med.frequency || ""),
      instruction: String(med.instruction || ""),
      duration: String(med.duration || ""),
    });
  };

  const cancelEditMed = () => setEditingMedId(null);

  const saveEditMed = (id: string) => {
    const name = medDraft.drugName.trim();
    if (!name) {
      alert("药名不能为空");
      return;
    }
    updateDraftMedications((meds) =>
      meds.map((med: any) =>
        med.id === id
          ? {
              ...med,
              drugName: name,
              name,
              dosage: medDraft.dosage.trim(),
              frequency: medDraft.frequency.trim(),
              instruction: medDraft.instruction.trim(),
              duration: medDraft.duration.trim(),
              editedByUser: true,
            }
          : med
      )
    );
    setEditingMedId(null);
  };

  const deleteDraftMed = (id: string) => {
    if (!window.confirm("确认删除这条医嘱？\n（仅从当前确认稿中移除，不影响 PDF 原文）")) return;
    updateDraftMedications((meds) => meds.filter((med: any) => med.id !== id));
    if (editingMedId === id) setEditingMedId(null);
  };

  const updateVisitInfo = (field: string, value: any) => {
    setDraft((current: any) => {
      if (!current) return current;

      const nextVisitInfo = {
        ...current.visitInfo,
        [field]: value,
      };

      if (field === "reportDate") {
        nextVisitInfo.visitDate = value;
      }
      if (field === "chiefComplaint") {
        nextVisitInfo.complaint = value;
      }
      if (field === "doctorNotes") {
        nextVisitInfo.notes = value;
      }

      const nextFollowups = field === "followupText" && Array.isArray(current.followups)
        ? current.followups.map((followup: any, index: number) => (
            index === 0 ? { ...followup, desc: value } : followup
          ))
        : current.followups;

      return {
        ...current,
        visitInfo: nextVisitInfo,
        followups: nextFollowups,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleToggleAll = () => {
    if (!draft) return;
    const selectableLabs = draft.labs.filter((lab: any) => !lab.error);
    const allChecked = selectableLabs.length > 0 && selectableLabs.every((lab: any) => lab.checked);
    updateDraftLabs((labs) => labs.map((lab: any) => (
      lab.error ? { ...lab, checked: false } : { ...lab, checked: !allChecked }
    )));
  };

  const handleLabChange = (index: number, field: string, value: string) => {
    updateDraftLabs((labs) =>
      labs.map((lab: any, labIndex: number) => {
        if (labIndex !== index) return lab;
        const nextLab = { ...lab, [field]: value };
        if (field === "min" || field === "max") {
          nextLab.range = updateRange(field === "min" ? value : nextLab.min, field === "max" ? value : nextLab.max);
        }
        return nextLab;
      })
    );
  };

  const handleToggleLabChecked = (index: number) => {
    updateDraftLabs((labs) =>
      labs.map((lab: any, labIndex: number) => {
        if (labIndex !== index) return lab;
        if (lab.error) return { ...lab, checked: false };
        return { ...lab, checked: !lab.checked };
      })
    );
  };

  const handleToggleLabError = (index: number) => {
    updateDraftLabs((labs) =>
      labs.map((lab: any, labIndex: number) => {
        if (labIndex !== index) return lab;
        if (lab.error) {
          return { ...lab, error: false, checked: false };
        }
        return { ...lab, error: true, checked: false };
      })
    );
  };

  const handleMarkError = () => {
    if (!draft) return;
    const hasChecked = draft.labs.some((lab: any) => lab.checked);
    if (!hasChecked) return;

    updateDraftLabs((labs) => labs.map((lab: any) => lab.checked ? { ...lab, error: true, checked: false } : lab));
    displayToast("已标记为识别有误，该指标不会入库。");
  };

  const handleSaveDraft = () => {
    if (!draft || !reportId) return;
    const savedDraft = saveReportDraft(draft);
    const extracted = buildExtractedCountsFromDraft(savedDraft);
    const updatedPdf = updatePdfStatus(reportId, "待确认", {
      filename: pdfRecord?.filename,
      fileName: pdfRecord?.fileName || pdfRecord?.filename,
      size: pdfRecord?.size,
      uploadTime: pdfRecord?.uploadTime,
      reportDate: savedDraft.visitInfo.reportDate || savedDraft.visitInfo.visitDate,
      previewUrl: savedDraft.previewUrl || pdfRecord?.previewUrl,
      pdfDataUrl: savedDraft.pdfDataUrl || pdfRecord?.pdfDataUrl,
      fileSizeBytes: savedDraft.fileSizeBytes || pdfRecord?.fileSizeBytes,
      rawText: savedDraft.rawText || pdfRecord?.rawText,
      textExtractionStatus: savedDraft.textExtractionStatus || pdfRecord?.textExtractionStatus,
      textExtractionMessage: savedDraft.textExtractionMessage || pdfRecord?.textExtractionMessage,
      parsedVisitInfo: savedDraft.visitInfo,
      extracted,
    });

    setPdfRecord(updatedPdf);
    setDraft(savedDraft);
    displayToast("解析结果已保存为草稿，可稍后继续确认。");
    setTimeout(() => navigate("/reports"), 600);
  };

  const handleConfirm = () => {
    if (!draft || !reportId) return;
    const result = confirmReportDraft(reportId, draft);
    setPdfRecord(result.pdf);
    setDraft(result.draft);
    displayToast("PDF已解析并入库，已同步更新指标趋势、用药提醒和健康时间线。");
    setTimeout(() => navigate("/reports"), 600);
  };

  if (!reportId) {
    return (
      <div className="space-y-6">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">PDF结构化结果确认</h2>
        </div>
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <p className="text-slate-600">缺少 reportId，无法恢复对应的解析结果。</p>
            <Button onClick={() => navigate("/reports")}>返回 PDF 报告中心</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!draft) return null;

  const fileInfo = {
    filename: pdfRecord?.fileName || pdfRecord?.filename || draft.fileName || "未命名报告.pdf",
    date: draft.visitInfo.reportDate || draft.visitInfo.visitDate || pdfRecord?.reportDate || pdfRecord?.date || new Date().toISOString().split("T")[0],
    size: pdfRecord?.size || "-",
  };
  const groupedLabs = Array.from(new Set(draft.labs.map((lab: any) => lab.group)));
  const previewSource = draft.pdfDataUrl || pdfRecord?.pdfDataUrl || cachedPdfUrl || "";
  const previewFileSize = draft.fileSizeBytes || pdfRecord?.fileSizeBytes || 0;
  const hasExtractedRawText = Boolean((draft.rawText || pdfRecord?.rawText || "").trim());
  const rawTextLength = String(draft.rawText || pdfRecord?.rawText || "").length;
  const recognitionSummary = buildRecognitionFieldSummary(draft.visitInfo);
  const previewFallbackText = previewFileSize > 0 && !draft.pdfDataUrl && !pdfRecord?.pdfDataUrl && !cachedPdfUrl
    ? "当前仅保留PDF文件信息，未找到可预览原文缓存。请重新上传PDF以查看原文。"
    : "当前仅保留PDF文件信息，未保存可预览原文。请重新上传PDF以查看原文。";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">PDF结构化结果确认</h2>
          <p className="text-sm text-slate-500 mt-1 flex items-center">
            <FileText className="w-4 h-4 mr-1.5" /> {fileInfo.date} {fileInfo.filename}
          </p>
        </div>
        <div className="flex space-x-3">
          <Button variant="outline" className="gap-2" onClick={() => navigate("/reports")}>
            <ArrowLeft className="h-4 w-4" /> 返回
          </Button>
          <Button variant="outline" onClick={handleSaveDraft}>保存草稿</Button>
          <Button onClick={handleConfirm} className="gap-2 bg-blue-600 hover:bg-blue-700"><CheckCircle2 className="h-4 w-4" /> 确认入库</Button>
        </div>
      </div>

      {showToast && (
        <div className="fixed top-6 right-6 bg-green-50 text-green-800 border border-green-200 px-6 py-4 rounded-lg shadow-lg flex items-center z-50 animate-in slide-in-from-top-4">
          <CheckCircle2 className="h-5 w-5 mr-3 text-green-600" />
          <p className="font-medium text-sm">{toastMsg}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-4 h-full flex flex-col">
          <Card className="h-[650px] overflow-hidden flex flex-col border-slate-200 shadow-sm">
            <CardHeader className="py-3 border-b bg-slate-50 sticky top-0 z-10 space-y-3">
              <div className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm text-slate-700 flex items-center"><LayoutTemplate className="w-4 h-4 mr-2" /> 原文预览</CardTitle>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p className="font-medium text-slate-700 truncate">{fileInfo.filename}</p>
                <p>报告日期：{fileInfo.date}</p>
                <p>上传时间：{formatDateTime(pdfRecord?.uploadTime)}</p>
                <p>解析状态：{pdfRecord?.status || "待确认"}</p>
              </div>
            </CardHeader>
            <CardContent className="p-0 bg-slate-100 flex-1 overflow-hidden relative">
              {previewSource ? (
                <PdfPreview src={previewSource} filename={fileInfo.filename} className="h-full" />
              ) : (
                <div className="h-full flex items-center justify-center p-6 text-center text-sm text-slate-500 leading-relaxed">
                  {previewFallbackText}
                </div>
              )}
            </CardContent>
            <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 text-xs text-slate-500 text-center">
              {previewFileSize > 0 && !draft.pdfDataUrl && !pdfRecord?.pdfDataUrl && !cachedPdfUrl
                ? "未找到可预览原文缓存；请重新上传PDF后查看原文。当前阶段仅预览PDF原文；扫描型PDF需要OCR/多模态模型才能自动提取内容。"
                : "当前阶段仅预览PDF原文；扫描型PDF需要OCR/多模态模型才能自动提取内容。"}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-8 h-full flex flex-col min-h-0">
          <div className="flex space-x-1 bg-slate-100 p-1 rounded-t-xl border border-b-0 border-slate-200">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex-1 ${activeTab === tab ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <Card className="flex-1 overflow-hidden flex flex-col rounded-t-none border-t-0 shadow-sm h-[600px]">
            <CardContent className="p-0 overflow-auto flex-1 bg-white">
              {activeTab === "就诊信息" && (
                <div className="p-6 space-y-4">
                  <div className={`rounded-lg border px-4 py-3 text-sm ${hasExtractedRawText ? "bg-blue-50 border-blue-100 text-blue-800" : "bg-amber-50 border-amber-100 text-amber-800"}`}>
                    <p className="font-semibold">PDF识别状态</p>
                    {hasExtractedRawText ? (
                      <div className="mt-2 space-y-1 text-xs leading-relaxed">
                        <p>{draft.textExtractionMessage || pdfRecord?.textExtractionMessage || "已从文本型PDF中提取到文字，系统已尝试自动识别就诊信息。"}</p>
                        <p>提取文字长度：{rawTextLength} 字</p>
                        <p>已自动填充字段：{recognitionSummary.recognized.length > 0 ? recognitionSummary.recognized.join("、") : "暂无"}</p>
                        <p>待确认字段：{recognitionSummary.pending.length > 0 ? recognitionSummary.pending.join("、") : "暂无"}</p>
                      </div>
                    ) : (
                      <div className="mt-2 space-y-1 text-xs leading-relaxed">
                        <p>{draft.textExtractionMessage || pdfRecord?.textExtractionMessage || "当前PDF可能是扫描件或图片型PDF，本地文本解析无法识别。请对照左侧PDF原文手动校对结构化结果。后续可接入OCR或多模态模型实现自动识别。"}</p>
                        <p>需要OCR/多模态识别，当前为人工校对模式。</p>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">猫咪姓名</label>
                      <input
                        className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                        value={draft.visitInfo.catName || ""}
                        onChange={(e) => updateVisitInfo("catName", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">报告日期 / 就诊日期</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                        value={draft.visitInfo.reportDate || draft.visitInfo.visitDate}
                        onChange={(e) => updateVisitInfo("reportDate", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">医院名称</label>
                      <input
                        className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                        value={draft.visitInfo.hospital || ""}
                        onChange={(e) => updateVisitInfo("hospital", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">医生姓名</label>
                      <input
                        className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                        value={draft.visitInfo.doctor || ""}
                        onChange={(e) => updateVisitInfo("doctor", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">体重</label>
                      <input
                        className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                        value={draft.visitInfo.weight || ""}
                        onChange={(e) => updateVisitInfo("weight", e.target.value)}
                        placeholder="例如 3.1 kg"
                      />
                    </div>
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">就诊类型</label>
                      <select
                        className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                        value={draft.visitInfo.visitType || "其他"}
                        onChange={(e) => updateVisitInfo("visitType", e.target.value)}
                      >
                        {VISIT_TYPES.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">体温</label>
                      <input
                        className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                        value={draft.visitInfo.temperature || ""}
                        onChange={(e) => updateVisitInfo("temperature", e.target.value)}
                        placeholder="例如 38.5℃"
                      />
                    </div>
                    <div className="col-span-2 space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">上传时间</label>
                      <div className="text-sm font-medium text-slate-900">{formatDateTime(pdfRecord?.uploadTime)}</div>
                    </div>
                    <div className="col-span-2 space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">主诉</label>
                      <textarea
                        className="w-full min-h-[88px] px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none resize-y"
                        value={draft.visitInfo.chiefComplaint || draft.visitInfo.complaint || ""}
                        onChange={(e) => updateVisitInfo("chiefComplaint", e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">现病史</label>
                      <textarea
                        className="w-full min-h-[88px] px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none resize-y"
                        value={draft.visitInfo.presentIllness || ""}
                        onChange={(e) => updateVisitInfo("presentIllness", e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">既往史</label>
                      <textarea
                        className="w-full min-h-[88px] px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none resize-y"
                        value={draft.visitInfo.pastHistory || ""}
                        onChange={(e) => updateVisitInfo("pastHistory", e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">医生备注</label>
                      <textarea
                        className="w-full min-h-[88px] px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none resize-y"
                        value={draft.visitInfo.doctorNotes || draft.visitInfo.notes || ""}
                        onChange={(e) => updateVisitInfo("doctorNotes", e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">复查建议</label>
                      <textarea
                        className="w-full min-h-[72px] px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none resize-y"
                        value={draft.visitInfo.followupText || ""}
                        onChange={(e) => updateVisitInfo("followupText", e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-1 border-b border-slate-100 pb-3">
                      <label className="text-xs font-semibold text-slate-500">用户备注</label>
                      <textarea
                        className="w-full min-h-[72px] px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none resize-y"
                        value={draft.visitInfo.userNotes || ""}
                        onChange={(e) => updateVisitInfo("userNotes", e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
                      <label className="flex items-center gap-3 text-slate-700">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={Boolean(draft.visitInfo.syncToCatProfile)}
                          onChange={(e) => updateVisitInfo("syncToCatProfile", e.target.checked)}
                        />
                        将本次医院和医生同步到猫咪档案
                      </label>
                    </div>
                    <div className="col-span-2 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-800 leading-relaxed">
                      当前信息由PDF结构化结果生成，请以医院PDF原文为准，可在入库前手动修正。
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "检验指标" && (
                <div className="flex flex-col h-full">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center justify-between sticky top-0 z-20 shadow-sm">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                        checked={draft.labs.length > 0 && draft.labs.every((lab: any) => lab.checked)}
                        onChange={handleToggleAll}
                        title="全部确认"
                      />
                      <span className="text-sm font-medium text-slate-700">全选识别结果</span>
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700" onClick={handleMarkError}>
                        <XCircle className="w-3.5 h-3.5 mr-1" /> 标记识别有误
                      </Button>
                    </div>
                  </div>
                  <div className="px-4 py-3 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
                    以下结构化结果为演示解析结果，请对照PDF原文确认后再入库。
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left">
                      <tbody className="divide-y divide-slate-100">
                        {groupedLabs.map(group => (
                          <React.Fragment key={group}>
                            <tr className="bg-slate-50/50">
                              <td colSpan={8} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100/50">{group}</td>
                            </tr>
                            {draft.labs.map((item: any, i: number) => item.group === group && (
                              <tr key={item.id} className={`transition-colors ${item.error ? "bg-red-50 hover:bg-red-100" : (!item.checked ? "bg-slate-50 opacity-50" : "hover:bg-slate-50")}`}>
                                <td className="px-4 py-2.5 w-10">
                                  <input
                                    type="checkbox"
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={item.checked}
                                    onChange={() => handleToggleLabChecked(i)}
                                    disabled={item.error}
                                  />
                                </td>
                                <td className="px-4 py-2.5 font-medium text-slate-900">
                                  {item.name} <span className="text-slate-400 font-normal ml-1">({item.code})</span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <input
                                    className={`w-16 px-1.5 py-1 border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded bg-transparent ${item.status !== "正常" ? "font-bold" : ""}`}
                                    value={item.value}
                                    onChange={(e) => handleLabChange(i, "value", e.target.value)}
                                    disabled={!item.checked || item.error}
                                  />
                                </td>
                                <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">
                                  <input
                                    className="w-16 px-1.5 py-1 border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded bg-transparent text-sm"
                                    value={item.unit}
                                    onChange={(e) => handleLabChange(i, "unit", e.target.value)}
                                    disabled={!item.checked || item.error}
                                  />
                                </td>
                                <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell text-xs">
                                  <div className="flex items-center space-x-1">
                                    <input
                                      className="w-12 px-1 py-1 border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded bg-transparent"
                                      value={item.min}
                                      onChange={(e) => handleLabChange(i, "min", e.target.value)}
                                      disabled={!item.checked || item.error}
                                    />
                                    <span>-</span>
                                    <input
                                      className="w-12 px-1 py-1 border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded bg-transparent"
                                      value={item.max}
                                      onChange={(e) => handleLabChange(i, "max", e.target.value)}
                                      disabled={!item.checked || item.error}
                                    />
                                  </div>
                                </td>
                                <td className="px-4 py-2.5">
                                  {item.error ? (
                                    <span className="text-red-600 font-bold text-xs flex items-center"><XCircle className="h-3 w-3 mr-1" /> 识别有误</span>
                                  ) : (
                                    renderStatusLabel(item.status)
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right flex flex-col items-end">
                                  <Badge variant="outline" className="text-[10px] py-0 font-normal">{item.sourcePage}</Badge>
                                  <span className="text-[10px] text-green-600 mt-0.5">{item.confidence}%</span>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className={`h-7 text-xs ${item.error ? "text-slate-600" : "text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"}`}
                                    onClick={() => handleToggleLabError(i)}
                                  >
                                    {item.error ? "取消误标" : "标记有误"}
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === "影像报告" && (
                <div className="p-6 space-y-6">
                  {draft.imaging.map((item: any) => (
                    <div key={item.id} className="bg-white border text-sm border-slate-200 rounded-lg p-4 shadow-sm relative">
                      <Badge className="absolute right-4 top-4 bg-slate-100 text-slate-600 border-none font-normal">{item.sourcePage}</Badge>
                      <div className="grid grid-cols-4 gap-4">
                        <div className="col-span-1 text-slate-500 font-medium text-right">检查类型：</div>
                        <div className="col-span-3 text-slate-900 font-medium">{item.examType}</div>
                        <div className="col-span-1 text-slate-500 font-medium text-right">检查部位：</div>
                        <div className="col-span-3 text-slate-900">{item.bodyPart}</div>
                        <div className="col-span-1 text-slate-500 font-medium text-right">影像所见：</div>
                        <div className="col-span-3 text-slate-900 leading-relaxed bg-slate-50 p-2 rounded border border-slate-100">{item.finding}</div>
                        <div className="col-span-1 text-slate-500 font-medium text-right">影像提示：</div>
                        <div className="col-span-3 text-amber-700 font-medium leading-relaxed bg-amber-50 p-2 rounded border border-amber-100">{item.impression}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "医嘱处方" && (
                <div className="p-6 space-y-4">
                  {draft.medications.length === 0 && (
                    <div className="text-center py-8 text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      暂无医嘱。如有遗漏的药物，可在确认入库后到"医嘱与提醒"页继续手动添加。
                    </div>
                  )}
                  {draft.medications.map((med: any) => {
                    const isEditing = editingMedId === med.id;
                    return (
                    <div key={med.id} className="bg-white border text-sm border-slate-200 rounded-lg p-4 shadow-sm relative">
                      <Badge className="absolute right-4 top-4 bg-blue-50 text-blue-700 font-normal">已生成提醒</Badge>
                      {isEditing ? (
                        <div className="space-y-3 pr-24">
                          <label className="block">
                            <span className="block text-xs font-semibold text-slate-500 mb-1">药名</span>
                            <input
                              type="text"
                              value={medDraft.drugName}
                              onChange={(e) => setMedDraft({ ...medDraft, drugName: e.target.value })}
                              placeholder="药物名称，如 马波沙星"
                              className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <span className="block text-xs font-semibold text-slate-500 mb-1">剂量</span>
                              <input
                                type="text"
                                value={medDraft.dosage}
                                onChange={(e) => setMedDraft({ ...medDraft, dosage: e.target.value })}
                                placeholder="如 0.5 片"
                                className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </label>
                            <label className="block">
                              <span className="block text-xs font-semibold text-slate-500 mb-1">频次</span>
                              <input
                                type="text"
                                value={medDraft.frequency}
                                onChange={(e) => setMedDraft({ ...medDraft, frequency: e.target.value })}
                                placeholder="如 每日 2 次"
                                className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </label>
                            <label className="block">
                              <span className="block text-xs font-semibold text-slate-500 mb-1">条件 / 备注</span>
                              <input
                                type="text"
                                value={medDraft.instruction}
                                onChange={(e) => setMedDraft({ ...medDraft, instruction: e.target.value })}
                                placeholder="如 餐后服用"
                                className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </label>
                            <label className="block">
                              <span className="block text-xs font-semibold text-slate-500 mb-1">疗程</span>
                              <input
                                type="text"
                                value={medDraft.duration}
                                onChange={(e) => setMedDraft({ ...medDraft, duration: e.target.value })}
                                placeholder="如 7 天"
                                className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </label>
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={cancelEditMed}>取消</Button>
                            <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 gap-1" onClick={() => saveEditMed(med.id)}><Save className="h-3 w-3"/>保存</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="font-semibold text-slate-900 text-base mb-2">
                            {med.drugName}
                            {med.editedByUser && <span className="ml-2 text-[11px] text-blue-600 font-normal">· 已手动修正</span>}
                          </p>
                          <div className="grid grid-cols-2 gap-y-2 text-slate-700">
                            <div><span className="text-slate-500">剂量：</span>{String(med.dosage || "").split(" / ")[0] || med.dosage || "--"}</div>
                            <div><span className="text-slate-500">频次：</span>{med.frequency || "按医嘱"}</div>
                            <div><span className="text-slate-500">条件：</span>{med.instruction || "--"}</div>
                            <div><span className="text-slate-500">疗程：</span>{med.duration || "--"}</div>
                          </div>
                        </>
                      )}
                      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-400 truncate">来源：{med.sourcePage || "--"}</span>
                        {!isEditing && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditMed(med)}
                              className="flex items-center gap-1 px-2 py-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="编辑药物信息（OCR 识别不准时使用）"
                            >
                              <Pencil className="h-3 w-3" /> 编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteDraftMed(med.id)}
                              className="flex items-center gap-1 px-2 py-1 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="从本次确认稿中移除"
                            >
                              <Trash2 className="h-3 w-3" /> 删除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}

                  {draft.followups.map((item: any) => (
                    <div key={item.id} className="bg-amber-50 border text-sm border-amber-200 rounded-lg p-4 relative">
                      <Badge className="absolute right-4 top-4 bg-amber-100 text-amber-700 font-normal">复查提醒</Badge>
                      <p className="font-semibold text-amber-900 text-base mb-2">{item.title}</p>
                      <p className="text-amber-800">{item.desc}</p>
                      <p className="text-xs text-amber-600/60 mt-3 pt-3 border-t border-amber-200/50">来源：{item.sourcePage}</p>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "AI解析摘要" && (
                <div className="p-6 space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-blue-900 mb-2">报告结构化摘要</h3>
                    <p className="text-sm text-slate-700 leading-relaxed bg-blue-50 p-4 rounded-lg border border-blue-100">
                      {draft.aiSummary}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-amber-900 mb-2">复诊建议沟通问题清单</h3>
                    <ul className="list-decimal pl-5 space-y-2 text-sm text-amber-800 bg-amber-50 p-4 rounded-lg border border-amber-100">
                      <li>WBC下降是否说明炎症控制符合预期？</li>
                      <li>HCT和HGB虽有回升，但仍偏低，是否需要继续观察贫血原因？</li>
                      <li>CREA偏高与USG偏低是否需要进一步评估肾功能？</li>
                      <li>是否需要增加SDMA、UPC等检查？</li>
                      <li>当前速诺疗程结束后是否需要复查或调整方案？</li>
                    </ul>
                  </div>
                  <Disclaimer />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
