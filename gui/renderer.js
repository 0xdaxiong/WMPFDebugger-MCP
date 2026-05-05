// ============================
// WMPF调试工具 - Renderer Script
// ============================

document.addEventListener('DOMContentLoaded', () => {
  // ---- DOM Elements ----
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const logContainer = document.getElementById('log-container');
  const logEmpty = document.getElementById('log-empty');
  const logCountEl = document.getElementById('log-count');

  let logCount = 0;

  // ---- Window Controls ----
  document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.api.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.close());

  // ---- Status Management ----
  function setServiceStatus(running) {
    statusBadge.className = running ? 'status-badge running' : 'status-badge stopped';
    statusText.textContent = running ? '运行中' : '未运行';
  }

  window.api.getServiceStatus().then(setServiceStatus);

  // ---- Log Management ----
  function addLogEntry(entry) {
    if (logEmpty) logEmpty.style.display = 'none';

    const div = document.createElement('div');
    let typeClass = 'log-info';
    if (entry.type === 'error') typeClass = 'log-error';
    else if (entry.type === 'warning') typeClass = 'log-warning';
    else if (entry.type === 'success') typeClass = 'log-success';

    if (entry.message && (entry.message.includes('http://') || entry.message.includes('https://') || entry.message.includes('devtools://'))) {
      typeClass = 'log-link';
    }
    if (entry.message && entry.message.includes('只能作为学习用途')) {
      typeClass = 'log-warning';
    }

    div.className = `log-entry ${typeClass}`;
    div.innerHTML = `
      <span class="log-time">${entry.time}</span>
      <span class="log-message">${escapeHtml(entry.message)}</span>
    `;
    logContainer.appendChild(div);
    requestAnimationFrame(() => { logContainer.scrollTop = logContainer.scrollHeight; });
  }

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  }

  function updateLogCount(count) {
    logCount = count;
    logCountEl.textContent = count;
  }

  function clearLogs() {
    logContainer.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.id = 'log-empty';
    empty.textContent = '暂无日志';
    logContainer.appendChild(empty);
    updateLogCount(0);
  }

  // ---- Button Event Handlers ----
  document.getElementById('btn-start-f12').addEventListener('click', () => window.api.startF12());
  document.getElementById('btn-stop-f12').addEventListener('click', () => window.api.stopF12());
  document.getElementById('btn-open-devtools').addEventListener('click', () => window.api.openDevtools());
  document.getElementById('btn-debug-webpage').addEventListener('click', () => window.api.debugWebpageNew());
  document.getElementById('btn-file-replace').addEventListener('click', () => window.api.startFileReplace());
  document.getElementById('btn-clear-log').addEventListener('click', () => window.api.clearLogs());

  // ---- MCP Modal ----
  const mcpModal = document.getElementById('mcp-modal');
  const mcpStatusDot = document.getElementById('mcp-status-dot');
  const mcpStatusText = document.getElementById('mcp-status-text');
  const mcpToggleBtn = document.getElementById('mcp-toggle-btn');
  const mcpConfigJson = document.getElementById('mcp-config-json');
  const mcpCopyBtn = document.getElementById('mcp-copy-btn');
  let mcpRunning = false;

  // 打开 MCP 设置弹窗
  document.getElementById('btn-mcp').addEventListener('click', async () => {
    mcpModal.style.display = 'flex';
    // 加载配置
    const config = await window.api.getMcpConfig();
    mcpConfigJson.textContent = config;
    // 刷新状态
    const status = await window.api.getMcpStatus();
    updateMcpStatus(status);
  });

  // 关闭弹窗
  document.getElementById('mcp-modal-close').addEventListener('click', () => {
    mcpModal.style.display = 'none';
  });
  mcpModal.addEventListener('click', (e) => {
    if (e.target === mcpModal) mcpModal.style.display = 'none';
  });

  // MCP 启动/停止
  mcpToggleBtn.addEventListener('click', async () => {
    if (mcpRunning) {
      await window.api.stopMcp();
    } else {
      await window.api.startMcp();
    }
  });

  function updateMcpStatus(running) {
    mcpRunning = running;
    if (running) {
      mcpStatusDot.classList.add('active');
      mcpStatusText.textContent = '运行中';
      mcpStatusText.style.color = '#22c55e';
      mcpToggleBtn.textContent = '停止 MCP';
      mcpToggleBtn.classList.add('running');
    } else {
      mcpStatusDot.classList.remove('active');
      mcpStatusText.textContent = '未启动';
      mcpStatusText.style.color = '';
      mcpToggleBtn.textContent = '启动 MCP';
      mcpToggleBtn.classList.remove('running');
    }
  }

  // 复制配置
  mcpCopyBtn.addEventListener('click', () => {
    const text = mcpConfigJson.textContent;
    navigator.clipboard.writeText(text).then(() => {
      mcpCopyBtn.textContent = '✅ 已复制';
      mcpCopyBtn.classList.add('copied');
      setTimeout(() => {
        mcpCopyBtn.textContent = '📋 复制配置';
        mcpCopyBtn.classList.remove('copied');
      }, 2000);
    });
  });

  // ---- IPC Event Listeners ----
  window.api.onLogEntry((entry) => addLogEntry(entry));
  window.api.onLogCount((count) => updateLogCount(count));
  window.api.onLogsCleared(() => clearLogs());
  window.api.onServiceStatus((running) => setServiceStatus(running));
  window.api.onMcpStatus((running) => updateMcpStatus(running));

  // ---- Button click flash effect ----
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      this.style.transition = 'none';
      this.style.filter = 'brightness(1.3)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.style.transition = 'filter 300ms ease';
          this.style.filter = '';
        });
      });
    });
  });
});
