import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { UploadCloud, FileText, ChevronRight, CheckCircle2, AlertCircle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "../components/ui";
import { extractPdfTextFromFile, parseVisitInfoFromText } from "../lib/pdfParser";
import { getParseJob, getParseResult, type ParseJobStatus, uploadReportForParse } from "../lib/reportParseClient";
import { buildExtractedCountsFromDraft, STORE_UPDATED_EVENT, clearReportTestData, createPdfRecord, createReportId, deleteReport, isInfectiousReportFilename, loadCatProfile, loadDataForCurrentPet as loadData, loadCurrentPet, saveReportDraft, updatePdfStatus, upsertPdfRecord } from "../lib/store";
import { clearPdfBlobStore, deletePdfBlob, loadPdfBlob, savePdfBlob } from "../lib/pdfBlobStore";

const MAX_PDF_DATA_URL_BYTES = 4 * 1024 * 1024;

const PARSE_STEPS = [
  "正在读取PDF内容...",
  "正在识别就诊信息...",
  "正在提取检验指标...",
  "正在识别影像报告...",
  "正在拆解医嘱处方...",
  "正在生成健康摘要...",
  "解析完成，准备结构化呈现"
];

const BACKEND_STATUS_TO_STEP: Record<ParseJobStatus, number> = {
  uploaded: 0,
  rasterizing: 1,
  ocr_running: 2,
  llm_running: 5,
  validating: 6,
  ready: 6,
  failed: 0,
};

function buildInitialExtracted(filename: string) {
  return {
    visitCount: 1,
    labCount: isInfectiousReportFilename(filename) ? 12 : 10,
    imagingCount: 1,
    medicationCount: 2,
    followupCount: 1,
  };
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlaceholderValue(value: any) {
  return value === undefined
    || value === null
    || value === ""
    || value === "待确认"
    || value === "请根据PDF原文补充"
    || value === "请根据PDF原文补充复查日期和复查项目";
}

type SelectedUploadItem = {
  file: File;
  reportId: string;
  previewUrl: string;
  pdfDataUrl: string;
  fileSizeBytes: number;
  rawText: string;
  textExtractionStatus: string;
  textExtractionMessage: string;
  parsedVisitInfo: any;
  pageImages: string[];
  uploadStatus: "ready" | "parsing" | "done" | "failed";
  uploadMessage?: string;
};

function sortPdfsByReportDate(list: any[]): any[] {
  // 按 reportDate 倒序（最新报告在前）；缺日期的退化为 uploadTime
  return [...list].sort((a, b) => {
    const ad = String(a.reportDate || a.date || a.uploadTime || "").trim();
    const bd = String(b.reportDate || b.date || b.uploadTime || "").trim();
    if (ad && bd) return bd.localeCompare(ad);
    if (ad) return -1;
    if (bd) return 1;
    return 0;
  });
}

function getParseConcurrency(items: SelectedUploadItem[]) {
  const hasScannedPdf = items.some((item) => item.pageImages.length > 0 || item.textExtractionStatus !== "success");
  return hasScannedPdf ? 1 : 3;
}

function hasUsefulStructuredResult(result: any) {
  const visitInfo = result?.visitInfo || {};
  const hasCollections = [result?.labs, result?.imaging, result?.medications, result?.followups]
    .some((items) => Array.isArray(items) && items.length > 0);
  const hasVisitDetails = [
    visitInfo.hospital,
    visitInfo.doctor,
    visitInfo.weight,
    visitInfo.temperature,
    visitInfo.chiefComplaint,
    visitInfo.presentIllness,
    visitInfo.pastHistory,
    visitInfo.doctorNotes,
    visitInfo.followupText,
  ].some((value) => !isPlaceholderValue(value));
  return hasCollections || hasVisitDetails;
}

function isEmptyParsedPdf(doc: any) {
  const extracted = doc?.extracted || {};
  const total = Number(extracted.visitCount || 0)
    + Number(extracted.labCount || 0)
    + Number(extracted.imagingCount || 0)
    + Number(extracted.medicationCount || 0)
    + Number(extracted.followupCount || 0);
  return doc?.status === "待确认" && total === 0;
}

export default function Reports() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedUploads, setSelectedUploads] = useState<SelectedUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [pdfs, setPdfs] = useState<any[]>(() => sortPdfsByReportDate(loadData().pdfs || []));
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  useEffect(() => {
    const handleStoreUpdated = () => setPdfs(sortPdfsByReportDate(loadData().pdfs || []));
    window.addEventListener(STORE_UPDATED_EVENT, handleStoreUpdated);
    return () => window.removeEventListener(STORE_UPDATED_EVENT, handleStoreUpdated);
  }, []);

  const displayToast = (msg: string) => {
    setToastMsg(msg);
    setShowToast(true);
    window.setTimeout(() => {
      setShowToast(false);
    }, 2000);
  };

  const preprocessOneFile = async (file: File): Promise<SelectedUploadItem> => {
    const previewUrl = URL.createObjectURL(file);
    const fileSizeBytes = file.size;
    let pdfDataUrl = "";
    const { rawText, textExtractionStatus, textExtractionMessage } = await extractPdfTextFromFile(file);
    const catProfile = loadCatProfile();
    const currentPet = loadCurrentPet();
    const parsedVisitInfo = parseVisitInfoFromText(rawText, file.name, currentPet?.name || catProfile?.name || "");

    // 扫描件页面渲染/OCR 统一交给后端 Python 服务处理，避免前端生成 20 页 base64 导致上传慢和 localStorage 压力。
    const pageImages: string[] = [];

    if (fileSizeBytes <= MAX_PDF_DATA_URL_BYTES) {
      try {
        pdfDataUrl = await fileToDataUrl(file);
      } catch (error) {
        console.error(error);
      }
    }

    return {
      file,
      reportId: createReportId(),
      previewUrl,
      pdfDataUrl,
      fileSizeBytes,
      rawText,
      textExtractionStatus,
      textExtractionMessage,
      parsedVisitInfo,
      pageImages,
      uploadStatus: "ready",
    };
  };

  const handleSelectFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const items = await Promise.all(files.map((f) => preprocessOneFile(f)));
    setSelectedUploads((prev) => [...prev, ...items]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    void handleSelectFiles(Array.from(files));
    // 清空 input value，允许下次选相同文件
    e.target.value = "";
  };

  const removeSelectedUpload = (reportId: string) => {
    setSelectedUploads((prev) => prev.filter((item) => item.reportId !== reportId));
  };

  const retryQueuedItem = (reportId: string) => {
    setSelectedUploads((prev) =>
      prev.map((item) =>
        item.reportId === reportId ? { ...item, uploadStatus: "ready", uploadMessage: undefined } : item
      )
    );
  };

  const buildBackendDraft = (backendResult: any, upload: SelectedUploadItem) => {
    const fallbackVisitInfo = upload.parsedVisitInfo || {};
    const mergedVisitInfo = {
      ...backendResult?.visitInfo,
      catName: isPlaceholderValue(backendResult?.visitInfo?.catName) ? (fallbackVisitInfo.catName || "未命名宠物") : backendResult.visitInfo.catName,
      reportDate: isPlaceholderValue(backendResult?.visitInfo?.reportDate) ? (fallbackVisitInfo.reportDate || new Date().toISOString().split("T")[0]) : backendResult.visitInfo.reportDate,
      visitDate: isPlaceholderValue(backendResult?.visitInfo?.visitDate) ? (fallbackVisitInfo.visitDate || fallbackVisitInfo.reportDate || backendResult?.visitInfo?.reportDate || new Date().toISOString().split("T")[0]) : backendResult.visitInfo.visitDate,
      hospital: isPlaceholderValue(backendResult?.visitInfo?.hospital) ? (fallbackVisitInfo.hospital || "待确认") : backendResult.visitInfo.hospital,
      doctor: isPlaceholderValue(backendResult?.visitInfo?.doctor) ? (fallbackVisitInfo.doctor || "待确认") : backendResult.visitInfo.doctor,
      chiefComplaint: isPlaceholderValue(backendResult?.visitInfo?.chiefComplaint) ? (fallbackVisitInfo.chiefComplaint || "请根据PDF原文补充") : backendResult.visitInfo.chiefComplaint,
      complaint: isPlaceholderValue(backendResult?.visitInfo?.complaint) ? (fallbackVisitInfo.chiefComplaint || "请根据PDF原文补充") : backendResult.visitInfo.complaint,
      presentIllness: isPlaceholderValue(backendResult?.visitInfo?.presentIllness) ? (fallbackVisitInfo.presentIllness || "") : backendResult.visitInfo.presentIllness,
      pastHistory: isPlaceholderValue(backendResult?.visitInfo?.pastHistory) ? (fallbackVisitInfo.pastHistory || "") : backendResult.visitInfo.pastHistory,
      weight: isPlaceholderValue(backendResult?.visitInfo?.weight) ? (fallbackVisitInfo.weight || "") : backendResult.visitInfo.weight,
      temperature: isPlaceholderValue(backendResult?.visitInfo?.temperature) ? (fallbackVisitInfo.temperature || "") : backendResult.visitInfo.temperature,
      doctorNotes: isPlaceholderValue(backendResult?.visitInfo?.doctorNotes) ? (fallbackVisitInfo.doctorNotes || "请根据PDF原文补充") : backendResult.visitInfo.doctorNotes,
      notes: isPlaceholderValue(backendResult?.visitInfo?.notes) ? (fallbackVisitInfo.doctorNotes || "请根据PDF原文补充") : backendResult.visitInfo.notes,
      followupText: isPlaceholderValue(backendResult?.visitInfo?.followupText) ? (fallbackVisitInfo.followupText || "请根据PDF原文补充复查日期和复查项目") : backendResult.visitInfo.followupText,
      userNotes: backendResult?.visitInfo?.userNotes || "",
      syncToCatProfile: false,
    };

    return {
      ...backendResult,
      reportId: upload.reportId,
      fileName: upload.file.name,
      previewUrl: upload.previewUrl,
      pdfDataUrl: upload.pdfDataUrl,
      fileSizeBytes: upload.fileSizeBytes,
      rawText: upload.rawText,
      textExtractionStatus: upload.textExtractionStatus,
      textExtractionMessage: upload.textExtractionMessage,
      visitInfo: mergedVisitInfo,
      updatedAt: new Date().toISOString(),
    };
  };

  const completeLocalMockFlow = async (upload: SelectedUploadItem) => {
    updatePdfStatus(upload.reportId, "待确认", {
      extracted: buildInitialExtracted(upload.file.name),
      parsedAt: new Date().toISOString(),
      previewUrl: upload.previewUrl,
      pdfDataUrl: upload.pdfDataUrl,
      fileSizeBytes: upload.fileSizeBytes,
      rawText: upload.rawText,
      textExtractionStatus: upload.textExtractionStatus,
      textExtractionMessage: upload.textExtractionMessage,
      parsedVisitInfo: upload.parsedVisitInfo,
    });
  };

  const updateItemStatus = (reportId: string, status: SelectedUploadItem["uploadStatus"], message?: string) => {
    setSelectedUploads((prev) =>
      prev.map((item) => (item.reportId === reportId ? { ...item, uploadStatus: status, uploadMessage: message } : item))
    );
  };

  // 处理单个文件的完整解析流程；不抛错，结果直接更新到 selectedUploads
  const parseOneFile = async (upload: SelectedUploadItem) => {
    const uploadTime = new Date().toISOString();
    try {
      await savePdfBlob(upload.reportId, upload.file);
    } catch (error) {
      console.warn("savePdfBlob failed", upload.file.name, error);
    }
    upsertPdfRecord(
      createPdfRecord({
        id: upload.reportId,
        filename: upload.file.name,
        fileName: upload.file.name,
        size: (upload.file.size / 1024 / 1024).toFixed(2) + " MB",
        uploadTime,
        previewUrl: upload.previewUrl,
        pdfDataUrl: upload.pdfDataUrl,
        fileSizeBytes: upload.fileSizeBytes,
        rawText: upload.rawText,
        textExtractionStatus: upload.textExtractionStatus,
        textExtractionMessage: upload.textExtractionMessage,
        parsedVisitInfo: upload.parsedVisitInfo,
        status: "未解析",
      })
    );
    updatePdfStatus(upload.reportId, "解析中");
    updateItemStatus(upload.reportId, "parsing");

    try {
      const currentPet = loadCurrentPet();
      const job = await uploadReportForParse(
        upload.file,
        upload.reportId,
        upload.rawText,
        currentPet?.name || "",
        []
      );
      // 后端 OCR + DeepSeek/豆包总耗时 60-180 秒，对齐 timeoutMs
      const MAX_POLL_ATTEMPTS = 120;
      const POLL_INTERVAL_MS = 1500;
      let attempts = 0;
      let currentStatus: ParseJobStatus = job.status;

      while (attempts < MAX_POLL_ATTEMPTS && currentStatus !== "ready") {
        const currentJob = await getParseJob(job.jobId);
        currentStatus = currentJob.status;
        if (currentStatus === "ready") break;
        if (currentStatus === "failed") throw new Error("Backend parse job failed");
        attempts += 1;
        await delay(POLL_INTERVAL_MS);
      }
      if (currentStatus !== "ready") throw new Error("Backend parse job timeout");

      const backendResult = await getParseResult(job.jobId);
      if (!hasUsefulStructuredResult(backendResult)) {
        throw new Error("后端解析结果为空，请重新解析或单份上传重试");
      }
      const backendDraft = buildBackendDraft(backendResult, upload);
      const savedDraft = saveReportDraft(backendDraft);
      const extracted = buildExtractedCountsFromDraft(savedDraft);
      updatePdfStatus(upload.reportId, "待确认", {
        extracted,
        parsedAt: new Date().toISOString(),
        previewUrl: savedDraft.previewUrl,
        pdfDataUrl: savedDraft.pdfDataUrl,
        fileSizeBytes: savedDraft.fileSizeBytes,
        rawText: savedDraft.rawText,
        textExtractionStatus: savedDraft.textExtractionStatus,
        textExtractionMessage: savedDraft.textExtractionMessage,
        parsedVisitInfo: savedDraft.visitInfo,
        reportDate: savedDraft.visitInfo.reportDate || savedDraft.visitInfo.visitDate,
      });
      updateItemStatus(upload.reportId, "done", "解析完成");
    } catch (error: any) {
      console.error("parseOneFile failed", upload.file.name, error);
      updatePdfStatus(upload.reportId, "解析失败", {
        parsedAt: new Date().toISOString(),
        previewUrl: upload.previewUrl,
        pdfDataUrl: upload.pdfDataUrl,
        fileSizeBytes: upload.fileSizeBytes,
        rawText: upload.rawText,
        textExtractionStatus: upload.textExtractionStatus,
        textExtractionMessage: upload.textExtractionMessage,
        parsedVisitInfo: upload.parsedVisitInfo,
        extracted: {
          visitCount: 0,
          labCount: 0,
          imagingCount: 0,
          medicationCount: 0,
          followupCount: 0,
        },
      });
      updateItemStatus(upload.reportId, "failed", error?.message || "后端解析失败，请重试");
    }
  };

  const handleStartParse = async () => {
    const queue = selectedUploads.filter((item) => item.uploadStatus === "ready");
    if (queue.length === 0) return;

    setIsUploading(true);
    setBatchProgress({ done: 0, total: queue.length });

    // 扫描件走本地 PaddleOCR，串行处理更稳定；文本型 PDF 仍保持最多 3 份并发。
    const concurrency = getParseConcurrency(queue);
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const idx = cursor++;
        await parseOneFile(queue[idx]);
        done += 1;
        setBatchProgress({ done, total: queue.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

    setIsUploading(false);
    // 用最新 state 判断失败数
    setSelectedUploads((prev) => {
      const failed = prev.filter((i) => i.uploadStatus === "failed").length;
      const okCount = queue.length - failed;
      displayToast(failed === 0
        ? `已完成 ${queue.length} 份报告解析，请到下方列表查看。`
        : `完成 ${okCount}/${queue.length} 份；${failed} 份失败已回退占位。`);
      // 全部成功才清空上传队列，否则保留让用户看错误
      return failed === 0 ? [] : prev;
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUploading) {
      displayToast("当前批次正在解析，完成后可继续添加 PDF。");
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const pdfFiles = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      if (pdfFiles.length === 0) {
        alert("请上传PDF文件");
        return;
      }
      void handleSelectFiles(pdfFiles);
    }
  };

  const [reparsingIds, setReparsingIds] = useState<Set<string>>(new Set());

  const handleReparse = async (doc: any) => {
    if (reparsingIds.has(doc.id)) return;
    setReparsingIds((prev) => new Set(prev).add(doc.id));
    try {
      const blob = doc.pdfDataUrl
        ? await fetch(doc.pdfDataUrl).then((res) => res.blob())
        : await loadPdfBlob(doc.id);
      if (!blob) {
        displayToast("该报告的 PDF 原文已不在本地缓存，请重新上传。");
        return;
      }
      const file = new File([blob], doc.filename || doc.fileName || "report.pdf", { type: "application/pdf" });

      // 重新预处理（重抽 rawText / pageImages，可能模型已升级）
      const item = await preprocessOneFile(file);
      item.reportId = doc.id; // 复用原 reportId 让 upsert 覆盖原记录

      await parseOneFile(item);
      displayToast(`「${file.name}」重新解析完成。`);
    } catch (error: any) {
      console.error("reparse failed", error);
      displayToast(`重新解析失败：${error?.message || "未知错误"}`);
    } finally {
      setReparsingIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  const handleDeleteReport = async (doc: any) => {
    const extraWarning = doc.status === "已入库"
      ? "\n\n该报告已入库，删除后会同步移除已入库的指标、医嘱和时间线记录。"
      : "";
    const confirmed = window.confirm(
      `确定删除这份PDF报告吗？删除后将同时移除该报告关联的草稿、指标记录、医嘱提醒和时间线事件。此操作不可恢复。${extraWarning}`
    );

    if (!confirmed) return;

    deleteReport(doc.id);
    void deletePdfBlob(doc.id);
    displayToast("PDF报告及关联数据已删除。");
  };

  const handleClearTestData = () => {
    const confirmed = window.confirm("确定清空所有PDF报告、草稿、指标、医嘱和时间线测试数据吗？猫咪档案将保留。");
    if (!confirmed) return;

    clearReportTestData();
    void clearPdfBlobStore();
    setSelectedUploads([]);
    setIsUploading(false);
    setBatchProgress({ done: 0, total: 0 });
    displayToast("测试数据已清空，猫咪档案已保留。");
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">PDF诊疗报告中心</h2>
        <p className="text-sm text-slate-500 mt-2 tracking-wide">上传医院PDF诊疗报告，AI将自动解析就诊信息、检验指标、影像报告、医嘱处方和复查建议。</p>
      </div>

      {showToast && (
        <div className="fixed top-6 right-6 bg-green-50 text-green-800 border border-green-200 px-6 py-4 rounded-lg shadow-lg flex items-center z-50 animate-in slide-in-from-top-4">
          <CheckCircle2 className="h-5 w-5 mr-3 text-green-600" />
          <p className="font-medium text-sm">{toastMsg}</p>
        </div>
      )}

      {/* Upload Zone */}
      <Card
        className="border-dashed border-2 border-slate-300 bg-slate-50 hover:bg-slate-100 transition-colors"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
         {selectedUploads.length === 0 ? (
            <CardContent
              className="p-12 flex flex-col items-center justify-center text-center cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
               <input
                 type="file"
                 ref={fileInputRef}
                 onChange={handleFileChange}
                 accept=".pdf,application/pdf"
                 multiple
                 className="hidden"
               />
               <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                  <UploadCloud className="h-8 w-8 text-blue-500" />
               </div>
               <h3 className="text-lg font-semibold text-slate-900 mb-2">拖拽或点击上传 PDF 诊疗报告（支持多份）</h3>
               <p className="text-sm text-slate-500 mb-6 max-w-md">
                 支持一次选择 / 拖入多份 PDF（按报告日期分开）。文本型 PDF 最多并发 3 份；扫描件会自动串行解析并按日期归档。
               </p>
               <Button className="bg-blue-600 hover:bg-blue-700 shadow-sm px-8">选择 PDF 文件</Button>
            </CardContent>
         ) : (
            <CardContent className="p-6">
               <input
                 type="file"
                 ref={fileInputRef}
                 onChange={handleFileChange}
                 accept=".pdf,application/pdf"
                 multiple
                 className="hidden"
               />

               <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      待解析队列（{selectedUploads.length} 份）
                    </h3>
                    {!isUploading && (
                      <p className="mt-1 text-xs text-slate-500">可继续拖拽 PDF 到此区域追加队列。</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isUploading && (
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        继续添加
                      </Button>
                    )}
                    {!isUploading && (
                      <Button variant="outline" size="sm" onClick={() => setSelectedUploads([])}>
                        清空队列
                      </Button>
                    )}
                  </div>
               </div>

               {isUploading && (
                 <div className="mb-4 bg-blue-50 border border-blue-100 rounded-md px-4 py-3">
                   <div className="text-sm font-medium text-blue-800 mb-2 flex justify-between">
                     <span className="flex items-center gap-2">
                       <Loader2 className="h-4 w-4 animate-spin" />
                       正在解析（扫描件自动串行，文本型最多并发 3 份）
                     </span>
                     <span>{batchProgress.done}/{batchProgress.total}</span>
                   </div>
                   <div className="w-full bg-blue-200 rounded-full h-2">
                     <div
                       className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                       style={{ width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%` }}
                     />
                   </div>
                 </div>
               )}

               <div className="space-y-2 mb-4 max-h-80 overflow-y-auto">
                 {selectedUploads.map((item) => (
                   <div key={item.reportId} className="flex items-center justify-between bg-white border border-slate-200 rounded-md px-3 py-2 text-sm">
                     <div className="flex items-center gap-3 min-w-0 flex-1">
                       <FileText className="h-4 w-4 text-blue-600 shrink-0" />
                       <div className="min-w-0 flex-1">
                         <p className="font-medium text-slate-900 truncate">{item.file.name}</p>
                         <p className="text-xs text-slate-500">
                           {(item.file.size / 1024 / 1024).toFixed(2)} MB
                           {item.textExtractionStatus === "success" ? ` · 文本型（DeepSeek 识别）` : ` · 扫描件/图片型（后端 OCR 识别）`}
                           {item.uploadMessage && ` · ${item.uploadMessage}`}
                         </p>
                       </div>
                     </div>
                     <div className="flex items-center gap-2 shrink-0">
                       {item.uploadStatus === "ready" && (
                         <Badge variant="secondary">待解析</Badge>
                       )}
                       {item.uploadStatus === "parsing" && (
                         <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                           <Loader2 className="h-3 w-3 mr-1 animate-spin inline" />解析中
                         </Badge>
                       )}
                       {item.uploadStatus === "done" && (
                         <Badge variant="success">完成</Badge>
                       )}
                       {item.uploadStatus === "failed" && (
                         <Badge variant="destructive">失败</Badge>
                       )}
                       {!isUploading && item.uploadStatus === "failed" && (
                         <Button
                           variant="ghost"
                           size="sm"
                           className="text-slate-400 hover:text-blue-600 h-7 px-2"
                           title="重新加入解析队列"
                           onClick={() => retryQueuedItem(item.reportId)}
                         >
                           <RefreshCw className="h-3.5 w-3.5" />
                         </Button>
                       )}
                       {!isUploading && item.uploadStatus !== "done" && (
                         <Button
                           variant="ghost"
                           size="sm"
                           className="text-slate-400 hover:text-red-600 h-7 px-2"
                           onClick={() => removeSelectedUpload(item.reportId)}
                         >
                           ✕
                         </Button>
                       )}
                     </div>
                   </div>
                 ))}
               </div>

               {!isUploading && (
                 <div className="flex justify-end">
                   <Button
                     className="bg-blue-600 hover:bg-blue-700"
                     onClick={handleStartParse}
                     disabled={selectedUploads.filter((i) => i.uploadStatus === "ready").length === 0}
                   >
                     开始批量 AI 解析（{selectedUploads.filter((i) => i.uploadStatus === "ready").length} 份）
                   </Button>
                 </div>
               )}
            </CardContent>
         )}
      </Card>

      {/* History List */}
      <div>
         <div className="flex items-center justify-between gap-4 mb-4">
           <h3 className="text-base font-semibold text-slate-900 tracking-tight">已管理的 PDF 档案</h3>
           <Button
             variant="ghost"
             size="sm"
             className="text-slate-500 hover:text-red-600"
             onClick={handleClearTestData}
           >
             清空测试数据
           </Button>
         </div>
         <div className="grid gap-4">
            {pdfs.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-sm text-slate-500">
                  当前没有已管理的 PDF 报告。
                </CardContent>
              </Card>
            )}
            {pdfs.map((doc: any, idx: number) => (
             <Card key={doc.id || idx} className="hover:border-blue-200 transition-colors group">
               <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start space-x-4">
                     <div className="w-10 h-10 rounded-lg bg-red-50 text-red-500 flex items-center justify-center mt-1 shrink-0">
                        <FileText className="h-5 w-5" />
                     </div>
                     <div>
                        <p className="text-sm font-semibold text-slate-900">{doc.filename}</p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                            <span>报告日期：{doc.reportDate || doc.date}</span>
                            <span>上传时间：{formatDateTime(doc.uploadTime)}</span>
                            <span>{doc.size}</span>
                            <span className="flex items-center text-slate-600">
                             已识别：
                             {[
                               doc.extracted.visitCount ? '就诊记录' : '',
                               doc.extracted.labCount ? '检验指标' : '',
                               doc.extracted.imagingCount ? '影像报告' : '',
                               doc.extracted.medicationCount ? '医嘱处方' : '',
                               doc.extracted.followupCount ? '复查建议' : ''
                             ].filter(Boolean).join('、')}
                           </span>
                        </div>
                     </div>
                  </div>
                  <div className="flex items-center space-x-4 shrink-0">
                     <div className="text-right mr-2 hidden md:block">
                        <p className="text-xs text-slate-500 font-medium">AI置信度: {typeof doc.confidence === "number" ? `${doc.confidence}%` : "--"}</p>
                     </div>
                     {isEmptyParsedPdf(doc) ? (
                       <Badge variant="destructive">解析失败</Badge>
                     ) : doc.status === '已入库' ? (
                       <Badge variant="success">已入库</Badge>
                     ) : doc.status === '待确认' ? (
                       <Badge variant="warning" className="bg-amber-100 text-amber-700">待确认</Badge>
                     ) : doc.status === '解析中' ? (
                       <Badge variant="secondary">解析中</Badge>
                     ) : doc.status === '解析失败' ? (
                       <Badge variant="destructive">解析失败</Badge>
                     ) : (
                       <Badge variant="secondary">{doc.status || "未解析"}</Badge>
                     )}
                     
                     <div className="flex items-center gap-2">
                       {(doc.status === '已入库' || doc.status === '待确认') && !isEmptyParsedPdf(doc) ? (
                          <div onClick={() => navigate(`/reports/confirm?reportId=${doc.id}`)} className="cursor-pointer text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center bg-blue-50 px-3 py-1.5 rounded-md">
                             查看结果
                          </div>
                       ) : (
                          <Button variant="outline" size="sm" disabled>请重新解析</Button>
                       )}
                       <Button
                         variant="outline"
                         size="sm"
                         className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600 px-2"
                         title="重新解析（用最新 AI 模型再跑一次）"
                         disabled={reparsingIds.has(doc.id)}
                         onClick={() => handleReparse(doc)}
                       >
                         {reparsingIds.has(doc.id) ? (
                           <Loader2 className="h-4 w-4 animate-spin" />
                         ) : (
                           <RefreshCw className="h-4 w-4" />
                         )}
                       </Button>
                       <Button
                         variant="outline"
                         size="sm"
                         className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 px-2"
                         title="删除该报告及其关联数据"
                         onClick={() => handleDeleteReport(doc)}
                       >
                         <Trash2 className="h-4 w-4" />
                       </Button>
                     </div>
                  </div>
               </CardContent>
             </Card>
            ))}
         </div>
      </div>
    </div>
  );
}
