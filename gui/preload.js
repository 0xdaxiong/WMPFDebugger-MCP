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
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),

  // Route Navigator
  routesFetch: () => ipcRenderer.invoke('routes-fetch'),
  routesNavigate: (route) => ipcRenderer.invoke('routes-navigate', route),
  routesAutoVisit: () => ipcRenderer.invoke('routes-auto-visit'),
  routesStopVisit: () => ipcRenderer.invoke('routes-stop-visit'),
  routesGetCurrent: () => ipcRenderer.invoke('routes-get-current'),
  routesRefresh: () => ipcRenderer.invoke('routes-refresh'),
  routesBack: () => ipcRenderer.invoke('routes-back'),
  routesGuardEnable: () => ipcRenderer.invoke('routes-guard-enable'),
  routesGuardDisable: () => ipcRenderer.invoke('routes-guard-disable'),

  // Cloud Audit
  cloudStart: () => ipcRenderer.invoke('cloud-start'),
  cloudStop: () => ipcRenderer.invoke('cloud-stop'),
  cloudPoll: () => ipcRenderer.invoke('cloud-poll'),
  cloudStaticScan: () => ipcRenderer.invoke('cloud-static-scan'),
  cloudManualCall: (name, data) => ipcRenderer.invoke('cloud-manual-call', name, data),
  cloudClear: () => ipcRenderer.invoke('cloud-clear'),

  // wxapkg
  wxapkgLocate: () => ipcRenderer.invoke('wxapkg-locate'),
  wxapkgSelect: () => ipcRenderer.invoke('wxapkg-select'),
  wxapkgExtract: (appId) => ipcRenderer.invoke('wxapkg-extract', appId),

  // Scanner
  scanSelectDir: () => ipcRenderer.invoke('scan-select-dir'),
  scanStart: (dirPath) => ipcRenderer.invoke('scan-start', dirPath),
  scanExportJson: () => ipcRenderer.invoke('scan-export-json'),
  scanExportHtml: () => ipcRenderer.invoke('scan-export-html'),

  // UserScript
  scriptsReload: () => ipcRenderer.invoke('scripts-reload'),
  scriptsAdd: () => ipcRenderer.invoke('scripts-add'),
  scriptsRemove: (name) => ipcRenderer.invoke('scripts-remove', name),
  scriptsToggle: (name, enabled) => ipcRenderer.invoke('scripts-toggle', name, enabled),
  scriptsInject: () => ipcRenderer.invoke('scripts-inject'),

  // Anti-Debug
  antidebugEnable: () => ipcRenderer.invoke('antidebug-enable'),
  antidebugDisable: () => ipcRenderer.invoke('antidebug-disable'),

  // Events
  onLogEntry: (callback) => ipcRenderer.on('log-entry', (_, entry) => callback(entry)),
  onLogCount: (callback) => ipcRenderer.on('log-count', (_, count) => callback(count)),
  onLogsCleared: (callback) => ipcRenderer.on('logs-cleared', () => callback()),
  onServiceStatus: (callback) => ipcRenderer.on('service-status', (_, status) => callback(status)),
  onMcpStatus: (callback) => ipcRenderer.on('mcp-status', (_, status) => callback(status)),
  onAutoVisitProgress: (callback) => ipcRenderer.on('auto-visit-progress', (_, data) => callback(data)),
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (_, data) => callback(data)),
});
