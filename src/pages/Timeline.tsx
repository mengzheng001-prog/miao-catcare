import React, { useEffect, useState } from "react";
import { FileText, Pill, CalendarDays, ChevronDown, ChevronUp } from "lucide-react";
import { STORE_UPDATED_EVENT, loadDataForCurrentPet as loadData } from "../lib/store";

function buildSourceLabel(sourcePdfName?: string, sourcePage?: string) {
  return [sourcePdfName, sourcePage].filter(Boolean).join(" ");
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatStatus(status: string) {
  if (status.includes("high")) return "偏高";
  if (status.includes("low")) return "偏低";
  if (status === "negative") return "阴性";
  if (status === "positive") return "阳性";
  if (status === "abnormal") return "异常";
  return status || "正常";
}

function getReportDetails(store: any, reportId: string, sourcePdfName?: string) {
  const draft = store.reportDrafts?.[reportId];
  const pdfRecord = (store.pdfs || []).find((pdf: any) => pdf.id === reportId);
  const draftLabs = draft?.labs?.filter((lab: any) => lab.checked && !lab.error).map((lab: any) => ({
    id: lab.id,
    name: lab.name,
    code: lab.code,
    value: lab.value,
    status: lab.status,
    sourcePage: lab.sourcePage,
  })) || [];
  const indicatorLabs = draftLabs.length > 0 ? draftLabs : (store.indicators || []).flatMap((indicator: any) =>
    indicator.records
      .filter((record: any) => record.sourcePdfId === reportId)
      .map((record: any) => ({
        id: `${indicator.code}_${record.date}_${record.sourcePage}`,
        name: indicator.name,
        code: indicator.code,
        value: record.value,
        status: formatStatus(String(record.status || "")),
        sourcePage: record.sourcePage,
      }))
  );
  const medications = draft?.medications || (store.meds || [])
    .filter((med: any) => med.sourcePdfId === reportId)
    .map((med: any) => ({
      id: med.id,
      drugName: med.drugName || med.name,
      dosage: med.dosage,
      frequency: med.frequency,
      duration: med.duration,
      sourcePage: med.sourcePage,
    }));
  const followups = draft?.followups || [];
  const imaging = draft?.imaging || [];
  const visitInfo = draft?.visitInfo || {
    catName: "未记录",
    reportDate: pdfRecord?.reportDate || "-",
    visitDate: pdfRecord?.reportDate || "-",
    hospital: sourcePdfName || "未记录",
    doctor: "未记录",
    visitType: "未记录",
    chiefComplaint: "未记录",
    doctorNotes: "未记录",
    complaint: "未记录",
  };

  return {
    visitInfo,
    labs: indicatorLabs,
    imaging,
    medications,
    followups,
    uploadTime: pdfRecord?.uploadTime,
  };
}

function buildReportSummary(details: any, fallbackDesc: string) {
  if (!details) return fallbackDesc;

  const parts = [
    "就诊信息",
    details.labs.length ? `检验指标${details.labs.length}项` : "",
    details.imaging.length ? `影像报告${details.imaging.length}条` : "",
    details.medications.length ? `医嘱处方${details.medications.length}条` : "",
    details.followups.length ? `复查建议${details.followups.length}条` : "",
  ].filter(Boolean);

  return `已入库：${parts.join("、")}`;
}

export default function Timeline() {
  const [store, setStore] = useState<any>(null);
  const [expandedReports, setExpandedReports] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const syncStore = () => setStore(loadData());
    syncStore();
    window.addEventListener(STORE_UPDATED_EVENT, syncStore);
    return () => window.removeEventListener(STORE_UPDATED_EVENT, syncStore);
  }, []);

  if (!store || !store.timeline) return null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">健康时间线</h2>
      </div>

      <div className="relative border-l-2 border-slate-200 ml-4 py-4 space-y-10">
         {store.timeline.map((item: any, idx: number) => {
            let Icon = FileText;
            let iconColor = "text-blue-600";
            let bgColor = "bg-blue-100";
            let borderColor = "border-blue-200";
            const reportDetails = item.type === "report" && item.sourcePdfId ? getReportDetails(store, item.sourcePdfId, item.sourcePdfName) : null;
            const isExpandable = item.type === "report" && Boolean(item.sourcePdfId);
            const isExpanded = item.sourcePdfId ? Boolean(expandedReports[item.sourcePdfId]) : false;
            const summaryText = buildReportSummary(reportDetails, item.desc);
            
            if (item.type === 'plan') {
               Icon = CalendarDays;
               iconColor = "text-indigo-600";
               bgColor = "bg-indigo-100";
               borderColor = "border-indigo-200";
            } else if (item.type === 'med') {
               Icon = Pill;
               iconColor = "text-emerald-600";
               bgColor = "bg-emerald-100";
               borderColor = "border-emerald-200";
            }

            return (
              <div key={item.id || idx} className="relative pl-10 group">
                 <div className={`absolute -left-[21px] top-0 h-10 w-10 rounded-full border-4 border-white ${bgColor} flex items-center justify-center shadow-sm transition-transform group-hover:scale-110`}>
                    <Icon className={`h-4 w-4 ${iconColor}`} />
                 </div>
                 <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between mb-2">
                    <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                    <time className="text-xs font-semibold text-slate-400 sm:ml-4 bg-slate-100 px-2 py-1 rounded-md">{item.date}</time>
                 </div>
                 <div
                    className={`mt-2 p-4 bg-white border ${borderColor} rounded-xl shadow-sm text-sm text-slate-700 leading-relaxed hover:shadow-md transition-shadow ${isExpandable ? "cursor-pointer" : "cursor-default"}`}
                    onClick={() => {
                      if (!item.sourcePdfId || !isExpandable) return;
                      setExpandedReports((current) => ({
                        ...current,
                        [item.sourcePdfId]: !current[item.sourcePdfId],
                      }));
                    }}
                 >
                    <div className="flex items-start justify-between gap-4">
                      <p className="flex-1">{summaryText}</p>
                      {isExpandable && (
                        <span className="shrink-0 text-slate-400">
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                      )}
                    </div>
                    {(item.source || item.sourcePdfName) && (
                       <div className="mt-3 pt-3 border-t border-slate-100 flex items-center text-xs text-slate-400">
                          <FileText className="w-3.5 h-3.5 mr-1" />
                          来源：{item.source || item.sourcePdfName}
                       </div>
                    )}
                    {isExpandable && isExpanded && reportDetails && (
                      <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2 text-xs">
                          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                            <p className="font-semibold text-slate-700 mb-2">就诊信息摘要</p>
                            <div className="space-y-1 text-slate-600">
                              <p>猫咪姓名：{reportDetails.visitInfo.catName}</p>
                              <p>就诊日期：{reportDetails.visitInfo.reportDate || reportDetails.visitInfo.visitDate}</p>
                              <p>医院：{reportDetails.visitInfo.hospital}</p>
                              <p>医生：{reportDetails.visitInfo.doctor}</p>
                              <p>就诊类型：{reportDetails.visitInfo.visitType || "未记录"}</p>
                              <p>主诉：{reportDetails.visitInfo.chiefComplaint || reportDetails.visitInfo.complaint}</p>
                              <p>医生备注：{reportDetails.visitInfo.doctorNotes || reportDetails.visitInfo.notes || "未记录"}</p>
                              <p>上传时间：{formatDateTime(reportDetails.uploadTime)}</p>
                            </div>
                          </div>
                          {reportDetails.followups.length > 0 && (
                            <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                              <p className="font-semibold text-amber-900 mb-2">复查建议</p>
                              <div className="space-y-1 text-amber-800">
                                {reportDetails.followups.map((followup: any) => (
                                  <p key={followup.id}>{followup.date} · {followup.desc}</p>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {reportDetails.labs.length > 0 && (
                          <div className="rounded-lg border border-slate-100 overflow-hidden">
                            <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">检验指标</div>
                            <div className="divide-y divide-slate-100">
                              {reportDetails.labs.map((lab: any) => (
                                <div key={lab.id} className="px-3 py-2 flex items-center justify-between gap-4 text-xs">
                                  <div>
                                    <p className="font-medium text-slate-900">{lab.name} ({lab.code})</p>
                                    <p className="text-slate-500 mt-1">{lab.value} · {lab.status} · {lab.sourcePage}</p>
                                  </div>
                                  <span className="text-slate-400">{lab.sourcePage}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {reportDetails.imaging.length > 0 && (
                          <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                            <p className="text-xs font-semibold text-slate-700 mb-2">影像报告摘要</p>
                            <div className="space-y-3">
                              {reportDetails.imaging.map((imaging: any) => (
                                <div key={imaging.id} className="text-xs text-slate-700">
                                  <p>检查类型：{imaging.examType}</p>
                                  <p>检查部位：{imaging.bodyPart}</p>
                                  <p>影像所见：{imaging.finding}</p>
                                  <p>影像提示：{imaging.impression}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {reportDetails.medications.length > 0 && (
                          <div className="rounded-lg border border-slate-100 overflow-hidden">
                            <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">医嘱处方</div>
                            <div className="divide-y divide-slate-100">
                              {reportDetails.medications.map((med: any) => (
                                <div key={med.id} className="px-3 py-2 text-xs text-slate-700">
                                  <p className="font-medium text-slate-900">{med.drugName}</p>
                                  <p className="mt-1">剂量：{med.dosage} · 频次：{med.frequency || "按医嘱"} · 疗程：{med.duration || "--"} · {med.sourcePage}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                 </div>
              </div>
            )
         })}
      </div>
    </div>
  );
}
