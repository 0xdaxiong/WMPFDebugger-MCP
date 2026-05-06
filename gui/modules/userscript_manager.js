'use strict';

const fs = require('fs');
const path = require('path');
const CDPClient = require('./cdp_client');

class UserScriptManager {
  constructor(cdpPort = 62000, scriptsDir = null) {
    this.cdp = new CDPClient(cdpPort);
    this.scriptsDir = scriptsDir || path.join(path.dirname(__dirname), '..', 'userscripts');
    this.scripts = [];
    this._configPath = path.join(this.scriptsDir, 'config.json');
    this._config = {};
    this._loadConfig();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(this._configPath)) {
        this._config = JSON.parse(fs.readFileSync(this._configPath, 'utf8'));
      }
    } catch {
      this._config = {};
    }
  }

  _saveConfig() {
    try {
      fs.mkdirSync(this.scriptsDir, { recursive: true });
      fs.writeFileSync(this._configPath, JSON.stringify(this._config, null, 2));
    } catch {}
  }

  parseMetadata(source) {
    const metadata = {};
    let inBlock = false;
    for (const line of source.split('\n')) {
      const stripped = line.trim();
      if (stripped === '// ==UserScript==') { inBlock = true; continue; }
      if (stripped === '// ==/UserScript==') break;
      if (inBlock && stripped.startsWith('// @')) {
        const m = stripped.match(/^\/\/\s*@(\S+)\s*(.*?)\s*$/);
        if (m) metadata[m[1]] = m[2];
      }
    }
    return metadata;
  }

  loadScripts() {
    this.scripts = [];
    if (!fs.existsSync(this.scriptsDir)) return this.scripts;

    const files = fs.readdirSync(this.scriptsDir)
      .filter(f => f.endsWith('.js'))
      .sort();

    for (const file of files) {
      const filePath = path.join(this.scriptsDir, file);
      try {
        const source = fs.readFileSync(filePath, 'utf8');
        const meta = this.parseMetadata(source);
        const script = {
          name: meta.name || path.basename(file, '.js'),
          description: meta.description || '',
          match: meta.match || '*',
          runAt: meta['run-at'] || 'document-start',
          injectInto: meta['inject-into'] || 'page',
          source,
          filePath,
          enabled: this._config[file] !== false,
        };
        this.scripts.push(script);
      } catch {}
    }
    return this.scripts;
  }

  addScript(filePath) {
    const fileName = path.basename(filePath);
    const destPath = path.join(this.scriptsDir, fileName);
    fs.mkdirSync(this.scriptsDir, { recursive: true });
    fs.copyFileSync(filePath, destPath);
    this._config[fileName] = true;
    this._saveConfig();
    return this.loadScripts();
  }

  removeScript(name) {
    const script = this.scripts.find(s => s.name === name);
    if (script && fs.existsSync(script.filePath)) {
      fs.unlinkSync(script.filePath);
      const fileName = path.basename(script.filePath);
      delete this._config[fileName];
      this._saveConfig();
    }
    return this.loadScripts();
  }

  toggleScript(name, enabled) {
    const script = this.scripts.find(s => s.name === name);
    if (script) {
      const fileName = path.basename(script.filePath);
      this._config[fileName] = enabled;
      this._saveConfig();
      script.enabled = enabled;
    }
    return this.scripts;
  }

  _buildWrapper(script) {
    const safeName = script.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `(function() {
  'use strict';
  try {
${script.source.split('\n').map(l => '    ' + l).join('\n')}
  } catch(__e__) {
    console.error('[UserScript] Error in "${safeName}":', __e__);
  }
})();`;
  }

  async injectAll() {
    if (!this.cdp.isConnected) {
      await this.cdp.connect();
    }

    const enabled = this.scripts.filter(s => s.enabled);
    if (enabled.length === 0) return { injected: 0 };

    await this.cdp.send('Page.enable');

    let injected = 0;
    for (const script of enabled) {
      const wrapped = this._buildWrapper(script);
      try {
        if (script.runAt === 'document-start') {
          await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: wrapped });
        } else {
          await this.cdp.evaluate(wrapped, 10000);
        }
        injected++;
      } catch {}
    }

    return { injected, total: enabled.length };
  }

  async injectImmediate() {
    if (!this.cdp.isConnected) {
      await this.cdp.connect();
    }

    const enabled = this.scripts.filter(s => s.enabled);
    let injected = 0;
    for (const script of enabled) {
      const wrapped = this._buildWrapper(script);
      try {
        await this.cdp.evaluate(wrapped, 10000);
        injected++;
      } catch {}
    }
    return { injected, total: enabled.length };
  }

  getScriptList() {
    return this.scripts.map(s => ({
      name: s.name,
      description: s.description,
      match: s.match,
      runAt: s.runAt,
      enabled: s.enabled,
      filePath: s.filePath,
    }));
  }

  destroy() {
    this.cdp.disconnect();
  }
}

module.exports = UserScriptManager;
