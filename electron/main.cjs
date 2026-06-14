// CatCare Electron 主进程
// - 启动内嵌 Express 后端（由 esbuild bundle 出的 server-bundle.cjs）
// - 创建 BrowserWindow 加载 http://localhost:PORT
// - 首次启动检测 API Key，未配置则弹设置面板（settings.html）
// - 所有用户配置存在 app.getPath('userData')/config.json

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");

const isDev = !app.isPackaged;
const APP_NAME = "CatCare";

// ============================================================
// 路径
// ============================================================
const userDataDir = app.getPath("userData");
const configFile = path.join(userDataDir, "config.json");

// 后端 bundle 的位置：dev 模式从 build/server-bundle.cjs，生产从 asar 内的同路径
const serverBundlePath = path.join(__dirname, "..", "build", "server-bundle.cjs");
// 前端 dist 的位置
const distDir = path.join(__dirname, "..", "dist");

// ============================================================
// 配置读写（API Key 持久化）
// ============================================================
function loadConfig() {
  try {
    if (!fs.existsSync(configFile)) return {};
    return JSON.parse(fs.readFileSync(configFile, "utf-8"));
  } catch (err) {
    console.error("[catcare] config 读取失败:", err);
    return {};
  }
}

function saveConfig(cfg) {
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("[catcare] config 写入失败:", err);
    return false;
  }
}

// ============================================================
// 启动后端 + 找空闲端口
// ============================================================
async function findFreePort(start = 3001) {
  for (let p = start; p < start + 50; p++) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(p, "127.0.0.1");
    });
    if (free) return p;
  }
  throw new Error("找不到可用端口（3001-3050 全部被占）");
}

async function waitForServer(url, maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else reject(new Error("status " + res.statusCode));
        });
        req.on("error", reject);
        req.setTimeout(1000, () => req.destroy(new Error("timeout")));
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

let backendPort = 3001;

async function startBackend() {
  const cfg = loadConfig();

  // 把用户配置注入 process.env，让后端读到
  process.env.NODE_ENV = "production";
  process.env.TMPDIR = process.env.TMPDIR || app.getPath("temp");
  if (cfg.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = cfg.DEEPSEEK_API_KEY;
  if (cfg.DOUBAO_API_KEY) process.env.DOUBAO_API_KEY = cfg.DOUBAO_API_KEY;
  if (cfg.DOUBAO_MODEL) process.env.DOUBAO_MODEL = cfg.DOUBAO_MODEL;
  // OCR 默认 stub（Electron 包不含 PaddleOCR）
  process.env.OCR_MODE = process.env.OCR_MODE || "stub";
  process.env.DEEPSEEK_TIMEOUT_MS = process.env.DEEPSEEK_TIMEOUT_MS || "120000";
  process.env.DEEPSEEK_SAMPLE_MODE = process.env.DEEPSEEK_SAMPLE_MODE || "short";
  process.env.DOUBAO_BASE_URL = process.env.DOUBAO_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  process.env.DOUBAO_TIMEOUT_MS = process.env.DOUBAO_TIMEOUT_MS || "180000";
  process.env.DOUBAO_MAX_PAGES = process.env.DOUBAO_MAX_PAGES || "10";

  backendPort = await findFreePort(3001);
  process.env.PORT = String(backendPort);
  // server 启动时会找 dist/index.html，需要让它知道在哪
  process.env.CATCARE_DIST_DIR = distDir;

  if (!fs.existsSync(serverBundlePath)) {
    throw new Error(`后端 bundle 不存在：${serverBundlePath}\n请先运行 npm run electron:build-server`);
  }

  // 直接在主进程里 require —— Electron main 本身就是 Node，能直接跑 CJS bundle
  require(serverBundlePath);

  const ok = await waitForServer(`http://127.0.0.1:${backendPort}/api/health`);
  if (!ok) throw new Error("后端启动超时（15 秒内未响应 /api/health）");

  console.log(`[catcare] backend ready on port ${backendPort}`);
}

// ============================================================
// 窗口
// ============================================================
let mainWindow = null;
let settingsWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 拦截外链：跳系统浏览器，不在 app 内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 620,
    title: "CatCare 设置",
    parent: mainWindow || undefined,
    modal: !!mainWindow,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// ============================================================
// 菜单
// ============================================================
function buildMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { label: "设置 API Key...", click: () => createSettingsWindow() },
        { type: "separator" },
        { label: "重新加载", role: "reload" },
        { label: "开发者工具", role: "toggleDevTools" },
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "GitHub 仓库",
          click: () => shell.openExternal("https://github.com/mengzheng001-prog/miao-catcare"),
        },
        {
          label: "申请 DeepSeek API Key",
          click: () => shell.openExternal("https://platform.deepseek.com/"),
        },
        {
          label: "申请豆包 API Key",
          click: () => shell.openExternal("https://www.volcengine.com/product/doubao"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============================================================
// IPC：渲染进程 <-> 主进程
// ============================================================
ipcMain.handle("config:load", () => loadConfig());

ipcMain.handle("config:save", (_event, cfg) => {
  const ok = saveConfig(cfg);
  if (ok) {
    // 把新 key 注入 env，但要重启后端才能让原服务读到新值
    if (cfg.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = cfg.DEEPSEEK_API_KEY;
    if (cfg.DOUBAO_API_KEY) process.env.DOUBAO_API_KEY = cfg.DOUBAO_API_KEY;
    if (cfg.DOUBAO_MODEL) process.env.DOUBAO_MODEL = cfg.DOUBAO_MODEL;
  }
  return ok;
});

ipcMain.handle("app:relaunch", () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle("settings:close", () => {
  if (settingsWindow) settingsWindow.close();
});

// ============================================================
// 单实例锁（避免重复打开占用端口）
// ============================================================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ============================================================
// App 生命周期
// ============================================================
app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    dialog.showErrorBox("CatCare 启动失败", String(err?.message || err));
    app.quit();
    return;
  }

  buildMenu();
  createMainWindow();

  // 首次启动检测无 API Key，弹设置面板
  const cfg = loadConfig();
  if (!cfg.DEEPSEEK_API_KEY && !cfg.DOUBAO_API_KEY) {
    setTimeout(() => createSettingsWindow(), 600);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
