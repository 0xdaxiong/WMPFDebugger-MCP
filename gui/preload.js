const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // Core functions
  startF12: () => ipcRenderer.invoke('start-f12'),
  stopF12: () => ipcRenderer.invoke('stop-f12'),
  openDevtools: () => ipcRenderer.invoke('open-devtools'),
  debugWebpageNew: () => ipcRenderer.invoke('debug-webpage-new'),
  debugBrowserOld: () => ipcRenderer.invoke('debug-browser-old'),

  // Extended functions
  startFileReplace: () => ipcRenderer.invoke('start-file-replace'),
  cloudFuncIntercept: () => ipcRenderer.invoke('cloud-func-intercept'),
  gatewayDecrypt: () => ipcRenderer.invoke('gateway-decrypt'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  viewChangelog: () => ipcRenderer.invoke('view-changelog'),

  // MCP functions
  getMcpConfig: () => ipcRenderer.invoke('get-mcp-config'),
  startMcp: () => ipcRenderer.invoke('start-mcp'),
  stopMcp: () => ipcRenderer.invoke('stop-mcp'),
  getMcpStatus: () => ipcRenderer.invoke('get-mcp-status'),

  // Status
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),
  getLogCount: () => ipcRenderer.invoke('get-log-count'),

  // Events
  onLogEntry: (callback) => ipcRenderer.on('log-entry', (_, entry) => callback(entry)),
  onLogCount: (callback) => ipcRenderer.on('log-count', (_, count) => callback(count)),
  onLogsCleared: (callback) => ipcRenderer.on('logs-cleared', () => callback()),
  onServiceStatus: (callback) => ipcRenderer.on('service-status', (_, status) => callback(status)),
  onMcpStatus: (callback) => ipcRenderer.on('mcp-status', (_, status) => callback(status)),
});
