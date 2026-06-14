// Preload 脚本：在隔离环境中向渲染进程暴露最小 IPC API
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("catcareElectron", {
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (cfg) => ipcRenderer.invoke("config:save", cfg),
  relaunchApp: () => ipcRenderer.invoke("app:relaunch"),
  closeSettings: () => ipcRenderer.invoke("settings:close"),
});
