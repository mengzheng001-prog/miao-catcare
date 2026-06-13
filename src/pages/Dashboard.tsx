import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Activity, FileText, CheckCircle2, Clock, Stethoscope, UploadCloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Disclaimer } from "../components/ui";
import { STORE_UPDATED_EVENT, loadDataForCurrentPet as loadData, loadCatProfile } from "../lib/store";
import {
  buildIndicatorNarrative,
  formatRecordStatus,
  getConfirmedFollowups,
  getConfirmedIndicators,
  getConfirmedMedications,
  getConfirmedPdfs,
  getLatestVisitInfo,
} from "../lib/reportInsights";

function buildTrendSummary(indicator: any) {
  const latest = indicator?.records?.[indicator.records.length - 1];
  const previous = indicator?.records?.[indicator.records.length - 2];
  const latestStatus = formatRecordStatus(latest?.status);

  if (!latest) {
    return { text: "暂无结构化记录", badge: "暂无", variant: "outline" as const };
  }

  if (Number.isFinite(Number(latest.value)) && Number.isFinite(Number(previous?.value))) {
    const current = Number(latest.value);
    const prev = Number(previous.value);
    if (current > prev) {
      return { text: "较上次上升", badge: "上升", variant: "warning" as const };
    }
    if (current < prev) {
      return { text: "较上次下降", badge: "下降", variant: "success" as const };
    }
  }

  if (latestStatus === "偏高") {
    return { text: "当前记录仍高于关注范围", badge: "持续偏高", variant: "destructive" as const };
  }
  if (latestStatus === "偏低") {
    return { text: "当前记录仍低于关注范围", badge: "持续偏低", variant: "destructive" as const };
  }
  if (["异常", "阳性"].includes(latestStatus)) {
    return { text: "当前记录需继续关注", badge: "异常", variant: "destructive" as const };
  }

  return { text: "当前记录稳定", badge: "稳定", variant: "success" as const };
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
    .map((med: any) => med.drugName || med.name)
    .join("、");

  return uniqueMeds.length > 3 ? `${content} 等 ${uniqueMeds.length} 条提醒` : content;
}

export default function Dashboard() {
  const [store, setStore] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    const syncStore = () => setStore(loadData());
    const handleProfileUpdate = () => setProfile(loadCatProfile());
    syncStore();
    handleProfileUpdate();

    window.addEventListener(STORE_UPDATED_EVENT, syncStore);
    window.addEventListener("catProfileUpdated", handleProfileUpdate);
    return () => {
      window.removeEventListener(STORE_UPDATED_EVENT, syncStore);
      window.removeEventListener("catProfileUpdated", handleProfileUpdate);
    };
  }, []);

  if (!store || !profile) return null;

  const confirmedPdfs = getConfirmedPdfs(store);
  const confirmedReportIds = new Set(confirmedPdfs.map((pdf: any) => pdf.id));
  const latestPdf = confirmedPdfs[0] || null;
  const latestVisitInfo = latestPdf ? store.reportDrafts?.[latestPdf.id]?.visitInfo || getLatestVisitInfo(store, confirmedReportIds) : null;
  const recentPdfsText = confirmedPdfs.slice(0, 3).map((p: any) => p.filename).join("、");
  const confirmedMeds = getConfirmedMedications(store, confirmedReportIds);
  const pendingMeds = confirmedMeds.filter((med: any) => med.status === "pending");
  const firstPendingMed = pendingMeds[0] || null;
  const followups = getConfirmedFollowups(store, confirmedReportIds);
  const nextFollowup = followups[0] || null;
  const confirmedIndicators = getConfirmedIndicators(store, confirmedReportIds);
  const spotlightCodes = ["WBC", "HCT", "CREA", "USG"];
  const spotlightIndicators = [
    ...spotlightCodes
      .map((code) => confirmedIndicators.find((indicator: any) => indicator.code === code))
      .filter(Boolean),
    ...confirmedIndicators.filter((indicator: any) => !spotlightCodes.includes(indicator.code)),
  ].slice(0, 4);
  const hasConfirmedReports = confirmedPdfs.length > 0;
  const indicatorSummaryText = spotlightIndicators.length > 0
    ? spotlightIndicators.slice(0, 2).map((indicator: any) => buildIndicatorNarrative(indicator)).join(" ")
    : "暂无已入库指标记录。";
  const medicationSummaryText = buildMedicationSummary(confirmedMeds);
  const followupSummaryText = nextFollowup
    ? `${nextFollowup.date || "待确认"} · ${nextFollowup.items?.length ? nextFollowup.items.join("、") : nextFollowup.desc || "待确认"}`
    : profile.nextCheckup
      ? `${profile.nextCheckup} · 当前仅显示猫咪档案中的兜底复查计划`
      : "暂无已同步复查提醒。";
  const dashboardSummaryText = hasConfirmedReports
    ? `当前已确认入库 ${confirmedPdfs.length} 份报告，最近一次检查为 ${latestPdf?.reportDate || latestPdf?.date || "-"}${latestVisitInfo?.hospital ? `（${latestVisitInfo.hospital}）` : ""}。结构化趋势提示：${indicatorSummaryText} 当前用药提醒：${medicationSummaryText}。待复查提醒：${followupSummaryText}。`
    : "暂无已确认入库的报告，请先上传并确认一份 PDF 诊疗报告。";
  const taskCount = [firstPendingMed, true, nextFollowup || profile.nextCheckup].filter(Boolean).length;
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">首页仪表盘</h2>
        <Link to="/reports">
          <Button className="gap-2 bg-blue-600 hover:bg-blue-700 shadow-sm"><UploadCloud className="h-4 w-4" /> 上传PDF诊疗报告</Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Cat Profile Card */}
        <Card className="col-span-1 border-slate-200 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center space-x-4">
               <div className="w-12 h-12 rounded-full border-2 border-white shadow-sm overflow-hidden">
                    {profile.avatar ? (
                      <img src={profile.avatar} alt="cat" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-slate-200" />
                    )}
                </div>
              <div>
                <CardTitle>{profile.name}</CardTitle>
                <p className="text-sm text-slate-500 mt-0.5">{profile.estimatedAge}岁 · {profile.gender} · {profile.neutered ? '已绝育' : '未绝育'}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">健康标签</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.labels.map((label: string, idx: number) => (
                  <Badge key={idx} variant="secondary">{label}</Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <p className="text-xs text-slate-500">最新体重</p>
                <p className="text-lg font-semibold text-slate-900">{profile.weight} kg</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">最近复查</p>
                <p className="text-sm font-medium text-slate-900 mt-1">{profile.nextCheckup}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="col-span-2 space-y-6">
          {/* Main PDF Extraction Card */}
          <Card className="border-blue-100 shadow-sm overflow-hidden">
             <div className="bg-blue-50/50 px-6 py-4 flex items-center justify-between border-b border-blue-100">
                <div className="flex items-center gap-2">
                   <div className="p-1.5 bg-blue-100 text-blue-600 rounded-md"><FileText className="w-4 h-4"/></div>
                   <CardTitle className="text-blue-900 text-base">最近PDF报告</CardTitle>
                </div>
                {latestPdf ? (
                  <Badge variant="success" className="bg-green-100 text-green-700">{latestPdf.status}</Badge>
                ) : (
                  <Badge variant="secondary">暂无已入库</Badge>
                )}
             </div>
             <CardContent className="p-6">
               {latestPdf ? (
                 <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                     <div className="space-y-1">
                        <p className="text-sm text-slate-500">最近一次已入库检查：</p>
                        <p className="font-semibold text-slate-900 flex items-center">
                           {latestPdf.filename}
                        </p>
                        <p className="text-xs text-slate-400">报告日期：{latestPdf.reportDate || latestPdf.date || "-"}</p>
                        {latestVisitInfo?.hospital && (
                          <p className="text-xs text-slate-400">医院：{latestVisitInfo.hospital}</p>
                        )}
                        <p className="text-xs text-slate-400">上传时间：{latestPdf.uploadTime ? new Date(latestPdf.uploadTime).toLocaleString() : "-"} · {latestPdf.size}</p>
                     </div>
                     <div className="flex gap-2">
                        <Link to="/reports"><Button variant="outline" size="sm">管理所有报告</Button></Link>
                     </div>
                  </div>
                  <div className="mt-5 grid grid-cols-4 sm:grid-cols-5 gap-3 border-t border-slate-100 pt-5">
                     <div className="text-center">
                        <p className="text-2xl font-bold text-blue-600">{latestPdf.extracted?.visitCount || 0}</p>
                        <p className="text-xs text-slate-500 mt-1">就诊信息</p>
                     </div>
                     <div className="text-center border-l border-slate-100">
                        <p className="text-2xl font-bold text-blue-600">{latestPdf.extracted?.labCount || 0}</p>
                        <p className="text-xs text-slate-500 mt-1">检验指标</p>
                     </div>
                     <div className="text-center border-l border-slate-100">
                        <p className="text-2xl font-bold text-blue-600">{latestPdf.extracted?.imagingCount || 0}</p>
                        <p className="text-xs text-slate-500 mt-1">影像报告</p>
                     </div>
                     <div className="text-center border-l border-slate-100">
                        <p className="text-2xl font-bold text-blue-600">{latestPdf.extracted?.medicationCount || 0}</p>
                        <p className="text-xs text-slate-500 mt-1">医嘱处方</p>
                     </div>
                     <div className="text-center border-l border-slate-100 hidden sm:block">
                        <p className="text-2xl font-bold text-blue-600">{latestPdf.extracted?.followupCount || 0}</p>
                        <p className="text-xs text-slate-500 mt-1">复查建议</p>
                     </div>
                  </div>
                 </>
               ) : (
                 <div className="py-8 text-center text-slate-500">
                    暂无已确认入库的报告
                 </div>
               )}
             </CardContent>
          </Card>

          {/* AI Health Summary */}
          <Card className="bg-slate-50 border-slate-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center text-slate-900 text-base">
                  <Activity className="mr-2 h-4 w-4 text-blue-600" />
                  复诊准备摘要
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-2 bg-white px-3 py-1.5 rounded-md border border-slate-100 inline-flex items-center text-xs text-slate-500">
                 <FileText className="w-3 h-3 mr-1.5"/> 依据来源：{recentPdfsText || '无'}
              </div>
              <p className="text-slate-700 leading-relaxed text-sm">
                {dashboardSummaryText}
              </p>
              <Disclaimer />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
         {/* Today's Tasks */}
         <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>今日待办</CardTitle>
            <Badge variant="outline" className="font-normal">{taskCount}项随访任务</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start space-x-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                <div className="mt-0.5"><Clock className="h-4 w-4 text-slate-400" /></div>
                <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">用药：{firstPendingMed?.drugName || firstPendingMed?.name || "暂无待执行医嘱"}</p>
                    <p className="text-xs text-slate-500">{firstPendingMed ? `${firstPendingMed.time} · ${firstPendingMed.dosage}` : "当前没有待完成的用药提醒"}</p>
                </div>
                <Link to="/medications"><Button size="sm" variant="outline" className="h-7 text-xs">去查看</Button></Link>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
                <div className="mt-0.5"><Stethoscope className="h-4 w-4 text-blue-600" /></div>
                <div className="flex-1">
                    <p className="text-sm font-medium text-blue-900">{nextFollowup ? "已同步最新复查提醒" : "当前显示档案兜底复查计划"}</p>
                    <p className="text-xs text-blue-700">
                      {nextFollowup
                        ? `${nextFollowup.date || "待确认"} - ${nextFollowup.items?.length ? nextFollowup.items.join("、") : nextFollowup.desc || "待确认"}`
                        : `${profile.nextCheckup || "未设置"} - 请在确认页补充复查项目`}
                    </p>
                </div>
            </div>
          </CardContent>
        </Card>

         {/* Key Trends Spotlight */}
         <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>关键指标趋势追踪</CardTitle>
            <Link to="/trends" className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center">
              查看解析图表 <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </CardHeader>
           <CardContent className="space-y-3">
             {spotlightIndicators.length > 0 ? spotlightIndicators.map((indicator: any) => {
               const summary = buildTrendSummary(indicator);
               return (
                 <div key={indicator.code} className="flex items-center justify-between p-2.5 rounded hover:bg-slate-50 transition-colors">
                    <div>
                       <p className="text-sm font-medium text-slate-900">{indicator.code} {indicator.name}</p>
                       <p className="text-xs text-slate-500">{summary.text}</p>
                    </div>
                    <Badge variant={summary.variant}>{summary.badge}</Badge>
                 </div>
               );
             }) : (
               <div className="text-sm text-slate-500">暂无已入库指标记录。</div>
             )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
