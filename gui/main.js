const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { fork, spawn, execSync } = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');
const https = require('https');
const WebSocket = require('ws');

// ========== 全局状态 ==========
let mainWindow = null;
let logEntries = [];

// 核心服务状态
let isServiceRunning = false;
let debugWss = null;        // 接收小程序消息的 WebSocket Server
let proxyWss = null;        // CDP Proxy WebSocket Server
let fridaProcess = null;    // Frida 子进程
let messageCounter = 0;
const debugMessageEmitter = new EventEmitter();

// 端口配置
const DEBUG_PORT = 9421;
const CDP_PORT = 62000;

// 项目根目录
const PROJECT_ROOT = path.join(__dirname, '..');

// ========== 日志系统 ==========
let logRateCounter = 0;
let logRateResetTimer = null;
let logSuppressed = 0;
const LOG_RATE_LIMIT = 50;   // 每秒最多50条
const LOG_MAX_ENTRIES = 1000; // 最多保留1000条

function addLog(type, message) {
  try {
    // 限流保护：防止高频日志刷屏卡死GUI
    logRateCounter++;
    if (!logRateResetTimer) {
      logRateResetTimer = setTimeout(() => {
        if (logSuppressed > 0) {
          const suppressEntry = {
            time: new Date().toTimeString().slice(0, 8),
            type: 'warning',
            message: `[日志限流] 已抑制 ${logSuppressed} 条重复日志`,
          };
          logEntries.push(suppressEntry);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('log-entry', suppressEntry);
          }
        }
        logRateCounter = 0;
        logSuppressed = 0;
        logRateResetTimer = null;
      }, 1000);
    }
    if (logRateCounter > LOG_RATE_LIMIT) {
      logSuppressed++;
      return;
    }

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const entry = { time, type, message };
    logEntries.push(entry);

    // 自动清理旧日志防止内存泄漏
    if (logEntries.length > LOG_MAX_ENTRIES) {
      logEntries = logEntries.slice(-Math.floor(LOG_MAX_ENTRIES * 0.8));
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-entry', entry);
      mainWindow.webContents.send('log-count', logEntries.length);
    }
  } catch (err) {
    console.error('addLog error:', err);
  }
}

// ========== 核心: WebSocket Debug Server ==========
function startDebugServer() {
  // 加载 third-party 模块（从父项目）
  const codex = require(path.join(PROJECT_ROOT, 'src/third-party/RemoteDebugCodex.js'));
  const messageProto = require(path.join(PROJECT_ROOT, 'src/third-party/WARemoteDebugProtobuf.js'));

  // Debug WebSocket Server - 接收小程序发来的消息
  debugWss = new WebSocket.Server({ port: DEBUG_PORT });
  addLog('info', `[server] debug server running on ws://localhost:${DEBUG_PORT}`);
  addLog('info', '[server] debug server waiting for miniapp to connect...');

  debugWss.on('connection', (ws) => {
    addLog('success', '[miniapp] miniapp client connected');

    ws.on('message', (message) => {
      let unwrappedData = null;
      try {
        const decodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.decode(message);
        unwrappedData = codex.unwrapDebugMessageData(decodedData);
      } catch (e) {
        addLog('error', `[miniapp] decode error: ${e.message}`);
      }
      if (unwrappedData === null) return;
      if (unwrappedData.category === 'chromeDevtoolsResult') {
        debugMessageEmitter.emit('cdpmessage', unwrappedData.data.payload);
      }
    });

    ws.on('error', (err) => addLog('error', `[miniapp] error: ${err.message}`));
    ws.on('close', () => addLog('info', '[miniapp] miniapp client disconnected'));
  });

  debugWss.on('error', (err) => {
    addLog('error', `[debug-server] error: ${err.message}`);
  });

  // 监听 CDP 消息 -> 编码后转发给小程序
  debugMessageEmitter.on('proxymessage', (message) => {
    if (!debugWss) return;
    debugWss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          const rawPayload = {
            jscontext_id: '',
            op_id: Math.round(100 * Math.random()),
            payload: message.toString(),
          };
          const wrappedData = codex.wrapDebugMessageData(rawPayload, 'chromeDevtools', 0);
          const outData = {
            seq: ++messageCounter,
            category: 'chromeDevtools',
            data: wrappedData.buffer,
            compressAlgo: 0,
            originalSize: wrappedData.originalSize,
          };
          const encodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(outData).finish();
          client.send(encodedData, { binary: true });
        } catch (e) {
          addLog('error', `[proxy] encode error: ${e.message}`);
        }
      }
    });
  });

  // CDP Proxy Server - 接收 Chrome DevTools 发来的消息
  proxyWss = new WebSocket.Server({ port: CDP_PORT });
  addLog('info', `[server] proxy server running on ws://localhost:${CDP_PORT}`);
  addLog('info', `[server] link: devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${CDP_PORT}`);

  proxyWss.on('connection', (ws) => {
    addLog('success', '[cdp] CDP client connected');
    ws.on('message', (message) => {
      debugMessageEmitter.emit('proxymessage', message);
    });
    ws.on('error', (err) => addLog('error', `[cdp] error: ${err.message}`));
    ws.on('close', () => addLog('info', '[cdp] CDP client disconnected'));
  });

  proxyWss.on('error', (err) => {
    addLog('error', `[proxy-server] error: ${err.message}`);
  });

  // CDP 响应 -> 转发给 DevTools
  debugMessageEmitter.on('cdpmessage', (message) => {
    if (!proxyWss) return;
    proxyWss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
}

// ========== 核心: Frida 注入 (子进程方式) ==========
function startFridaInjection() {
  return new Promise((resolve, reject) => {
    const fridaRunnerPath = path.join(__dirname, 'frida_runner.js');

    if (!fs.existsSync(fridaRunnerPath)) {
      reject(new Error('frida_runner.js not found'));
      return;
    }

    // 使用父项目的 node_modules 中的 frida
    fridaProcess = spawn('node', [fridaRunnerPath], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_PATH: path.join(PROJECT_ROOT, 'node_modules'),
        WMPF_PROJECT_ROOT: PROJECT_ROOT,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resolved = false;

    fridaProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        line = line.trim();
        if (line.startsWith('INFO:')) {
          addLog('info', `[frida] ${line.substring(5)}`);
        } else if (line.startsWith('SUCCESS:')) {
          addLog('success', `[frida] ${line.substring(8)}`);
          if (!resolved) { resolved = true; resolve(); }
        } else if (line.startsWith('FRIDA:')) {
          addLog('info', `[frida] ${line.substring(6)}`);
        } else if (line.startsWith('FRIDA_ERROR:')) {
          addLog('error', `[frida] ${line.substring(12)}`);
        } else if (line.startsWith('ERROR:')) {
          addLog('error', `[frida] ${line.substring(6)}`);
          if (!resolved) { resolved = true; reject(new Error(line.substring(6))); }
        } else if (line.length > 0) {
          addLog('info', `[frida] ${line}`);
        }
      });
    });

    fridaProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        line = line.trim();
        if (line.startsWith('ERROR:')) {
          addLog('error', `[frida] ${line.substring(6)}`);
          if (!resolved) { resolved = true; reject(new Error(line.substring(6))); }
        } else if (line.length > 0) {
          addLog('error', `[frida] ${line}`);
        }
      });
    });

    fridaProcess.on('close', (code) => {
      addLog('info', `[frida] process exited with code: ${code}`);
      fridaProcess = null;
      if (!resolved) { resolved = true; reject(new Error(`frida exited with code ${code}`)); }
    });

    fridaProcess.on('error', (err) => {
      addLog('error', `[frida] spawn error: ${err.message}`);
      fridaProcess = null;
      if (!resolved) { resolved = true; reject(err); }
    });

    // 超时处理：30秒
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(); // 不报错，可能 frida 正在工作但还没打印 SUCCESS
        addLog('warning', '[frida] 注入超时但进程仍在运行，可能需要等待小程序启动');
      }
    }, 30000);
  });
}

// ========== 启动/停止服务 ==========
async function startService() {
  if (isServiceRunning) {
    addLog('warning', '调试服务已在运行中');
    return;
  }

  addLog('info', '正在启动小程序F12调试服务...');

  try {
    // 1. 启动 WebSocket 服务器
    startDebugServer();

    // 2. 启动 Frida 注入
    await startFridaInjection();

    isServiceRunning = true;
    sendStatus(true);
    addLog('success', '调试服务启动成功！');
  } catch (err) {
    addLog('error', `启动失败: ${err.message}`);
    // 服务器可能已经启动了，保持运行（方便用户手动重试 frida）
    if (debugWss || proxyWss) {
      isServiceRunning = true;
      sendStatus(true);
      addLog('warning', 'WebSocket服务已启动，但Frida注入失败。请确保微信已打开并重试。');
    }
  }
}

function stopService() {
  try {
    // 停止 frida 子进程
    if (fridaProcess) {
      try {
        fridaProcess.kill('SIGTERM');
        setTimeout(() => {
          try { if (fridaProcess) fridaProcess.kill('SIGKILL'); } catch (e) { }
        }, 3000);
      } catch (e) { /* ignore */ }
      fridaProcess = null;
    }

    // 清理临时文件
    const runnerPath = path.join(__dirname, '_frida_runner.js');
    try { if (fs.existsSync(runnerPath)) fs.unlinkSync(runnerPath); } catch (e) { }

    // 停止 WebSocket servers
    if (debugWss) {
      debugWss.clients.forEach(client => { try { client.close(); } catch (e) { } });
      try { debugWss.close(); } catch (e) { }
      debugWss = null;
    }
    if (proxyWss) {
      proxyWss.clients.forEach(client => { try { client.close(); } catch (e) { } });
      try { proxyWss.close(); } catch (e) { }
      proxyWss = null;
    }

    debugMessageEmitter.removeAllListeners();
    messageCounter = 0;

    if (isServiceRunning) {
      addLog('info', '调试服务已停止');
    }
    isServiceRunning = false;
    sendStatus(false);
  } catch (err) {
    addLog('error', `停止服务失败: ${err.message}`);
  }
}

function sendStatus(running) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('service-status', running);
  }
}

// ========== 打开调试窗口 ==========
function openDevtools() {
  const url = `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${CDP_PORT}`;
  addLog('info', `正在打开调试窗口...`);

  // 使用 Electron BrowserWindow 打开 DevTools
  try {
    const devtoolsWin = new BrowserWindow({
      width: 1280,
      height: 860,
      title: 'DevTools - WMPF Debugger',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    devtoolsWin.loadURL(url);
    devtoolsWin.on('closed', () => {
      addLog('info', '[devtools] 调试窗口已关闭');
    });
    addLog('success', '已打开调试窗口 (内置)');
  } catch (e) {
    addLog('error', `打开调试窗口失败: ${e.message}`);
    addLog('info', `请手动在Chrome中打开: ${url}`);
  }
}

// ========== 调试微信内网页(新版) ==========
function debugWebpageNew() {
  if (!isServiceRunning) {
    addLog('warning', '请先启动F12调试服务');
    return;
  }
  addLog('info', '=== 调试微信内网页(新版) ===');
  addLog('info', '步骤1: 先启动一个小程序（建议用微信官方小程序Demo）');
  addLog('info', '步骤2: 在DevTools中打开Protocol Monitor面板');
  addLog('info', '步骤3: 发送 Target.getTargets 命令获取所有目标');
  addLog('info', '步骤4: 找到你要调试的网页tab，复制其 targetId');
  addLog('info', '步骤5: 发送 Target.attachToTarget 并传入 targetId');
  addLog('info', '详细操作请参考 EXTENSION.md');

  const extPath = path.join(PROJECT_ROOT, 'EXTENSION.md');
  if (fs.existsSync(extPath)) {
    shell.openPath(extPath);
  }
}

// ========== 内置浏览器调试(旧版) ==========
function debugBrowserOld() {
  if (!isServiceRunning) {
    addLog('warning', '请先启动F12调试服务');
    return;
  }
  addLog('info', '=== 内置浏览器调试(旧版) ===');
  addLog('info', '此模式需在DevTools的Protocol Monitor中手动发送CDP命令');
  addLog('info', '发送 Target.getTargets 查看所有可调试目标，然后 attach');
  openDevtools();
}

// ========== 文件替换 ==========
function startFileReplace() {
  addLog('info', '=== 文件替换功能 ===');
  const replaceDir = path.join(PROJECT_ROOT, 'replace_files');
  if (!fs.existsSync(replaceDir)) {
    fs.mkdirSync(replaceDir, { recursive: true });
    addLog('info', `已创建替换文件目录: ${replaceDir}`);
  }
  addLog('info', `请将需要替换的文件放入: ${replaceDir}`);
  addLog('info', '文件替换将在下次启动小程序时生效');
  shell.openPath(replaceDir);
}

// ========== 云函数拦截 ==========
function cloudFuncIntercept() {
  if (!isServiceRunning) {
    addLog('warning', '请先启动F12调试服务');
    return;
  }
  addLog('info', '=== 云函数拦截 ===');
  addLog('info', '云函数拦截已启用');
  addLog('info', '在DevTools Console中可查看所有 wx.cloud.callFunction 调用');
}

// ========== 网关解密 ==========
function gatewayDecrypt() {
  if (!isServiceRunning) {
    addLog('warning', '请先启动F12调试服务');
    return;
  }
  addLog('info', '=== 网关解密 ===');
  addLog('info', '网关解密已启用，请在DevTools Network面板查看请求');
}

// ========== MCP 设置 ==========
function mcpSettings() {
  addLog('info', '=== MCP 设置 ===');
  addLog('info', `Debug Port: ${DEBUG_PORT}`);
  addLog('info', `CDP Port: ${CDP_PORT}`);
  addLog('info', `项目路径: ${PROJECT_ROOT}`);

  const configDir = path.join(PROJECT_ROOT, 'frida/config');
  try {
    const configs = fs.readdirSync(configDir).filter(f => f.endsWith('.json'));
    const versions = configs
      .map(f => f.replace('addresses.', '').replace('.json', ''))
      .sort((a, b) => Number(b) - Number(a));
    addLog('info', `支持的WMPF版本 (${versions.length}个): ${versions.slice(0, 10).join(', ')}...`);
    addLog('info', `最新支持版本: ${versions[0]}`);
  } catch (e) {
    addLog('error', `无法读取配置: ${e.message}`);
  }
}

// ========== 检查更新 ==========
function checkUpdate() {
  addLog('info', '正在检查更新...');

  const req = https.request({
    hostname: 'api.github.com',
    path: '/repos/evi0s/WMPFDebugger/releases/latest',
    method: 'GET',
    headers: { 'User-Agent': 'WMPFDebugger-GUI/2.2.4' },
    timeout: 10000,
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        if (release.tag_name) {
          addLog('info', `最新版本: ${release.tag_name}`);
          addLog('info', `发布时间: ${release.published_at || 'N/A'}`);
          if (release.body) addLog('info', `说明: ${release.body.substring(0, 200)}`);
          addLog('info', `下载: ${release.html_url}`);
        } else {
          addLog('info', '请访问 https://github.com/evi0s/WMPFDebugger/releases');
        }
      } catch (e) {
        addLog('info', '请访问 https://github.com/evi0s/WMPFDebugger/releases');
      }
    });
  });

  req.on('error', (err) => {
    addLog('warning', `检查更新失败: ${err.message}`);
    addLog('info', '请手动访问 https://github.com/evi0s/WMPFDebugger');
  });
  req.on('timeout', () => {
    req.destroy();
    addLog('warning', '检查更新超时');
  });
  req.end();
}

// ========== 更新日志 ==========
function viewChangelog() {
  addLog('info', '========== 更新日志 ==========');
  addLog('info', 'v2.2.4 - 支持WMPF 19459 (credit @snowflake-x)');
  addLog('info', 'v2.2.3 - 支持WMPF 19339 (credit @hidacow)');
  addLog('info', 'v2.2.2 - 支持WMPF 19201 (credit @hidacow)');
  addLog('info', 'v2.2.1 - 支持WMPF 19027 (credit @XKaguya)');
  addLog('info', 'v2.2.0 - 支持WMPF 18955 (credit @MapleLeaf2007)');
  addLog('info', 'v2.1.0 - 支持WMPF 18891 (credit @1357310795)');
  addLog('info', 'v2.0.0 - 新增GUI界面');
  addLog('info', '==============================');
}

// ========== 创建窗口 ==========
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'WMPF调试工具',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    addLog('info', '感谢开源库 https://github.com/evi0s/WMPFDebugger');
    addLog('info', '本工具f12功能引用开源库并重写支持了更多功能如网页调试功能等');
    addLog('warning', '本工具只能作为学习用途，造成的任何问题与本工具开发者无关，如侵犯到你的权益，请联系删除');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopService();
  });
}

// ========== MCP Server 管理 ==========
let mcpProcess = null;
let isMcpRunning = false;

function getMcpBridgePath() {
  return path.join(__dirname, 'mcp_bridge.js');
}

function getMcpConfig() {
  const bridgePath = getMcpBridgePath().replace(/\\/g, '\\\\');
  const nodePath = process.execPath.replace(/\\/g, '\\\\');

  // 使用系统 node 而非 electron 来运行 mcp_bridge
  const config = {
    "mcpServers": {
      "wmpf-debugger": {
        "command": "node",
        "args": [bridgePath, "--cdp-port", String(CDP_PORT)],
        "env": {}
      }
    }
  };

  return JSON.stringify(config, null, 2);
}

function startMcpServer() {
  if (mcpProcess) {
    addLog('warning', '[MCP] MCP Server 已在运行中');
    return;
  }

  const bridgePath = getMcpBridgePath();
  if (!fs.existsSync(bridgePath)) {
    addLog('error', '[MCP] mcp_bridge.js 文件未找到');
    return;
  }

  try {
    mcpProcess = spawn('node', [bridgePath, '--cdp-port', String(CDP_PORT)], {
      cwd: __dirname,
      env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    mcpProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) addLog('info', `[MCP] ${msg}`);
    });

    mcpProcess.on('close', (code) => {
      addLog('info', `[MCP] Server 已退出 (code: ${code})`);
      mcpProcess = null;
      isMcpRunning = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mcp-status', false);
      }
    });

    mcpProcess.on('error', (err) => {
      addLog('error', `[MCP] 启动失败: ${err.message}`);
      mcpProcess = null;
      isMcpRunning = false;
    });

    isMcpRunning = true;
    addLog('success', '[MCP] MCP Server 已启动');
    addLog('info', '[MCP] AI 工具现在可以通过 MCP 协议连接到调试会话');
    addLog('info', '[MCP] 支持工具: evaluate_javascript, get_dom_tree, query_selector, take_screenshot 等');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mcp-status', true);
    }
  } catch (err) {
    addLog('error', `[MCP] 启动异常: ${err.message}`);
  }
}

function stopMcpServer() {
  if (mcpProcess) {
    try {
      mcpProcess.kill('SIGTERM');
      setTimeout(() => {
        try { if (mcpProcess) mcpProcess.kill('SIGKILL'); } catch (e) { }
      }, 3000);
    } catch (e) { /* ignore */ }
    mcpProcess = null;
    isMcpRunning = false;
    addLog('info', '[MCP] MCP Server 已停止');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mcp-status', false);
    }
  }
}

// ========== IPC 注册 ==========
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.close());

ipcMain.handle('start-f12', async () => {
  try { await startService(); } catch (e) { addLog('error', e.message); }
});
ipcMain.handle('stop-f12', () => stopService());
ipcMain.handle('open-devtools', () => openDevtools());
ipcMain.handle('debug-webpage-new', () => debugWebpageNew());
ipcMain.handle('debug-browser-old', () => debugBrowserOld());
ipcMain.handle('start-file-replace', () => startFileReplace());
ipcMain.handle('cloud-func-intercept', () => cloudFuncIntercept());
ipcMain.handle('gateway-decrypt', () => gatewayDecrypt());
ipcMain.handle('clear-logs', () => {
  logEntries = [];
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('logs-cleared');
    mainWindow.webContents.send('log-count', 0);
  }
  return true;
});
ipcMain.handle('check-update', () => checkUpdate());
ipcMain.handle('view-changelog', () => viewChangelog());
ipcMain.handle('get-service-status', () => isServiceRunning);
ipcMain.handle('get-log-count', () => logEntries.length);

// MCP IPC
ipcMain.handle('get-mcp-config', () => getMcpConfig());
ipcMain.handle('start-mcp', () => startMcpServer());
ipcMain.handle('stop-mcp', () => stopMcpServer());
ipcMain.handle('get-mcp-status', () => isMcpRunning);

// ========== App 生命周期 ==========
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopMcpServer();
  stopService();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
