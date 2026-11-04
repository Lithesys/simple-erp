/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();
ipcRenderer.on("desktop:update-state", (_event, state) => {
  for (const listener of listeners) listener(state);
});

contextBridge.exposeInMainWorld("erpDesktop", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  testDatabase: (config) => ipcRenderer.invoke("desktop:test-database", config),
  saveDatabase: (config, initialize, accessToken, recovery) =>
    ipcRenderer.invoke("desktop:save-database", config, initialize, accessToken, recovery),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  printPage: () => ipcRenderer.invoke("desktop:print-page"),
  onUpdateState: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
});
