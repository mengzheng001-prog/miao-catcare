import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, FileText, TrendingUp, Pill, Clock, Stethoscope, Cat, ChevronDown, Check, Plus, User, LogOut, X } from "lucide-react";
import {
  loadPets,
  loadCurrentPet,
  setCurrentPetId,
  PETS_UPDATED,
  CAT_PROFILE_UPDATED,
  loadUser,
  saveUser,
  clearUser,
  USER_UPDATED_EVENT,
  type CatcareUser,
} from "../lib/store";

const MENUS = [
  { name: "首页仪表盘", path: "/", icon: <LayoutDashboard className="mr-3 h-5 w-5" /> },
  { name: "宠物档案", path: "/profile", icon: <Cat className="mr-3 h-5 w-5" /> },
  { name: "PDF报告中心", path: "/reports", icon: <FileText className="mr-3 h-5 w-5" /> },
  { name: "指标趋势", path: "/trends", icon: <TrendingUp className="mr-3 h-5 w-5" /> },
  { name: "医嘱与提醒", path: "/medications", icon: <Pill className="mr-3 h-5 w-5" /> },
  { name: "健康时间线", path: "/timeline", icon: <Clock className="mr-3 h-5 w-5" /> },
  { name: "复诊摘要", path: "/summary", icon: <Stethoscope className="mr-3 h-5 w-5" /> },
];

const PetSwitcher: React.FC = () => {
  const navigate = useNavigate();
  const [pets, setPets] = useState(() => loadPets());
  const [currentPet, setCurrentPet] = useState(() => loadCurrentPet());
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 同步 store 变化
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

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleSwitch = (petId: string) => {
    setCurrentPetId(petId);
    setOpen(false);
  };

  const handleAdd = () => {
    setOpen(false);
    navigate("/profile?action=add");
  };

  if (pets.length === 0) {
    return (
      <button
        onClick={() => navigate("/profile?action=add")}
        className="flex items-center space-x-2 rounded-full border border-blue-200 bg-blue-50 py-1.5 px-4 text-sm font-medium text-blue-700 hover:bg-blue-100 transition"
      >
        <Plus className="h-4 w-4" />
        <span>创建第一只宠物</span>
      </button>
    );
  }

  const trigger = currentPet || pets[0];

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center space-x-2 rounded-full border border-slate-200 py-1.5 px-4 text-sm font-medium hover:bg-slate-50 cursor-pointer transition"
      >
        <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
          {trigger?.avatar ? (
            <img src={trigger.avatar} alt={trigger.name} className="w-full h-full object-cover" />
          ) : (
            <Cat className="h-4 w-4 text-slate-400" />
          )}
        </div>
        <span className="truncate max-w-[160px]">当前宠物: {trigger?.name || "未命名"}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-72 rounded-lg border border-slate-200 bg-white shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-400 uppercase tracking-wide">
            我的宠物（{pets.length}）
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {pets.map((pet: any) => {
              const isActive = currentPet?.id === pet.id;
              return (
                <button
                  key={pet.id}
                  onClick={() => handleSwitch(pet.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 text-left text-sm hover:bg-slate-50 transition ${
                    isActive ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {pet.avatar ? (
                      <img src={pet.avatar} alt={pet.name} className="w-full h-full object-cover" />
                    ) : (
                      <Cat className="h-5 w-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`truncate font-medium ${isActive ? "text-blue-700" : "text-slate-900"}`}>
                      {pet.name || "未命名"}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {[pet.breed, pet.gender].filter(Boolean).join(" · ") || (pet.species === "dog" ? "狗" : "猫")}
                    </div>
                  </div>
                  {isActive && <Check className="h-4 w-4 text-blue-600" />}
                </button>
              );
            })}
          </div>
          <button
            onClick={handleAdd}
            className="w-full flex items-center space-x-2 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 border-t border-slate-100 transition"
          >
            <Plus className="h-4 w-4" />
            <span>添加新宠物</span>
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================
// 右上角用户菜单 —— 前端伪登录，状态仅存 localStorage
// ============================================================
// 头像本地上传：缩到 256×256 居中裁切 + JPEG 压缩，避免 localStorage 爆。
async function resizeAvatarToBase64(file: File, size = 256, quality = 0.85): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("图片读取失败"));
    im.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 不可用");
  // 居中裁切（按短边为基准）
  const minSide = Math.min(img.width, img.height);
  const sx = (img.width - minSide) / 2;
  const sy = (img.height - minSide) / 2;
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}

const UserMenu: React.FC = () => {
  const [user, setUser] = useState<CatcareUser | null>(() => loadUser());
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draftNick, setDraftNick] = useState("");
  const [draftAvatar, setDraftAvatar] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      alert("图片过大（>8MB），请换一张");
      return;
    }
    try {
      const base64 = await resizeAvatarToBase64(file);
      setDraftAvatar(base64);
    } catch (err: any) {
      alert(`头像处理失败：${err?.message || err}`);
    } finally {
      if (avatarFileRef.current) avatarFileRef.current.value = "";
    }
  };

  useEffect(() => {
    const refresh = () => setUser(loadUser());
    window.addEventListener(USER_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(USER_UPDATED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const openLoginModal = () => {
    setDraftNick(user?.nickname || "");
    setDraftAvatar(user?.avatarUrl || "");
    setModalOpen(true);
    setMenuOpen(false);
  };

  const handleLoginSubmit = () => {
    const nick = draftNick.trim();
    if (!nick) {
      alert("请输入昵称");
      return;
    }
    saveUser({ nickname: nick, avatarUrl: draftAvatar.trim() || undefined });
    setModalOpen(false);
  };

  const handleLogout = () => {
    if (!window.confirm("确认退出登录？账户信息（昵称/头像）会被清除，但宠物档案和报告数据保留。")) return;
    clearUser();
    setMenuOpen(false);
  };

  return (
    <>
      <div ref={wrapRef} className="relative">
        {user ? (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-50 transition"
          >
            <div className="h-8 w-8 rounded-full bg-slate-200 border border-slate-300 overflow-hidden flex items-center justify-center">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.nickname} className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-slate-500" />
              )}
            </div>
            <span className="text-sm text-slate-700 font-medium max-w-[7rem] truncate">{user.nickname}</span>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>
        ) : (
          <button
            onClick={openLoginModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition"
          >
            <User className="w-4 h-4" />
            登录
          </button>
        )}
        {user && menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-30 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900 truncate">{user.nickname}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">登录于 {user.loggedInAt.slice(0, 10)}</p>
            </div>
            <button
              onClick={openLoginModal}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left"
            >
              <User className="w-4 h-4 text-slate-400" /> 编辑昵称 / 头像
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 text-left border-t border-slate-100"
            >
              <LogOut className="w-4 h-4" /> 退出登录
            </button>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 px-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">{user ? "编辑个人信息" : "登录账户"}</h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <label className="block">
                <span className="block text-xs text-slate-500 mb-1">昵称（必填）</span>
                <input
                  type="text"
                  value={draftNick}
                  onChange={(e) => setDraftNick(e.target.value)}
                  placeholder="如：铲屎官小张"
                  maxLength={20}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </label>
              <div className="block">
                <span className="block text-xs text-slate-500 mb-2">头像（选填）</span>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                    {draftAvatar ? (
                      <img src={draftAvatar} alt="头像预览" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-7 h-7 text-slate-400" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <input
                      ref={avatarFileRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => avatarFileRef.current?.click()}
                      className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition"
                    >
                      {draftAvatar ? "更换头像" : "上传本地图片"}
                    </button>
                    {draftAvatar && (
                      <button
                        type="button"
                        onClick={() => setDraftAvatar("")}
                        className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md text-left"
                      >
                        移除头像
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">支持 JPG/PNG，自动裁切为 256×256 方形头像。</p>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">
                本 Demo 不对接后端账户体系，账户信息仅本地浏览器保存。
              </p>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-md"
              >取消</button>
              <button
                onClick={handleLoginSubmit}
                className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-md"
              >{user ? "保存" : "登录"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center px-6 border-b border-slate-100">
          <Cat className="h-6 w-6 text-blue-600 mr-2" />
          <h1 className="text-lg font-bold tracking-tight text-slate-900">CatCare Record</h1>
        </div>
        <nav className="p-4 space-y-1">
          {MENUS.map((menu) => {
            const isActive = location.pathname === menu.path;
            const isReportsConf = menu.path === '/reports' && location.pathname.startsWith('/reports');
            const activeMatch = isActive || isReportsConf;
            return (
              <Link
                key={menu.path}
                to={menu.path}
                className={`flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  activeMatch
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {React.cloneElement(menu.icon, {
                  className: `mr-3 h-5 w-5 ${activeMatch ? "text-blue-600" : "text-slate-400"}`
                })}
                {menu.name}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
          <PetSwitcher />
          <UserMenu />
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-8 relative">
          <div className="mx-auto max-w-5xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
