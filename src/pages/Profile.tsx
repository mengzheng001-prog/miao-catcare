import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Edit3, Plus, X, Activity, Scale, Cat, Trash2, Bug, ChevronDown, ChevronUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "../components/ui";
import {
  loadPets,
  loadCurrentPet,
  setCurrentPetId,
  addPet,
  updatePet,
  deletePet,
  PETS_UPDATED,
  CAT_PROFILE_UPDATED,
} from "../lib/store";

const SPECIES_OPTIONS = [
  { value: "cat", label: "猫" },
  { value: "dog", label: "狗" },
  { value: "other", label: "其他" },
];

const EMPTY_EDIT_DATA = {
  name: "",
  species: "cat",
  breed: "",
  gender: "",
  neutered: false,
  estimatedAge: 0,
  weight: 0,
  bodyCondition: "正常",
  lifestyle: "",
  labels: [] as string[],
  history: "",
  allergies: "",
  hospital: "",
  doctor: "",
  nextCheckup: "",
  weightLogs: [] as { date: string; weight: number }[],
  dewormingLogs: [] as { id: string; date: string; type: string; product: string; nextDueDate?: string; notes?: string }[],
  avatar: "",
};

const DEWORMING_TYPES = ["体内驱虫", "体外驱虫", "体内外同驱", "其他"];

export default function Profile() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pets, setPets] = useState<any[]>(() => loadPets());
  const [currentPet, setCurrentPet] = useState<any>(() => loadCurrentPet());

  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("基础信息");
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newWeight, setNewWeight] = useState("");
  const [newWeightDate, setNewWeightDate] = useState(new Date().toISOString().split("T")[0]);

  const [newDewormingDate, setNewDewormingDate] = useState(new Date().toISOString().split("T")[0]);
  const [newDewormingType, setNewDewormingType] = useState(DEWORMING_TYPES[2]);
  const [newDewormingProduct, setNewDewormingProduct] = useState("");
  const [newDewormingNext, setNewDewormingNext] = useState("");
  const [newDewormingNotes, setNewDewormingNotes] = useState("");

  const [recentWeightOpen, setRecentWeightOpen] = useState(false);

  // 监听 store 变化
  useEffect(() => {
    const refresh = () => {
      setPets(loadPets());
      setCurrentPet(loadCurrentPet());
    };
    window.addEventListener(PETS_UPDATED, refresh);
    window.addEventListener(CAT_PROFILE_UPDATED, refresh);
    return () => {
      window.removeEventListener(PETS_UPDATED, refresh);
      window.removeEventListener(CAT_PROFILE_UPDATED, refresh);
    };
  }, []);

  // URL 参数 ?action=add → 自动打开 add modal（来自 TopNav 的"添加新宠物"按钮）
  useEffect(() => {
    if (searchParams.get("action") === "add") {
      openAddModal();
      // 清掉 URL 参数避免重复触发
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const openAddModal = () => {
    setEditData({ ...EMPTY_EDIT_DATA });
    setModalMode("add");
    setActiveTab("基础信息");
  };

  const openEditModal = (tab: string = "基础信息") => {
    if (!currentPet) return;
    setEditData({ ...currentPet });
    setModalMode("edit");
    setActiveTab(tab);
  };

  const closeModal = () => {
    setModalMode(null);
    setEditData(null);
    setConfirmDelete(false);
  };

  const handleSave = () => {
    if (!editData.name?.trim()) {
      showToast("请填写宠物名字");
      setActiveTab("基础信息");
      return;
    }
    if (modalMode === "add") {
      const newPet = addPet(editData);
      setCurrentPetId(newPet.id);
      showToast(`已添加宠物：${newPet.name}`);
    } else if (modalMode === "edit" && currentPet) {
      updatePet(currentPet.id, editData);
      showToast(`已更新档案：${editData.name}`);
    }
    closeModal();
  };

  const handleDeleteCurrent = () => {
    if (!currentPet) return;
    deletePet(currentPet.id);
    showToast(`已删除宠物：${currentPet.name}`);
    closeModal();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && currentPet) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        updatePet(currentPet.id, { avatar: base64 });
        showToast("头像已更新");
      };
      reader.readAsDataURL(file);
    }
  };

  const addLabel = (label: string) => {
    if (label && editData && !editData.labels.includes(label)) {
      setEditData({ ...editData, labels: [...editData.labels, label] });
    }
  };

  const removeLabel = (label: string) => {
    if (editData) {
      setEditData({ ...editData, labels: editData.labels.filter((l: string) => l !== label) });
    }
  };

  const handleAddWeight = () => {
    if (newWeight && newWeightDate) {
      const logs = [...(editData.weightLogs || [])];
      logs.push({ date: newWeightDate, weight: Number(newWeight) });
      logs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setEditData({
        ...editData,
        weightLogs: logs,
        weight: logs[logs.length - 1].weight,
      });
      setNewWeight("");
    }
  };

  const handleAddDeworming = () => {
    if (!newDewormingDate || !newDewormingProduct.trim()) return;
    const logs = [...(editData.dewormingLogs || [])];
    logs.push({
      id: `deworm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: newDewormingDate,
      type: newDewormingType,
      product: newDewormingProduct.trim(),
      nextDueDate: newDewormingNext || undefined,
      notes: newDewormingNotes.trim() || undefined,
    });
    logs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setEditData({ ...editData, dewormingLogs: logs });
    setNewDewormingProduct("");
    setNewDewormingNext("");
    setNewDewormingNotes("");
  };

  const handleDeleteDeworming = (id: string) => {
    setEditData({
      ...editData,
      dewormingLogs: (editData.dewormingLogs || []).filter((log: any) => log.id !== id),
    });
  };

  const speciesLabel = useMemo(() => {
    const opt = SPECIES_OPTIONS.find((o) => o.value === (currentPet?.species || "cat"));
    return opt?.label || "猫";
  }, [currentPet]);

  // ============================================================
  // 渲染：空状态（还没有宠物）
  // ============================================================
  if (pets.length === 0) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {toast && (
          <div className="fixed top-20 right-8 bg-slate-800 text-white px-4 py-2 rounded-md shadow-lg z-50">
            {toast}
          </div>
        )}

        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">宠物档案</h2>
        </div>

        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center">
            <div className="w-24 h-24 rounded-full bg-blue-50 flex items-center justify-center mb-6">
              <Cat className="w-12 h-12 text-blue-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">还没有宠物档案</h3>
            <p className="text-slate-500 mb-8 max-w-md">
              CatCare 是面向多宠家庭的 AI 医疗档案助手。先添加你的第一只宠物，开始记录健康数据。
            </p>
            <Button onClick={openAddModal} className="gap-2">
              <Plus className="w-4 h-4" />
              添加第一只宠物
            </Button>
          </CardContent>
        </Card>

        {modalMode && editData && renderEditModal()}
      </div>
    );
  }

  // ============================================================
  // 渲染：有宠物时的常规视图
  // ============================================================
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      {toast && (
        <div className="fixed top-20 right-8 bg-slate-800 text-white px-4 py-2 rounded-md shadow-lg z-50 animate-in fade-in slide-in-from-top-4">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">宠物档案</h2>
          <p className="text-sm text-slate-500 mt-1">从左上角切换当前宠物，或点击右侧按钮添加</p>
        </div>
        <Button onClick={openAddModal} className="gap-2">
          <Plus className="w-4 h-4" />
          添加宠物
        </Button>
      </div>

      {currentPet ? (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-1 space-y-6">
          <Card className="border-none shadow-none bg-slate-50 relative">
            {/* 名片右上角编辑按钮 */}
            <button
              onClick={() => openEditModal("基础信息")}
              className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition shadow-sm"
              aria-label="编辑宠物档案"
            >
              <Edit3 className="w-3 h-3" />
              编辑
            </button>
              <CardContent className="pt-6 flex flex-col items-center text-center">
                <div className="w-24 h-24 rounded-full border-4 border-white shadow-md overflow-hidden mb-4 relative group bg-white">
                  {currentPet.avatar ? (
                    <img src={currentPet.avatar} alt={currentPet.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Cat className="w-10 h-10 text-slate-400" />
                    </div>
                  )}
                  <div
                    className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center text-white text-xs font-medium cursor-pointer transition-opacity"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    更换头像
                  </div>
                </div>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />

                <h3 className="text-xl font-bold text-slate-900">{currentPet.name || "未命名"}</h3>
                <p className="text-slate-500 mt-1">
                  {[currentPet.breed, currentPet.estimatedAge ? `${currentPet.estimatedAge}岁` : null].filter(Boolean).join(" · ") || speciesLabel}
                </p>

                <div className="w-full mt-6 space-y-3">
                  <div className="bg-white p-3 rounded-lg border border-slate-100 flex justify-between">
                    <span className="text-slate-500 text-sm">物种</span>
                    <span className="text-slate-900 text-sm font-medium">{speciesLabel}</span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-100 flex justify-between">
                    <span className="text-slate-500 text-sm">性别</span>
                    <span className="text-slate-900 text-sm font-medium">
                      {currentPet.gender || "未设置"} {currentPet.gender ? `(${currentPet.neutered ? "已绝育" : "未绝育"})` : ""}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-100 flex justify-between">
                    <span className="text-slate-500 text-sm">最新体重</span>
                    <span className="text-slate-900 text-sm font-medium">
                      {currentPet.weight ? `${currentPet.weight} kg` : "未记录"}
                    </span>
                  </div>
                  <BgRow label="过敏与禁忌" value={currentPet.allergies} valueClass="text-amber-700" />
                  <BgRow label="既往病史" value={currentPet.history} />
                  <BgRow label="首选医院" value={currentPet.hospital} valueClass="text-blue-600" />
                  <BgRow label="常用医生" value={currentPet.doctor} valueClass="text-blue-600" />
                </div>
              </CardContent>
            </Card>
          </div>

            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-slate-700">重点关注标签</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {currentPet.labels?.length ? (
                      currentPet.labels.map((label: string, idx: number) => (
                        <Badge key={idx} variant={idx === 0 ? "secondary" : "outline"} className="px-3 py-1">{label}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-slate-400">暂无标签，可在"医疗背景"中添加</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-slate-700 flex items-center relative">
                      <Scale className="w-5 h-5 mr-2 text-blue-500" />
                      体重记录
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => openEditModal("体重记录")} className="text-blue-600 h-8">
                      新增记录
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  {currentPet.weightLogs && currentPet.weightLogs.length > 0 ? (
                    <>
                      <div className="h-44 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={[...currentPet.weightLogs]
                              .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
                              .map((log: any) => ({
                                date: String(log.date).slice(5),  // MM-DD
                                weight: Number(log.weight),
                                fullDate: log.date,
                              }))}
                            margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#64748B" }} />
                            <YAxis
                              domain={[
                                (dataMin: number) => Math.max(0, Math.floor(dataMin - 0.5)),
                                (dataMax: number) => Math.ceil(dataMax + 0.5),
                              ]}
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 10, fill: "#64748B" }}
                              tickFormatter={(v) => `${v}kg`}
                            />
                            <Tooltip
                              contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                              labelStyle={{ fontSize: "12px", color: "#64748B", marginBottom: "4px" }}
                              itemStyle={{ fontSize: "14px", fontWeight: 600, color: "#0F172A" }}
                              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate || ""}
                              formatter={(value) => [`${value} kg`, "体重"]}
                            />
                            <Line type="monotone" dataKey="weight" stroke="#2563EB" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 5 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="pt-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setRecentWeightOpen((v) => !v)}
                          aria-expanded={recentWeightOpen}
                          className="w-full flex items-center justify-between text-xs text-slate-500 hover:text-slate-700 transition-colors py-1"
                        >
                          <span>最近记录（{Math.min(3, currentPet.weightLogs.length)} 条）</span>
                          {recentWeightOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {recentWeightOpen && (
                          <div className="space-y-1.5 mt-2 animate-in fade-in slide-in-from-top-1 duration-150">
                            {[...currentPet.weightLogs].reverse().slice(0, 3).map((log: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">{log.date}</span>
                                <span className="font-medium">{log.weight} kg</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-500 py-4 text-center bg-slate-50 rounded-lg">暂无历史体重记录</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-slate-700 flex items-center relative">
                      <Bug className="w-5 h-5 mr-2 text-emerald-500" />
                      驱虫记录
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => openEditModal("驱虫记录")} className="text-blue-600 h-8">
                      新增记录
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  {currentPet.dewormingLogs && currentPet.dewormingLogs.length > 0 ? (
                    <div className="space-y-3">
                      {[...currentPet.dewormingLogs].reverse().slice(0, 5).map((log: any) => (
                        <div key={log.id} className="text-sm border-b border-slate-50 pb-2 last:border-b-0">
                          <div className="flex justify-between items-center mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-700 font-medium">{log.date}</span>
                              <Badge className="bg-emerald-50 text-emerald-700 font-normal">{log.type}</Badge>
                            </div>
                            {log.nextDueDate && (
                              <span className="text-xs text-amber-600">下次：{log.nextDueDate}</span>
                            )}
                          </div>
                          <div className="text-slate-600 text-xs">
                            <span className="text-slate-400">产品：</span>{log.product}
                            {log.notes ? <span className="ml-3 text-slate-400">备注：<span className="text-slate-600">{log.notes}</span></span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 py-4 text-center bg-slate-50 rounded-lg">暂无驱虫记录</div>
                  )}
                </CardContent>
              </Card>
            </div>
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            请从上方选择一只宠物查看详情
          </CardContent>
        </Card>
      )}

      {modalMode && editData && renderEditModal()}
    </div>
  );

  // ============================================================
  // 编辑 / 添加 Modal（add / edit 共用）
  // ============================================================
  function renderEditModal() {
    const isAdd = modalMode === "add";
    return (
      <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 overflow-y-auto pt-10 pb-10">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-full flex flex-col h-[80vh]">
          <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-20 shrink-0">
            <h3 className="text-lg font-bold text-slate-900 flex items-center">
              {isAdd ? <Plus className="w-5 h-5 mr-2 text-blue-600" /> : <Edit3 className="w-5 h-5 mr-2 text-blue-600" />}
              {isAdd ? "添加新宠物" : `编辑档案：${editData.name || "未命名"}`}
            </h3>
            <button className="text-slate-400 hover:text-slate-600 focus:outline-none" onClick={closeModal}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar Tabs */}
            <div className="w-32 sm:w-40 bg-slate-50 border-r border-slate-100 shrink-0 overflow-y-auto">
              {["基础信息", "生活方式", "医疗背景", "体重记录", "驱虫记录", "复查计划"].map((tab) => (
                <button
                  key={tab}
                  className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? "bg-white text-blue-600 border-r-2 border-blue-600"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === "基础信息" && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">名字 <span className="text-red-500">*</span></label>
                      <input type="text" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.name || ""} onChange={(e) => setEditData({ ...editData, name: e.target.value })} placeholder="比如：豆豆、奶茶、橘子" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">物种</label>
                      <select className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.species || "cat"} onChange={(e) => setEditData({ ...editData, species: e.target.value })}>
                        {SPECIES_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">品种</label>
                      <input type="text" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.breed || ""} onChange={(e) => setEditData({ ...editData, breed: e.target.value })} placeholder="如：田园猫、英短、金毛" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">性别</label>
                      <select className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.gender || ""} onChange={(e) => setEditData({ ...editData, gender: e.target.value })}>
                        <option value="">未设置</option>
                        <option value="母猫">母猫</option>
                        <option value="公猫">公猫</option>
                        <option value="母狗">母狗</option>
                        <option value="公狗">公狗</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">是否绝育</label>
                      <select className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.neutered ? "true" : "false"} onChange={(e) => setEditData({ ...editData, neutered: e.target.value === "true" })}>
                        <option value="false">未绝育</option>
                        <option value="true">已绝育</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">估算年龄 (岁)</label>
                      <input type="number" min="0" step="0.5" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.estimatedAge || ""} onChange={(e) => setEditData({ ...editData, estimatedAge: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">体况</label>
                      <select className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.bodyCondition || "正常"} onChange={(e) => setEditData({ ...editData, bodyCondition: e.target.value })}>
                        <option value="偏瘦">偏瘦</option>
                        <option value="正常">正常</option>
                        <option value="偏胖">偏胖</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "生活方式" && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-medium">生活习惯</label>
                    <textarea className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" rows={4} placeholder="如：室内猫，多猫家庭，冻干为主" value={editData.lifestyle || ""} onChange={(e) => setEditData({ ...editData, lifestyle: e.target.value })}></textarea>
                  </div>
                </div>
              )}

              {activeTab === "医疗背景" && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500 font-medium">健康标签</label>
                    <div className="flex flex-wrap gap-2">
                      {editData.labels?.map((label: string, idx: number) => (
                        <span key={idx} className="inline-flex items-center px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs border border-blue-100">
                          {label}
                          <button onClick={() => removeLabel(label)} className="ml-1 text-blue-400 hover:text-blue-600"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        id="newLabelInput"
                        placeholder="输入新标签"
                        className="px-3 py-1.5 border border-slate-200 rounded-md text-xs focus:ring-1 focus:ring-blue-500 outline-none w-32"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            addLabel(e.currentTarget.value);
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
                        const input = document.getElementById("newLabelInput") as HTMLInputElement;
                        if (input.value) {
                          addLabel(input.value);
                          input.value = "";
                        }
                      }}>添加</Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-medium">既往病史</label>
                    <textarea className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" rows={3} value={editData.history || ""} onChange={(e) => setEditData({ ...editData, history: e.target.value })}></textarea>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-medium">过敏与禁忌</label>
                    <textarea className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" rows={2} value={editData.allergies || ""} onChange={(e) => setEditData({ ...editData, allergies: e.target.value })}></textarea>
                  </div>

                  <div className="p-3 bg-amber-50 rounded-lg text-xs leading-relaxed text-amber-900 border border-amber-100 flex items-start mt-4">
                    <Activity className="w-4 h-4 mr-2 shrink-0 mt-0.5 text-amber-600" />
                    请尽量按医院报告或医生医嘱填写医疗信息。档案内容用于健康记录和复诊沟通，不代表诊断结论。
                  </div>
                </div>
              )}

              {activeTab === "体重记录" && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <h5 className="text-sm font-semibold mb-3">新增体重记录</h5>
                    <div className="flex gap-3 items-end">
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">日期</label>
                        <input type="date" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={newWeightDate} onChange={(e) => setNewWeightDate(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">体重 (kg)</label>
                        <input type="number" step="0.1" className="w-24 px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} placeholder="0.0" />
                      </div>
                      <Button onClick={handleAddWeight} disabled={!newWeight || !newWeightDate}>保存记录</Button>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-semibold mb-3 text-slate-700">体重历史记录（最新在前）</h5>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50 text-xs">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold text-slate-500">日期</th>
                            <th className="px-4 py-2 text-left font-semibold text-slate-500">体重 (kg)</th>
                            <th className="px-4 py-2 text-right font-semibold text-slate-500">操作</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200 text-sm">
                          {editData.weightLogs && editData.weightLogs.length > 0 ? (
                            [...editData.weightLogs].reverse().map((log: any, idx: number) => (
                              <tr key={idx}>
                                <td className="px-4 py-2 text-slate-700">{log.date}</td>
                                <td className="px-4 py-2 font-medium">{log.weight}</td>
                                <td className="px-4 py-2 text-right">
                                  <button
                                    className="text-red-500 text-xs hover:underline"
                                    onClick={() => {
                                      const logs = [...editData.weightLogs];
                                      logs.reverse().splice(idx, 1);
                                      logs.reverse();
                                      setEditData({
                                        ...editData,
                                        weightLogs: logs,
                                        weight: logs.length > 0 ? logs[logs.length - 1].weight : editData.weight,
                                      });
                                    }}
                                  >
                                    删除
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={3} className="px-4 py-6 text-center text-slate-500">暂无记录</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "驱虫记录" && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <h5 className="text-sm font-semibold mb-3">新增驱虫记录</h5>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">驱虫日期</label>
                        <input type="date" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={newDewormingDate} onChange={(e) => setNewDewormingDate(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">驱虫类型</label>
                        <select className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none bg-white" value={newDewormingType} onChange={(e) => setNewDewormingType(e.target.value)}>
                          {DEWORMING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs text-slate-500">产品名称</label>
                        <input type="text" placeholder="如：福来恩、博来恩、海乐妙" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={newDewormingProduct} onChange={(e) => setNewDewormingProduct(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">下次驱虫日期（选填）</label>
                        <input type="date" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={newDewormingNext} onChange={(e) => setNewDewormingNext(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">备注（选填）</label>
                        <input type="text" placeholder="如：滴剂/口服" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={newDewormingNotes} onChange={(e) => setNewDewormingNotes(e.target.value)} />
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button onClick={handleAddDeworming} disabled={!newDewormingDate || !newDewormingProduct.trim()}>保存记录</Button>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-semibold mb-3 text-slate-700">历史记录（最新在前）</h5>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50 text-xs">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500">日期</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500">类型</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500">产品</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500">下次到期</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-500">操作</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200 text-sm">
                          {editData.dewormingLogs && editData.dewormingLogs.length > 0 ? (
                            [...editData.dewormingLogs].reverse().map((log: any) => (
                              <tr key={log.id}>
                                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{log.date}</td>
                                <td className="px-3 py-2 text-slate-700">{log.type}</td>
                                <td className="px-3 py-2 text-slate-700">{log.product}{log.notes ? <span className="text-slate-400 text-xs ml-1">· {log.notes}</span> : null}</td>
                                <td className="px-3 py-2 text-amber-600 whitespace-nowrap">{log.nextDueDate || "--"}</td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    className="text-red-500 text-xs hover:underline"
                                    onClick={() => handleDeleteDeworming(log.id)}
                                  >
                                    删除
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-slate-500">暂无记录</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="p-3 bg-emerald-50 rounded-lg text-xs leading-relaxed text-emerald-900 border border-emerald-100 flex items-start">
                    <Bug className="w-4 h-4 mr-2 shrink-0 mt-0.5 text-emerald-600" />
                    家养猫狗常规建议：体内驱虫每 3 个月一次，体外驱虫每月一次（或按所选产品说明书执行）。具体频率请遵兽医建议。
                  </div>
                </div>
              )}

              {activeTab === "复查计划" && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">首选动物医院</label>
                      <input type="text" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.hospital || ""} onChange={(e) => setEditData({ ...editData, hospital: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">常用医生</label>
                      <input type="text" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={editData.doctor || ""} onChange={(e) => setEditData({ ...editData, doctor: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500 font-medium">下次复查日期</label>
                      <input type="date" className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none text-slate-700" value={editData.nextCheckup || ""} onChange={(e) => setEditData({ ...editData, nextCheckup: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 p-4 flex justify-between items-center sticky bottom-0 bg-white shrink-0">
            {/* 编辑模式下显示删除按钮 */}
            {!isAdd ? (
              confirmDelete ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-red-600 font-medium">确认删除？所有相关报告/指标/医嘱将被清除</span>
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>取消</Button>
                  <Button size="sm" onClick={handleDeleteCurrent} className="bg-red-600 hover:bg-red-700">确认删除</Button>
                </div>
              ) : (
                <button
                  className="flex items-center text-xs text-red-500 hover:text-red-700 transition"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  删除此宠物
                </button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={closeModal}>取消</Button>
              <Button onClick={handleSave}>{isAdd ? "创建宠物" : "保存更改"}</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

// 健康背景详述里的小卡行 —— 跟左栏头像下方"物种/性别/最新体重/体况"完全同款样式。
// 灰底背景 + 白色圆角小卡 + 两端对齐，让两个 Card 视觉上是一片连续区域。
const BgRow: React.FC<{ label: string; value?: string; valueClass?: string }> = ({
  label,
  value,
  valueClass = "text-slate-900",
}) => {
  const v = String(value || "").trim();
  const isEmpty = !v;
  return (
    <div className="bg-white p-3 rounded-lg border border-slate-100 flex justify-between items-start gap-3">
      <span className="text-slate-500 text-sm shrink-0">{label}</span>
      <span className={`text-sm font-medium text-right break-words ${isEmpty ? "text-amber-600" : valueClass}`}>
        {isEmpty ? "未设置" : v}
      </span>
    </div>
  );
};
