import React, { useEffect, useState } from "react";
import { Download, Copy, Share2, Sparkles, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Button, Disclaimer } from "../components/ui";
import { STORE_UPDATED_EVENT, loadDataForCurrentPet as loadData, loadCatProfile } from "../lib/store";
import {
  buildIndicatorNarrative,
  getConfirmedFollowups,
  getConfirmedIndicators,
  getConfirmedMedications,
  getConfirmedPdfs,
  getLatestVisitInfo,
} from "../lib/reportInsights";

function toTimestamp(value?: string) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildMedicationSummary(meds: any[]) {
  const uniqueMeds = Array.from(
    new Map(
      meds.map((med: any) => [
        [med.drugName || med.name, med.time || "", med.dosage || med.instruction || ""].join("__"),
        med,
      ])
    ).values()
  );

  if (uniqueMeds.length === 0) {
    return "暂无已入库用药提醒。";
  }

  const content = uniqueMeds
    .slice(0, 3)
    .map((med: any) => {
      const details = [med.time, med.dosage || med.instruction].filter(Boolean).join(" · ");
      return `${med.drugName || med.name}${details ? `（${details}）` : ""}`;
    })
    .join("；");

  return uniqueMeds.length > 3 ? `${content} 等 ${uniqueMeds.length} 条提醒。` : `${content}。`;
}

function buildFollowupSummary(followups: any[]) {
  if (followups.length === 0) {
    return "暂无已入库复查提醒。";
  }

  const nextFollowup = followups[0];
  const itemText = nextFollowup.items?.length ? nextFollowup.items.join("、") : "待确认";
  return `${nextFollowup.date || "待确认"}，复查项目：${itemText}；复查建议：${nextFollowup.desc || "待确认"}。`;
}

function getIndicatorHighlights(indicators: any[]) {
  return [...indicators]
    .sort((a: any, b: any) => {
      const left = a.records?.[a.records.length - 1]?.date || a.records?.[a.records.length - 1]?.reportDate;
      const right = b.records?.[b.records.length - 1]?.date || b.records?.[b.records.length - 1]?.reportDate;
      return toTimestamp(right) - toTimestamp(left);
    })
    .slice(0, 3);
}

export default function Summary() {
  const [copied, setCopied] = useState(false);
  const [store, setStore] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    const syncStore = () => setStore(loadData());
    const syncProfile = () => setProfile(loadCatProfile());
    syncStore();
    syncProfile();

    window.addEventListener(STORE_UPDATED_EVENT, syncStore);
    window.addEventListener("catProfileUpdated", syncProfile);
    return () => {
      window.removeEventListener(STORE_UPDATED_EVENT, syncStore);
      window.removeEventListener("catProfileUpdated", syncProfile);
    };
  }, []);

  if (!store || !store.pdfs || !profile) return null;

  const confirmedPdfs = getConfirmedPdfs(store);
  const confirmedReportIds = new Set(confirmedPdfs.map((pdf: any) => pdf.id));
  const latestVisitInfo = getLatestVisitInfo(store, confirmedReportIds);
  const confirmedIndicators = getConfirmedIndicators(store, confirmedReportIds);
  const confirmedMeds = getConfirmedMedications(store, confirmedReportIds);
  const followups = getConfirmedFollowups(store, confirmedReportIds);
  const hasConfirmedReports = confirmedPdfs.length > 0;
  const reportSources = confirmedPdfs.slice(0, 5);
  const pdfNames = reportSources.map((p: any) => p.filename);
  const sourcesText = pdfNames.map((name: string) => `- ${name}`).join("\n");
  const complaintText = latestVisitInfo?.chiefComplaint || latestVisitInfo?.complaint || "请根据PDF原文补充";
  const doctorNotesText = latestVisitInfo?.doctorNotes || latestVisitInfo?.notes || "请根据PDF原文补充";
  const userNotesText = latestVisitInfo?.userNotes || "无";
  const medicationText = buildMedicationSummary(confirmedMeds);
  const followupText = buildFollowupSummary(followups);
  const indicatorHighlights = getIndicatorHighlights(confirmedIndicators);
  const indicatorSummaryLines = indicatorHighlights.map((indicator: any) => buildIndicatorNarrative(indicator));
  const syncOverviewText = hasConfirmedReports
    ? `当前已确认入库 ${confirmedPdfs.length} 份报告，已同步 ${confirmedIndicators.reduce((sum: number, item: any) => sum + item.records.length, 0)} 条指标记录和 ${confirmedMeds.length} 条用药提醒。`
    : "暂无已确认入库的报告，请先上传并确认一份 PDF 诊疗报告。";
  const latestVisitText = latestVisitInfo
    ? `${latestVisitInfo.reportDate || latestVisitInfo.visitDate}，${latestVisitInfo.hospital || "待确认"}，${latestVisitInfo.doctor || "待确认"}，${latestVisitInfo.visitType || "其他"}。`
    : "暂无已确认的最新就诊信息。";
  const communicationItems = [
    hasConfirmedReports ? `请携带已确认入库的报告原文与本摘要一并就诊。` : "",
    indicatorSummaryLines.length > 0 ? `请结合最新指标值与变化趋势向医生核对。` : "如当前尚无指标记录，可先确认至少一份报告后再生成摘要。",
    confirmedMeds.length > 0 ? `请向医生说明当前已记录的用药提醒与执行情况。` : "当前暂无已入库用药提醒，可在确认报告后自动同步。",
    followups.length > 0 ? `请核对下次复查日期、项目及医生备注。` : "当前暂无已入库复查提醒，可在确认页补充后再入库。",
  ].filter(Boolean);

  const textToCopy = hasConfirmedReports
    ? `【CatCare 结构化复诊准备摘要】
依据来源：
${sourcesText}

患者：${profile.name}，${profile.estimatedAge}岁，${profile.gender}，${profile.neutered ? "已绝育" : "未绝育"}。

同步概况：
${syncOverviewText}

最近一次就诊信息：
${latestVisitText}
主诉：${complaintText}
医生备注：${doctorNotesText}
用户备注：${userNotesText}

核心指标结构化汇总：
${indicatorSummaryLines.length > 0 ? indicatorSummaryLines.map((line: string, index: number) => `${index + 1}. ${line}`).join("\n") : "暂无已入库指标记录。"}

当前系统记录的用药提醒：
${medicationText}

最近复查提醒：
${followupText}

复诊沟通参考：
${communicationItems.map((line: string, index: number) => `${index + 1}. ${line}`).join("\n")}

免责声明：本摘要仅为基于已确认入库报告的结构化整理，不构成诊断或改药建议。请务必以医院PDF原文和执业兽医面诊意见为准。`
    : "暂无已确认入库的报告，请先上传并确认一份 PDF 诊疗报告。";

  const handleCopy = () => {
    if (!hasConfirmedReports) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-4 gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">一键生成复诊准备摘要</h2>
          <p className="text-sm text-slate-500 mt-1">基于已确认入库的数据整理结构化摘要，帮助您更高效地进行医患沟通</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" className="gap-2 font-medium" onClick={handleCopy} disabled={!hasConfirmedReports}>
            <Copy className="h-4 w-4" /> {copied ? "已复制" : "复制文本"}
          </Button>
          <Button variant="outline" className="gap-2 font-medium" disabled={!hasConfirmedReports}>
            <Share2 className="h-4 w-4" /> 生成长图
          </Button>
          <Button className="gap-2 bg-blue-600 text-white hover:bg-blue-700 font-medium" disabled={!hasConfirmedReports}>
            <Download className="h-4 w-4" /> 导出PDF
          </Button>
        </div>
      </div>

      <Card className="border-slate-200 shadow-md">
         <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-6">
            <CardTitle className="text-lg flex flex-col items-center justify-center text-slate-800 gap-2">
               <div className="flex items-center">
                 <Sparkles className="h-5 w-5 text-blue-600 mr-2" />
                 CatCare 结构化复诊准备摘要
               </div>
            </CardTitle>
            <div className="mt-4 max-w-2xl mx-auto w-full bg-white border border-slate-200 p-3 rounded-lg text-xs text-slate-600">
               <span className="font-semibold text-slate-800 mb-1 block">基于以下已入库的PDF诊疗报告生成：</span>
               {hasConfirmedReports ? (
                 <ul className="space-y-1 mt-2">
                   {pdfNames.map((name: string, i: number) => (
                      <li key={i} className="flex items-center"><FileText className="w-3.5 h-3.5 mr-1.5 text-slate-400"/> {name}</li>
                   ))}
                 </ul>
               ) : (
                 <p className="mt-2 text-slate-500">暂无已确认入库的报告，请先上传并确认一份 PDF 诊疗报告。</p>
               )}
            </div>
         </CardHeader>
         <CardContent className="p-8 prose prose-slate max-w-none prose-p:leading-relaxed prose-li:my-1">
            {hasConfirmedReports ? (
              <div className="text-slate-700 space-y-6 text-[15px]">
                 <p>
                    <strong>基本信息：</strong> {profile.name}，{profile.estimatedAge}岁，{profile.gender}，{profile.neutered ? "已绝育" : "未绝育"}。
                 </p>
                 <p>
                    <strong>同步概况：</strong> {syncOverviewText}
                  </p>
                 <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                    <strong className="block mb-2 text-slate-900">最近一次就诊信息：</strong>
                    <p>报告日期：{latestVisitInfo?.reportDate || latestVisitInfo?.visitDate || "待确认"}</p>
                    <p>医院：{latestVisitInfo?.hospital || "待确认"}</p>
                    <p>医生：{latestVisitInfo?.doctor || "待确认"}</p>
                    <p>就诊类型：{latestVisitInfo?.visitType || "其他"}</p>
                    <p>主诉：{complaintText}</p>
                    <p>医生备注：{doctorNotesText}</p>
                    <p>用户备注：{userNotesText}</p>
                 </div>
                 <div>
                    <strong className="block mb-2 text-slate-900">核心指标结构化汇总：</strong>
                    {indicatorSummaryLines.length > 0 ? (
                      <ul className="list-disc pl-5 space-y-2">
                         {indicatorSummaryLines.map((line: string, index: number) => (
                           <li key={index}>{line}</li>
                         ))}
                      </ul>
                    ) : (
                      <p>暂无已入库指标记录。</p>
                    )}
                 </div>
                 <p>
                    <strong>当前系统记录的用药提醒：</strong> {medicationText}
                 </p>
                 <p>
                    <strong>最近复查提醒：</strong> {followupText}
                 </p>
                 <div className="bg-amber-50 border border-amber-100 p-5 rounded-xl mt-8">
                    <strong className="block mb-3 text-amber-900 font-semibold text-base">复诊沟通参考：</strong>
                    <ul className="list-decimal pl-5 space-y-2 text-amber-800 font-medium">
                       {communicationItems.map((item: string, index: number) => (
                         <li key={index}>{item}</li>
                       ))}
                    </ul>
                 </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-500">
                暂无已确认入库的报告，请先上传并确认一份 PDF 诊疗报告。
              </div>
            )}
         </CardContent>
         <div className="px-8 pb-8 pt-2">
           <Disclaimer />
         </div>
      </Card>
    </div>
  );
}
