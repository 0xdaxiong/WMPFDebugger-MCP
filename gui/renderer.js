// ============================
// WMPF调试工具 - Renderer Script v2.0
// ============================

document.addEventListener('DOMContentLoaded', () => {
  // ---- Panel Switching ----
  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.panel;
      navItems.forEach(n => n.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`panel-${target}`).classList.add('active');
    });
  });

  // ---- Window Controls ----
  document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.api.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.close());

  // ---- Status Management ----
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');

  function setServiceStatus(running) {
    statusBadge.className = running ? 'status-badge running' : 'status-badge stopped';
    statusText.textContent = running ? '运行中' : '未运行';
  }
  window.api.getServiceStatus().then(setServiceStatus);

  // ---- Log Management ----
  const logContainer = document.getElementById('log-container');
  const logCountEl = document.getElementById('log-count');

  function addLogEntry(entry) {
    const empty = document.getElementById('log-empty');
    if (empty) empty.style.display = 'none';

    const div = document.createElement('div');
    let typeClass = 'log-info';
    if (entry.type === 'error') typeClass = 'log-error';
    else if (entry.type === 'warning') typeClass = 'log-warning';
    else if (entry.type === 'success') typeClass = 'log-success';
    if (entry.message && (entry.message.includes('http://') || entry.message.includes('https://') || entry.message.includes('devtools://'))) {
      typeClass = 'log-link';
    }

    div.className = `log-entry ${typeClass}`;
    div.innerHTML = `<span class="log-time">${entry.time}</span><span class="log-message">${escapeHtml(entry.message)}</span>`;
    logContainer.appendChild(div);
    requestAnimationFrame(() => { logContainer.scrollTop = logContainer.scrollHeight; });
  }

  function clearLogs() {
    logContainer.innerHTML = '<div class="log-empty" id="log-empty">暂无日志</div>';
    logCountEl.textContent = '0';
  }

  // ---- Home Panel Buttons ----
  document.getElementById('btn-start-f12').addEventListener('click', () => window.api.startF12());
  document.getElementById('btn-stop-f12').addEventListener('click', () => window.api.stopF12());
  document.getElementById('btn-open-devtools').addEventListener('click', () => window.api.openDevtools());
  document.getElementById('btn-debug-webpage').addEventListener('click', () => window.api.debugWebpageNew());
  document.getElementById('btn-file-replace').addEventListener('click', () => window.api.startFileReplace());
  document.getElementById('btn-clear-log').addEventListener('click', () => window.api.clearLogs());

  // ---- MCP (Settings Panel) ----
  const mcpToggleBtn = document.getElementById('mcp-toggle-btn');
  const mcpStatusDot = document.getElementById('mcp-status-dot');
  const mcpStatusText = document.getElementById('mcp-status-text');
  let mcpRunning = false;

  document.getElementById('btn-mcp').addEventListener('click', () => {
    document.querySelector('[data-panel="settings"]').click();
    window.api.getMcpConfig().then(c => { document.getElementById('mcp-config-json').textContent = c; });
  });

  mcpToggleBtn.addEventListener('click', async () => {
    if (mcpRunning) await window.api.stopMcp();
    else await window.api.startMcp();
  });

  function updateMcpStatus(running) {
    mcpRunning = running;
    mcpStatusDot.classList.toggle('active', running);
    mcpStatusText.textContent = running ? '运行中' : '未启动';
    mcpStatusText.style.color = running ? '#22c55e' : '';
    mcpToggleBtn.textContent = running ? '停止 MCP' : '启动 MCP';
  }

  document.getElementById('mcp-copy-btn').addEventListener('click', () => {
    const text = document.getElementById('mcp-config-json').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('mcp-copy-btn');
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = '复制配置'; }, 2000);
    });
  });

  // ---- Routes Panel ----
  let autoVisitRunning = false;

  document.getElementById('btn-fetch-routes').addEventListener('click', async () => {
    const data = await window.api.routesFetch();
    if (!data || !data.pages || data.pages.length === 0) {
      document.getElementById('route-list').innerHTML = '<div class="empty-state">未获取到路由，请确保小程序已连接</div>';
      return;
    }
    document.getElementById('routes-app-info').textContent = data.appInfo.name ? `${data.appInfo.name} (${data.appInfo.appId})` : data.appInfo.appId || '';
    renderRouteList(data.pages, data.tabBarPages);
    const cur = await window.api.routesGetCurrent();
    document.getElementById('current-route').textContent = cur || '-';
  });

  function renderRouteList(pages, tabBarPages) {
    const container = document.getElementById('route-list');
    container.innerHTML = '';
    pages.forEach(page => {
      const isTab = tabBarPages.includes(page);
      const div = document.createElement('div');
      div.className = 'route-item';
      div.innerHTML = `<span class="route-path">${escapeHtml(page)}</span>${isTab ? '<span class="route-badge">TabBar</span>' : ''}<button class="small-btn route-go-btn" data-route="${escapeHtml(page)}">跳转</button>`;
      container.appendChild(div);
    });
    container.querySelectorAll('.route-go-btn').forEach(btn => {
      btn.addEventListener('click', () => window.api.routesNavigate(btn.dataset.route));
    });
  }

  document.getElementById('btn-auto-visit').addEventListener('click', async () => {
    autoVisitRunning = true;
    document.getElementById('btn-auto-visit').style.display = 'none';
    document.getElementById('btn-stop-visit').style.display = '';
    document.getElementById('routes-progress').style.display = '';
    await window.api.routesAutoVisit();
  });

  document.getElementById('btn-stop-visit').addEventListener('click', () => {
    window.api.routesStopVisit();
    autoVisitRunning = false;
    document.getElementById('btn-auto-visit').style.display = '';
    document.getElementById('btn-stop-visit').style.display = 'none';
  });

  document.getElementById('btn-refresh-page').addEventListener('click', () => window.api.routesRefresh());
  document.getElementById('btn-nav-back').addEventListener('click', () => window.api.routesBack());

  document.getElementById('chk-redirect-guard').addEventListener('change', (e) => {
    if (e.target.checked) window.api.routesGuardEnable();
    else window.api.routesGuardDisable();
  });

  // ---- Cloud Audit Panel ----
  let cloudPolling = null;

  document.getElementById('btn-cloud-start').addEventListener('click', async () => {
    const res = await window.api.cloudStart();
    if (res && res.ok) {
      document.getElementById('cloud-status').textContent = 'Hook 运行中';
      document.getElementById('btn-cloud-start').style.display = 'none';
      document.getElementById('btn-cloud-stop').style.display = '';
      document.getElementById('cloud-empty').style.display = 'none';
      startCloudPolling();
    }
  });

  document.getElementById('btn-cloud-stop').addEventListener('click', async () => {
    await window.api.cloudStop();
    stopCloudPolling();
    document.getElementById('cloud-status').textContent = '已停止';
    document.getElementById('btn-cloud-start').style.display = '';
    document.getElementById('btn-cloud-stop').style.display = 'none';
  });

  document.getElementById('btn-cloud-scan').addEventListener('click', async () => {
    document.getElementById('cloud-status').textContent = '静态扫描中...';
    const results = await window.api.cloudStaticScan();
    if (results && results.length > 0) {
      document.getElementById('cloud-empty').style.display = 'none';
      const tbody = document.getElementById('cloud-tbody');
      results.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>-</td><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.params.join(', '))}</td><td>x${r.count}</td>`;
        tbody.appendChild(tr);
      });
    }
    document.getElementById('cloud-status').textContent = `扫描完成，发现 ${(results || []).length} 项`;
  });

  document.getElementById('btn-cloud-clear').addEventListener('click', async () => {
    await window.api.cloudClear();
    document.getElementById('cloud-tbody').innerHTML = '';
    document.getElementById('cloud-empty').style.display = '';
  });

  document.getElementById('btn-cloud-call').addEventListener('click', () => {
    document.getElementById('cloud-call-modal').style.display = 'flex';
  });
  document.getElementById('cloud-call-close').addEventListener('click', () => {
    document.getElementById('cloud-call-modal').style.display = 'none';
  });
  document.getElementById('cloud-call-submit').addEventListener('click', async () => {
    const name = document.getElementById('cloud-call-name').value.trim();
    let data = {};
    try { data = JSON.parse(document.getElementById('cloud-call-data').value || '{}'); } catch {}
    const resultEl = document.getElementById('cloud-call-result');
    resultEl.style.display = '';
    resultEl.textContent = '调用中...';
    const res = await window.api.cloudManualCall(name, data);
    resultEl.textContent = JSON.stringify(res, null, 2);
  });

  function startCloudPolling() {
    if (cloudPolling) return;
    cloudPolling = setInterval(async () => {
      const calls = await window.api.cloudPoll();
      if (calls && calls.length > 0) {
        const tbody = document.getElementById('cloud-tbody');
        calls.forEach(c => {
          const tr = document.createElement('tr');
          const time = new Date(c.timestamp).toLocaleTimeString();
          tr.innerHTML = `<td>${time}</td><td>call</td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(JSON.stringify(c.data).substring(0, 80))}</td><td>${c.result ? 'ok' : c.error || '-'}</td>`;
          tbody.appendChild(tr);
        });
        document.getElementById('cloud-empty').style.display = 'none';
      }
    }, 2000);
  }

  function stopCloudPolling() {
    if (cloudPolling) { clearInterval(cloudPolling); cloudPolling = null; }
  }

  // ---- wxapkg Panel ----
  document.getElementById('btn-wxapkg-locate').addEventListener('click', async () => {
    const packages = await window.api.wxapkgLocate();
    renderPackageList(packages);
  });

  document.getElementById('btn-wxapkg-select').addEventListener('click', async () => {
    await window.api.wxapkgSelect();
  });

  document.getElementById('btn-wxapkg-extract').addEventListener('click', async () => {
    const appId = document.getElementById('wxapkg-appid').value.trim();
    if (!appId) { alert('请输入 AppID'); return; }
    document.getElementById('wxapkg-status').textContent = '解密解包中...';
    const result = await window.api.wxapkgExtract(appId);
    if (result && result.files) {
      document.getElementById('wxapkg-status').textContent = `完成，提取 ${result.files.length} 个文件`;
      document.getElementById('wxapkg-tree').style.display = '';
      const content = document.getElementById('wxapkg-tree-content');
      content.innerHTML = result.files.map(f => `<div class="file-item">${escapeHtml(f.name)} <span class="file-size">${formatSize(f.size)}</span></div>`).join('');
    } else {
      document.getElementById('wxapkg-status').textContent = result && result.error ? result.error : '解包失败';
    }
  });

  function renderPackageList(packages) {
    const container = document.getElementById('wxapkg-packages');
    if (!packages || packages.length === 0) {
      container.innerHTML = '<div class="empty-state">未找到小程序包</div>';
      return;
    }
    container.innerHTML = packages.map(p => `<div class="file-item pkg-item" data-path="${escapeHtml(p.path)}" data-appid="${escapeHtml(p.appId)}">
      <span class="pkg-appid">${escapeHtml(p.appId)}</span>
      <span class="pkg-name">${escapeHtml(p.name)}</span>
      <span class="file-size">${formatSize(p.size)}</span>
    </div>`).join('');
    container.querySelectorAll('.pkg-item').forEach(item => {
      item.addEventListener('click', () => {
        document.getElementById('wxapkg-appid').value = item.dataset.appid;
        container.querySelectorAll('.pkg-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });
  }

  // ---- Scanner Panel ----
  let scanDirPath = '';

  document.getElementById('btn-scan-dir').addEventListener('click', async () => {
    const dir = await window.api.scanSelectDir();
    if (dir) {
      scanDirPath = dir;
      document.getElementById('scan-dir-path').textContent = dir;
    }
  });

  document.getElementById('btn-scan-start').addEventListener('click', async () => {
    if (!scanDirPath) { alert('请先选择目录'); return; }
    document.getElementById('scan-progress').style.display = '';
    document.getElementById('scan-empty').style.display = 'none';
    document.getElementById('scan-table').style.display = '';
    document.getElementById('scan-tbody').innerHTML = '';

    const result = await window.api.scanStart(scanDirPath);
    document.getElementById('scan-progress').style.display = 'none';

    if (result && result.findings) {
      renderScanResults(result);
    }
  });

  document.getElementById('btn-scan-export-json').addEventListener('click', () => window.api.scanExportJson());
  document.getElementById('btn-scan-export-html').addEventListener('click', () => window.api.scanExportHtml());

  function renderScanResults(result) {
    const summary = document.getElementById('scan-summary');
    summary.style.display = '';
    summary.innerHTML = Object.entries(result.summary).map(([cat, count]) =>
      `<div class="summary-chip"><span class="chip-count">${count}</span><span class="chip-label">${escapeHtml(cat)}</span></div>`
    ).join('');

    const tbody = document.getElementById('scan-tbody');
    result.findings.slice(0, 500).forEach(f => {
      const loc = f.locations[0] || {};
      const sevClass = `sev-${f.severity}`;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="${sevClass}">${f.severity}</span></td><td>${escapeHtml(f.category)}</td><td>${escapeHtml(f.ruleName)}</td><td><code>${escapeHtml(f.value)}</code></td><td>${escapeHtml(loc.file || '')}:${loc.line || ''}</td>`;
      tbody.appendChild(tr);
    });
  }

  // ---- Scripts Panel ----
  document.getElementById('btn-scripts-add').addEventListener('click', () => window.api.scriptsAdd());
  document.getElementById('btn-scripts-inject').addEventListener('click', async () => {
    const res = await window.api.scriptsInject();
    if (res) alert(`已注入 ${res.injected}/${res.total} 个脚本`);
  });
  document.getElementById('btn-scripts-reload').addEventListener('click', async () => {
    const scripts = await window.api.scriptsReload();
    renderScriptList(scripts);
  });

  function renderScriptList(scripts) {
    const container = document.getElementById('script-list');
    if (!scripts || scripts.length === 0) {
      container.innerHTML = '<div class="empty-state">将 .js 脚本放入 userscripts/ 目录，或点击"添加脚本"</div>';
      return;
    }
    container.innerHTML = scripts.map(s => `<div class="script-item">
      <label class="toggle-label"><input type="checkbox" ${s.enabled ? 'checked' : ''} data-name="${escapeHtml(s.name)}" class="script-toggle"><span>${escapeHtml(s.name)}</span></label>
      <span class="script-meta">${escapeHtml(s.runAt)} | ${escapeHtml(s.match)}</span>
      <button class="small-btn script-remove-btn" data-name="${escapeHtml(s.name)}">删除</button>
    </div>`).join('');

    container.querySelectorAll('.script-toggle').forEach(chk => {
      chk.addEventListener('change', () => window.api.scriptsToggle(chk.dataset.name, chk.checked));
    });
    container.querySelectorAll('.script-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const scripts = await window.api.scriptsRemove(btn.dataset.name);
        renderScriptList(scripts);
      });
    });
  }

  // ---- Settings Panel ----
  document.getElementById('chk-antidebug').addEventListener('change', (e) => {
    if (e.target.checked) window.api.antidebugEnable();
    else window.api.antidebugDisable();
  });

  window.api.getPlatformInfo().then(info => {
    document.getElementById('settings-platform').textContent = info || '-';
  });

  // ---- IPC Event Listeners ----
  window.api.onLogEntry((entry) => addLogEntry(entry));
  window.api.onLogCount((count) => { logCountEl.textContent = count; });
  window.api.onLogsCleared(() => clearLogs());
  window.api.onServiceStatus((running) => setServiceStatus(running));
  window.api.onMcpStatus((running) => updateMcpStatus(running));

  window.api.onAutoVisitProgress((data) => {
    const { current, total, route } = data;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    document.getElementById('routes-progress-fill').style.width = `${pct}%`;
    document.getElementById('routes-progress-text').textContent = route === 'done' ? '遍历完成' : `${current}/${total} - ${route}`;
    if (route === 'done') {
      autoVisitRunning = false;
      document.getElementById('btn-auto-visit').style.display = '';
      document.getElementById('btn-stop-visit').style.display = 'none';
      setTimeout(() => { document.getElementById('routes-progress').style.display = 'none'; }, 2000);
    }
  });

  window.api.onScanProgress((data) => {
    const pct = data.total > 0 ? Math.round((data.scanned / data.total) * 100) : 0;
    document.getElementById('scan-progress-fill').style.width = `${pct}%`;
    document.getElementById('scan-progress-text').textContent = `${data.scanned}/${data.total} 已发现 ${data.found} 项`;
  });

  // Load scripts on panel first open
  let scriptsLoaded = false;
  document.querySelector('[data-panel="scripts"]').addEventListener('click', () => {
    if (!scriptsLoaded) { scriptsLoaded = true; window.api.scriptsReload().then(renderScriptList); }
  });

  // ---- Utilities ----
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ---- Button flash effect ----
  document.querySelectorAll('.tool-btn, .action-btn').forEach(btn => {
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
