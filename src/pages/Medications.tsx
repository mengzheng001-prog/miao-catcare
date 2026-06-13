import React, { useEffect, useState } from "react";
import { Check, Clock, Info, FileText, CalendarDays, X, Pencil, Trash2, Save, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Disclaimer } from "../components/ui";
import { STORE_UPDATED_EVENT, loadDataForCurrentPet as loadData, loadData as loadFullStore, saveData, loadCatProfile } from "../lib/store";
import { getConfirmedFollowups, getConfirmedPdfs } from "../lib/reportInsights";

type MedDraft = { name: string; dosage: string; time: string };

export default function Medications() {
  const [store, setStore] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MedDraft>({ name: "", dosage: "", time: "" });
  const [medsExpanded, setMedsExpanded] = useState(false);
  const [followupsExpanded, setFollowupsExpanded] = useState(false);

  const COLLAPSED_COUNT = 3;

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

  const handleToggleStatus = (id: string, newStatus: string) => {
    if (!store) return;
    // 重要：filter 后的 store 只包含当前宠物 meds，写回时要合并全量 store 的 meds（其他宠物的不能丢）
    const fullStore = loadFullStore();
    fullStore.meds = (fullStore.meds || []).map((med: any) =>
      med.id === id ? { ...med, status: newStatus } : med
    );
    saveData(fullStore);
    // setStore 直接用最新的 per-pet view
    setStore(loadData());
  };

  const startEdit = (med: any) => {
    setEditingId(med.id);
    setDraft({
      name: String(med.name || med.drugName || ""),
      dosage: String(med.dosage || ""),
      time: String(med.time || ""),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = (id: string) => {
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      alert("药名不能为空");
      return;
    }
    const fullStore = loadFullStore();
    fullStore.meds = (fullStore.meds || []).map((med: any) =>
      med.id === id
        ? {
            ...med,
            name: trimmedName,
            drugName: trimmedName,
            dosage: draft.dosage.trim(),
            time: draft.time.trim(),
            // 标记为用户手工修正过，便于以后区分 OCR 原始值
            editedByUser: true,
          }
        : med
    );
    saveData(fullStore);
    setEditingId(null);
    setStore(loadData());
  };

  const deleteMed = (id: string) => {
    if (!window.confirm("确认删除这条用药记录吗？删除后无法恢复。")) return;
    const fullStore = loadFullStore();
    fullStore.meds = (fullStore.meds || []).filter((med: any) => med.id !== id);
    saveData(fullStore);
    if (editingId === id) setEditingId(null);
    setStore(loadData());
  };

  if (!store || !store.meds || !profile) return null;

  const confirmedPdfs = getConfirmedPdfs(store);
  const confirmedReportIds = new Set(confirmedPdfs.map((pdf: any) => pdf.id));
  const followupReminders = getConfirmedFollowups(store, confirmedReportIds);

  // 按 startDate 倒序，最新在前；缺失字段排到最后
  const sortedMeds = [...store.meds].sort((a: any, b: any) => {
    const da = String(a.startDate || a.sourceUploadTime || "");
    const db = String(b.startDate || b.sourceUploadTime || "");
    return db.localeCompare(da);
  });
  const visibleMeds = medsExpanded ? sortedMeds : sortedMeds.slice(0, COLLAPSED_COUNT);
  const sortedFollowups = [...followupReminders].sort((a: any, b: any) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );
  const visibleFollowups = followupsExpanded ? sortedFollowups : sortedFollowups.slice(0, COLLAPSED_COUNT);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">医嘱与提醒</h2>
        <Button className="gap-2">新增提醒</Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
         {/* 用药建议 */}
         <Card>
            <CardHeader>
               <CardTitle>用药建议{sortedMeds.length > 0 && <span className="ml-2 text-sm text-slate-400 font-normal">共 {sortedMeds.length} 条</span>}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               {sortedMeds.length === 0 && (
                  <div className="text-sm text-slate-500 py-6 text-center bg-slate-50 rounded-lg">
                     暂无用药建议。上传并确认医嘱报告后会自动生成。
                  </div>
               )}
               {visibleMeds.map((med: any) => {
                  const isEditing = editingId === med.id;
                  return (
                  <div key={med.id} className="flex flex-col justify-between p-4 rounded-xl border border-slate-200 bg-white shadow-sm gap-4">
                     <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start space-x-3 flex-1 min-w-0">
                           <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${med.status === 'completed' ? 'bg-green-100 text-green-600' : med.status === 'missed' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                              {med.status === 'completed' ? <Check className="h-4 w-4" /> : med.status === 'missed' ? <X className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                           </div>
                           {isEditing ? (
                             <div className="flex-1 min-w-0 space-y-2">
                                <div className="flex gap-2">
                                  <label className="flex-1 min-w-0">
                                    <span className="block text-[11px] text-slate-500 mb-0.5">用药时间</span>
                                    <input
                                      type="text"
                                      value={draft.time}
                                      onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                                      placeholder="如 08:00"
                                      className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                  </label>
                                  <label className="flex-[2] min-w-0">
                                    <span className="block text-[11px] text-slate-500 mb-0.5">药名</span>
                                    <input
                                      type="text"
                                      value={draft.name}
                                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                      placeholder="药物名称"
                                      className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                  </label>
                                </div>
                                <label className="block">
                                   <span className="block text-[11px] text-slate-500 mb-0.5">剂量 / 频率</span>
                                   <input
                                      type="text"
                                      value={draft.dosage}
                                      onChange={(e) => setDraft({ ...draft, dosage: e.target.value })}
                                      placeholder="如 0.5 片，每日 2 次"
                                      className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                   />
                                </label>
                             </div>
                           ) : (
                           <div className="min-w-0 flex-1">
                              <p className={`text-base font-semibold truncate ${med.status === 'completed' || med.status === 'missed' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{med.time} · {med.name}</p>
                              <p className="text-sm text-slate-600 mt-1 break-words">{med.dosage}</p>
                           </div>
                           )}
                        </div>
                        {isEditing ? (
                           <div className="flex space-x-2 shrink-0">
                              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={cancelEdit}>取消</Button>
                              <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 gap-1" onClick={() => saveEdit(med.id)}><Save className="h-3 w-3"/>保存</Button>
                           </div>
                        ) : med.status === 'pending' ? (
                           <div className="flex space-x-2 shrink-0">
                              <Button size="sm" variant="outline" className="h-8 text-xs hover:bg-red-50 hover:text-red-600" onClick={() => handleToggleStatus(med.id, 'missed')}>漏服</Button>
                              <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700" onClick={() => handleToggleStatus(med.id, 'completed')}>已完成</Button>
                           </div>
                        ) : med.status === 'completed' ? (
                           <Badge variant="success" className="font-normal bg-transparent border-transparent text-green-600 flex items-center shrink-0"><Check className="mr-1 h-3 w-3"/> 已完成</Badge>
                        ) : (
                           <Badge variant="destructive" className="font-normal bg-transparent border-transparent text-red-600 flex items-center shrink-0"><X className="mr-1 h-3 w-3"/> 漏服</Badge>
                        )}
                     </div>
                     <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 gap-2">
                        <div className="flex items-center min-w-0 flex-1">
                           <FileText className="w-3.5 h-3.5 mr-1 shrink-0" />
                           <span className="truncate">来源：{med.source || med.sourcePdfName}{med.editedByUser ? " · 已手动修正" : ""}</span>
                        </div>
                        {!isEditing && (
                           <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => startEdit(med)}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                title="编辑药物信息（适用于 OCR 识别不准）"
                              >
                                 <Pencil className="h-3 w-3" /> 编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteMed(med.id)}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="删除这条用药记录"
                              >
                                 <Trash2 className="h-3 w-3" /> 删除
                              </button>
                           </div>
                        )}
                     </div>
                  </div>
                  );
               })}
               {sortedMeds.length > COLLAPSED_COUNT && (
                  <button
                     type="button"
                     onClick={() => setMedsExpanded((v) => !v)}
                     className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                  >
                     {medsExpanded ? (
                        <>收起 <ChevronUp className="w-4 h-4" /></>
                     ) : (
                        <>展开全部 {sortedMeds.length} 条 <ChevronDown className="w-4 h-4" /></>
                     )}
                  </button>
               )}
            </CardContent>
         </Card>

         {/* 复诊计划 + 安全提示 */}
         <div className="space-y-6">
            <Card>
               <CardHeader>
                  <CardTitle>复诊计划{sortedFollowups.length > 0 && <span className="ml-2 text-sm text-slate-400 font-normal">共 {sortedFollowups.length} 条</span>}</CardTitle>
               </CardHeader>
               <CardContent className="space-y-3">
                 {sortedFollowups.length > 0 ? (
                   <>
                     {visibleFollowups.map((followup: any) => (
                       <div key={followup.id} className="flex items-start space-x-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
                          <div className="mt-0.5"><CalendarDays className="h-5 w-5 text-blue-600" /></div>
                          <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-blue-900 mb-1">复查日期</p>
                              <p className="text-lg font-bold text-slate-900 mb-2">{followup.date || "待确认"}</p>
                              <p className="text-xs text-blue-800 font-medium break-words">
                                复查项目：{followup.items?.length ? followup.items.join("、") : "待确认"}
                              </p>
                              <p className="text-xs text-blue-700 mt-1 break-words">
                                复查建议：{followup.desc || "待确认"}
                              </p>
                              <p className="text-[11px] text-blue-600 mt-2 truncate">
                                来源：{followup.sourcePdfName || "未命名报告.pdf"}{followup.sourcePage ? ` · ${followup.sourcePage}` : ""}
                              </p>
                          </div>
                       </div>
                     ))}
                     {sortedFollowups.length > COLLAPSED_COUNT && (
                        <button
                           type="button"
                           onClick={() => setFollowupsExpanded((v) => !v)}
                           className="w-full mt-1 flex items-center justify-center gap-1.5 py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                        >
                           {followupsExpanded ? (
                              <>收起 <ChevronUp className="w-4 h-4" /></>
                           ) : (
                              <>展开全部 {sortedFollowups.length} 条 <ChevronDown className="w-4 h-4" /></>
                           )}
                        </button>
                     )}
                   </>
                 ) : (
                   <div className="flex items-start space-x-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
                      <div className="mt-0.5"><CalendarDays className="h-5 w-5 text-blue-600" /></div>
                      <div className="flex-1">
                          <p className="text-sm font-bold text-blue-900 mb-1">下次约定复查日期</p>
                          <p className="text-lg font-bold text-slate-900 mb-2">{profile.nextCheckup || "未设置"}</p>
                          <p className="text-xs text-blue-700 font-medium">当前暂无已入库 PDF 复查提醒，先显示猫咪档案中的兜底复查计划。</p>
                      </div>
                   </div>
                 )}
               </CardContent>
            </Card>

            <Card className="bg-amber-50/80 border-amber-200">
               <CardContent className="p-4 flex items-start space-x-3">
                  <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-900 leading-relaxed">
                     <p className="font-semibold mb-1">用药安全提示：</p>
                     系统仅根据解析的医生处方生成提醒，不会擅自建议加药、减药或停药。如在服药期间出现呕吐、严重腹泻、精神沉郁等不良反应，请立即联系主治兽医。
                  </div>
               </CardContent>
            </Card>
         </div>
      </div>
    </div>
  );
}
