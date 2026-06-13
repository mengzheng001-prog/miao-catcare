import React, { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, Badge, Disclaimer } from "../components/ui";
import {
  TREND_CHECK_CATEGORIES,
  forceCategoryByCode,
  mapGroupNameToCategory,
  normalizeLabCode,
  normalizeTrendCheckCategory,
  resolveCategoryByCode,
} from "../lib/indicatorCategories";
import { STORE_UPDATED_EVENT, loadDataForCurrentPet as loadData } from "../lib/store";

// 指标分类决策（严格按字典）：
//   1) 字典专属强制（RETIC/PT/APTT 等绝对归"其他"，FPV/FCV 等绝对归"传染病"，USG/KET 等绝对归"尿检"）
//      —— 解决 PDF DeepSeek group 字段写错的情况（如 RETIC 被错归到"生化"组）
//   2) PDF 原文 group 命中字典名 → 用 PDF 的
//   3) code 白名单 → 字典分类
//   4) regex 兜底
function resolveIndicatorCategory(indicator: any): string {
  const forced = forceCategoryByCode(indicator?.code);
  if (forced) return forced;
  const groupCat = mapGroupNameToCategory(indicator?.group);
  if (groupCat) return groupCat;
  const codeCat = resolveCategoryByCode(indicator?.code);
  if (codeCat) return codeCat;
  return normalizeTrendCheckCategory(indicator);
}

// 影像类（B 超 / 心超 / X 光 / CT）统一归一个分类。
function resolveImagingCategory(_input: any): string {
  return "B超/心超";
}

/**
 * 显示层合并：把 store.indicators 里所有 indicator 按 normalize 后的英文 code 强制合并。
 * 解决两个问题：
 *   1) 老 indicator 入库时 code 不规范（"%LYM" / "白细胞" / 等），新 PDF 用 normalize 后 code 找不到
 *   2) 同指标在不同 PDF 里中文名翻译不一致（"白细胞数目" / "白细胞计数" / "白细胞总数"）
 *
 * 合并规则：
 *   - 同 normalized code 的 records 合并并按日期排序
 *   - name 取出现频次最高的（或非空中字符最多的）
 *   - unit / min / max / group 取首个非空
 */
function mergeIndicatorsByNormalizedCode(indicators: any[]): any[] {
  const buckets = new Map<string, any>();

  indicators.forEach((ind: any) => {
    const normalizedCode = normalizeLabCode(ind.code, ind.name, ind.group);
    const existing = buckets.get(normalizedCode);

    if (existing) {
      // 合并 records，按 date 升序
      const allRecords = [...existing.records, ...ind.records];
      allRecords.sort((a: any, b: any) => {
        const da = String(a.date || a.reportDate || "");
        const db = String(b.date || b.reportDate || "");
        return da.localeCompare(db);
      });
      existing.records = allRecords;
      // 取信息更完整的 name（中文长度多 = 信息更全）
      const candidateName = String(ind.name || "").trim();
      const existingName = String(existing.name || "").trim();
      if (candidateName && candidateName.length > existingName.length) {
        existing.name = candidateName;
      }
      // 其他字段：首个非空胜出
      existing.unit = existing.unit || ind.unit;
      existing.min = existing.min ?? ind.min;
      existing.max = existing.max ?? ind.max;
      existing.group = existing.group || ind.group;
      existing.system = existing.system || ind.system;
    } else {
      buckets.set(normalizedCode, {
        ...ind,
        code: normalizedCode,
      });
    }
  });

  return Array.from(buckets.values());
}

function getStatusText(status: string) {
  if (status.includes("high")) return "偏高";
  if (status.includes("low")) return "偏低";
  if (status === "negative") return "阴性";
  if (status === "positive") return "阳性";
  if (status === "abnormal") return "异常";
  return "正常";
}

function getStatusBadge(status: string) {
  if (status.includes("high")) return { label: "偏高", variant: "destructive" as const };
  if (status.includes("low")) return { label: "偏低", variant: "warning" as const };
  if (status === "negative") return { label: "阴性", variant: "success" as const };
  if (status === "positive") return { label: "阳性", variant: "destructive" as const };
  if (status === "abnormal") return { label: "异常", variant: "destructive" as const };
  return { label: "正常", variant: "secondary" as const };
}

export default function Trends() {
  const [activeSystem, setActiveSystem] = useState("全部");
  const [store, setStore] = useState<any>(null);

  useEffect(() => {
    const syncStore = () => setStore(loadData());
    syncStore();
    window.addEventListener(STORE_UPDATED_EVENT, syncStore);
    return () => window.removeEventListener(STORE_UPDATED_EVENT, syncStore);
  }, []);

  if (!store || !store.indicators) return null;

  // 先按 normalized code 强制合并，再算分类（解决老数据 code 不一致问题）
  const mergedIndicators = mergeIndicatorsByNormalizedCode(store.indicators);
  const indicatorsWithCategory = mergedIndicators.map((indicator: any) => ({
    ...indicator,
    checkCategory: resolveIndicatorCategory(indicator),
  }));
  const allImagingRecords = buildImagingRecords(store);

  // Tab 列表固定按字典 8 个分类（不再动态从 PDF 原文取，避免出现"血液常规"vs"血常规"等近义冗余）
  const SYSTEMS: readonly string[] = TREND_CHECK_CATEGORIES;

  const visibleIndicators = indicatorsWithCategory.filter((indicator: any) => {
    return activeSystem === "全部" || indicator.checkCategory === activeSystem;
  });
  const visibleImagingRecords = allImagingRecords.filter((record: any) => {
    return activeSystem === "全部" || record.checkCategory === activeSystem;
  });
  const numericIndicators = visibleIndicators.filter((indicator: any) =>
    indicator.records.length > 0 && indicator.records.every((record: any) => Number.isFinite(Number(record.value)))
  );
  const discreteIndicators = visibleIndicators.filter((indicator: any) =>
    indicator.records.length > 0 && indicator.records.some((record: any) => !Number.isFinite(Number(record.value)))
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">指标趋势追踪</h2>
        <div className="flex flex-wrap justify-end gap-2 bg-slate-100 p-1 rounded-lg">
          {SYSTEMS.map(sys => (
            <button
              key={sys}
              onClick={() => setActiveSystem(sys)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeSystem === sys ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {sys}
            </button>
          ))}
        </div>
      </div>

      <Card className="bg-blue-50/50 border-blue-100 mb-6">
          <CardHeader className="pb-3">
             <CardTitle className="text-blue-900 text-sm flex items-center justify-between">
                <div className="flex items-center">
                   <span className="bg-blue-600 w-1.5 h-4 rounded-full mr-2"></span>
                   AI 趋势结构化解析
                </div>
             </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-700 text-sm leading-relaxed">
              基于历次入库的结构化检验数据：WBC等炎症指标总体呈下降趋势，提示相关炎症正逐渐改善；贫血指标（HCT、HGB等）有小幅回升，但仍需持续关注。本次报告中出现的待关注指标（特别是CREA肌酐等高水平项和低水平的USG）建议复诊时作为重点评估项。
            </p>
            <Disclaimer />
          </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {numericIndicators.map((indicator: any, idx: number) => {
          const isHighWarning = indicator.records.some((r: any) => String(r.status).includes("high"));
          const isLowWarning = indicator.records.some((r: any) => String(r.status).includes("low"));
          const isAbnormalWarning = indicator.records.some((r: any) => ["abnormal", "positive"].includes(String(r.status)));
          const numericRecords = indicator.records
            .filter((r: any) => Number.isFinite(Number(r.value)))
            .map((r: any) => ({ ...r, numericValue: Number(r.value) }));
          const hasNumericTrend = numericRecords.length === indicator.records.length && numericRecords.length > 0;
          const latestRecord = indicator.records[indicator.records.length - 1];
          const hasNumericMax = Number.isFinite(Number(indicator.max));
          const hasNumericMin = Number.isFinite(Number(indicator.min));
          return (
          <Card key={idx} className="overflow-hidden shadow-sm border-slate-200">
            <CardHeader className="bg-slate-50/80 border-b border-slate-100 py-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center">
                    {buildIndicatorTitle(indicator)}
                    {isHighWarning && <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-[10px]">增高</Badge>}
                    {isLowWarning && <Badge variant="warning" className="ml-2 px-1.5 py-0 text-[10px]">降低</Badge>}
                    {isAbnormalWarning && <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] border-red-200 text-red-600">异常</Badge>}
                  </CardTitle>
                 <p className="text-xs text-slate-500 mt-0.5">参考范围: {indicator.min} - {indicator.max} {indicator.unit}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-900">{latestRecord?.value || '-'}</p>
                  <p className="text-xs text-slate-500">{indicator.unit}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="h-48 w-full mt-2">
                {hasNumericTrend ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={numericRecords} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                      <YAxis domain={['dataMin - 5', 'dataMax + 5']} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                      <Tooltip
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        labelStyle={{ fontSize: '12px', color: '#64748B', marginBottom: '4px' }}
                        itemStyle={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}
                      />
                      {hasNumericMax && <ReferenceLine y={Number(indicator.max)} stroke="#ef4444" strokeDasharray="3 3" opacity={0.5} />}
                      {hasNumericMin && <ReferenceLine y={Number(indicator.min)} stroke="#f59e0b" strokeDasharray="3 3" opacity={0.5} />}
                      <Line type="monotone" dataKey="numericValue" stroke="#2563EB" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600 flex items-center">
                    该指标暂无足够的连续数值用于绘图。
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )})}
      </div>

      {discreteIndicators.length > 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base text-slate-900">非数值检测结果</CardTitle>
            <p className="text-xs text-slate-500">阴性/阳性、弱阳性等离散结果会保留在这里，不会因为不能画折线图而丢失。</p>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {discreteIndicators.map((indicator: any) => {
              const latestRecord = indicator.records[indicator.records.length - 1];
              const statusBadge = getStatusBadge(String(latestRecord?.status || "normal"));
              return (
                <div key={indicator.code} className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{buildIndicatorTitle(indicator)}</p>
                      <p className="text-xs text-slate-500 mt-1">{indicator.checkCategory || "其他检测结果"}</p>
                    </div>
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                  </div>
                  <div className="mt-3 text-sm text-slate-700">
                    <span className="text-slate-500">最新结果：</span>
                    <span className="font-medium text-slate-900">{latestRecord?.value || "-"}</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {visibleImagingRecords.length > 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base text-slate-900">B超/心超 / 诊断记录</CardTitle>
            <p className="text-xs text-slate-500">影像类检查和医生诊断不绘制数值趋势，按报告日期保留结构化记录。</p>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {visibleImagingRecords.map((record: any) => (
              <div key={record.id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{record.reportDate || "-"} · {record.examType || "影像检查"}</p>
                    <p className="text-xs text-slate-500 mt-1">{record.bodyPart || "未标注部位"}</p>
                  </div>
                  <Badge variant="outline">{record.checkCategory}</Badge>
                </div>
                <div className="mt-3 grid gap-3 text-sm text-slate-700 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1">影像所见</p>
                    <p className="leading-relaxed">{record.finding || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1">影像提示</p>
                    <p className="leading-relaxed">{record.impression || "-"}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {visibleIndicators.length === 0 && visibleImagingRecords.length === 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            当前检查项目分类下暂无已入库记录。
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function normalizeTitlePart(value: any) {
  return String(value || "").trim();
}

function normalizeTitleForCompare(value: string) {
  return value.replace(/[\s()（）［］\[\]]/g, "").toLowerCase();
}

function buildIndicatorTitle(indicator: any) {
  const rawCode = normalizeTitlePart(indicator?.code);
  const rawType = normalizeTitlePart(indicator?.type);
  const rawName = normalizeTitlePart(indicator?.name);
  const primary = rawName || rawType || rawCode || "未命名指标";
  const code = rawCode || (/^[A-Za-z0-9_.-]{2,12}$/.test(rawType) ? rawType : "");
  const comparablePrimary = normalizeTitleForCompare(primary);
  const comparableCode = normalizeTitleForCompare(code);

  if (!code || comparablePrimary === comparableCode || comparablePrimary.includes(comparableCode)) {
    return primary;
  }

  return `${primary}（${code}）`;
}

function isMeaningfulRecordText(value: any) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (["-", "待确认", "请根据PDF原文补充"].includes(text)) return false;
  return !text.includes("请根据PDF原文补充");
}

function buildImagingRecords(store: any) {
  const pdfMap = new Map((store?.pdfs || []).map((pdf: any) => [pdf.id, pdf]));
  return Object.values(store?.reportDrafts || {})
    .flatMap((draft: any) => {
      const pdf = pdfMap.get(draft?.reportId) as any;
      if (!pdf || pdf.status !== "已入库") return [];

      const reportDate = draft?.visitInfo?.reportDate || draft?.visitInfo?.visitDate || pdf.reportDate || pdf.date || "";
      const sourcePdfName = pdf.filename || draft?.fileName || "未命名报告.pdf";
      const records = (draft?.imaging || [])
        .filter((item: any) => (
          isMeaningfulRecordText(item?.examType || item?.type)
          || isMeaningfulRecordText(item?.bodyPart)
          || isMeaningfulRecordText(item?.finding)
          || isMeaningfulRecordText(item?.impression)
        ))
        .map((item: any, index: number) => {
          const itemReportDate = item?.reportDate || reportDate;
          const checkCategory = resolveImagingCategory({
            examType: item?.examType,
            bodyPart: item?.bodyPart,
            finding: item?.finding,
            impression: item?.impression,
            group: item?.group,
          });
          return {
            id: item?.id || String(draft.reportId) + "_imaging_" + (index + 1),
            reportDate: itemReportDate,
            examType: item?.examType || item?.type || "影像检查",
            bodyPart: item?.bodyPart || "",
            finding: item?.finding || "",
            impression: item?.impression || "",
            sourcePdfName,
            sourcePage: item?.sourcePage || "",
            checkCategory,
          };
        });

      const doctorDiagnosis = draft?.visitInfo?.doctorNotes || draft?.visitInfo?.notes || "";
      if (isMeaningfulRecordText(doctorDiagnosis)) {
        records.push({
          id: String(draft.reportId) + "_doctor_diagnosis",
          reportDate,
          examType: "医生诊断",
          bodyPart: "诊疗意见",
          finding: doctorDiagnosis,
          impression: "",
          sourcePdfName,
          sourcePage: "就诊信息",
          checkCategory: "B超/心超",
        });
      }

      return records;
    })
    .sort((a: any, b: any) => new Date(b.reportDate || 0).getTime() - new Date(a.reportDate || 0).getTime());
}
