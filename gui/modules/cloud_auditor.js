'use strict';

const fs = require('fs');
const path = require('path');
const CDPClient = require('./cdp_client');

const CLOUD_INJECT_JS = fs.readFileSync(path.join(__dirname, '..', 'inject', 'cloud_audit_inject.js'), 'utf8');

class CloudAuditor {
  constructor(cdpPort = 62000) {
    this.cdp = new CDPClient(cdpPort);
    this._injected = false;
    this._enabled = false;
    this._seenCount = 0;
  }

  get enabled() {
    return this._enabled;
  }

  async _inject() {
    if (!this.cdp.isConnected) {
      await this.cdp.connect();
    }
    await this.cdp.evaluate(CLOUD_INJECT_JS, 10000);
    this._injected = true;
  }

  async start() {
    if (this._enabled) return { ok: true, already: true };
    this._injected = false;
    await this._inject();

    const result = await this.cdp.evaluate(
      `JSON.stringify(window.cloudAudit.installHook())`, 5000
    );
    const value = this._extractValue(result);
    if (value) {
      try {
        const info = JSON.parse(value);
        if (info.ok) {
          this._enabled = true;
          return info;
        }
      } catch {}
    }
    return { ok: false };
  }

  async stop() {
    if (!this._enabled) return;
    this._enabled = false;
    try {
      await this._inject();
      await this.cdp.evaluate(`window.cloudAudit.uninstallHook()`, 5000);
    } catch {}
  }

  async poll() {
    if (!this._enabled) return [];
    try {
      await this._inject();

      const aliveResult = await this.cdp.evaluate(
        `(function(){try{return window.cloudAudit&&window.cloudAudit._hooked?'1':'0'}catch(e){return '0'}})()`,
        3000
      );
      const alive = this._extractValue(aliveResult);
      if (alive !== '1') {
        await this.cdp.evaluate(`JSON.stringify(window.cloudAudit.installHook())`, 5000);
        this._seenCount = 0;
      }

      const result = await this.cdp.evaluate(
        `JSON.stringify(window.cloudAudit.getHookedCalls())`, 5000
      );
      const value = this._extractValue(result);
      if (!value) return [];

      const calls = JSON.parse(value);
      if (calls.length <= this._seenCount) return [];

      const newCalls = calls.slice(this._seenCount);
      this._seenCount = calls.length;
      return newCalls;
    } catch {
      return [];
    }
  }

  async clear() {
    this._seenCount = 0;
    try {
      await this._inject();
      await this.cdp.evaluate(`window.cloudAudit.clearHookedCalls()`, 3000);
    } catch {}
  }

  async staticScan(onProgress = null) {
    if (!this.cdp.isConnected) await this.cdp.connect();
    await this._inject();

    let appId = '';
    try {
      const envResult = await this.cdp.evaluate(
        `JSON.stringify(window.cloudAudit.detectEnv())`, 5000
      );
      const envValue = this._extractValue(envResult);
      if (envValue) {
        const info = JSON.parse(envValue);
        if (info.ok) appId = info.appId || '';
      }
    } catch {}

    const scriptIds = [];
    const onParsed = (data) => {
      const p = data.params || {};
      if (p.scriptId) scriptIds.push({ id: p.scriptId, url: p.url || '' });
    };

    this.cdp.onEvent('Debugger.scriptParsed', onParsed);
    try {
      try { await this.cdp.send('Debugger.disable', {}, 3000); } catch {}
      await new Promise(r => setTimeout(r, 200));
      await this.cdp.send('Debugger.enable', {}, 5000);
      await new Promise(r => setTimeout(r, 1500));

      let prev = 0;
      for (let i = 0; i < 5; i++) {
        if (scriptIds.length === prev && prev > 0) break;
        prev = scriptIds.length;
        await new Promise(r => setTimeout(r, 400));
      }
    } finally {
      this.cdp.offEvent('Debugger.scriptParsed', onParsed);
    }

    if (onProgress) onProgress(`Found ${scriptIds.length} scripts, scanning...`);

    const RE_NAME = /name\s*:\s*['"]([^'"]+)['"]/g;
    const RE_COLL = /\.collection\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const FILE_METHODS = ['uploadFile', 'downloadFile', 'deleteFile', 'getTempFileURL'];
    const DB_OPS = ['add', 'get', 'update', 'remove', 'count', 'aggregate', 'doc', 'where'];

    const found = new Map();

    for (let i = 0; i < scriptIds.length; i++) {
      if (onProgress && i % 10 === 0) {
        onProgress(`Scanning... (${i}/${scriptIds.length}) found ${found.size}`);
      }
      try {
        const resp = await this.cdp.send('Debugger.getScriptSource', { scriptId: scriptIds[i].id }, 8000);
        const source = (resp.result && resp.result.scriptSource) || '';
        if (!source) continue;

        // callFunction references
        let pos = 0;
        while (true) {
          pos = source.indexOf('callFunction', pos);
          if (pos === -1) break;
          const window = source.substring(pos, pos + 1000);
          const nm = /name\s*:\s*['"]([^'"]+)['"]/.exec(window);
          if (nm) {
            const name = nm[1];
            const key = `fn:${name}`;
            if (!found.has(key)) {
              found.set(key, { type: 'function', name, params: [], count: 0 });
            }
            found.get(key).count++;

            const dm = /data\s*:\s*\{([^}]{1,500})\}/.exec(window);
            if (dm) {
              const fields = dm[1].match(/(\w+)\s*:/g) || [];
              const skip = new Set(['name', 'success', 'fail', 'complete', 'config', 'env', 'data']);
              for (const f of fields) {
                const field = f.replace(/\s*:$/, '');
                if (!skip.has(field) && !found.get(key).params.includes(field)) {
                  found.get(key).params.push(field);
                }
              }
            }
          }
          pos += 12;
        }

        // collection references
        let collMatch;
        const reCol = /\.collection\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        while ((collMatch = reCol.exec(source)) !== null) {
          const coll = collMatch[1];
          const key = `db:${coll}`;
          if (!found.has(key)) {
            found.set(key, { type: 'database', name: coll, params: [], count: 0 });
          }
          found.get(key).count++;
          const after = source.substring(collMatch.index + collMatch[0].length, collMatch.index + collMatch[0].length + 300);
          for (const op of DB_OPS) {
            if (after.includes(`.${op}(`) && !found.get(key).params.includes(op)) {
              found.get(key).params.push(op);
            }
          }
        }

        // storage operations
        for (const fm of FILE_METHODS) {
          if (source.includes(fm)) {
            const key = `storage:${fm}`;
            if (!found.has(key)) {
              found.set(key, { type: 'storage', name: fm, params: [], count: 0 });
            }
            found.get(key).count++;
          }
        }
      } catch {}
    }

    try { await this.cdp.send('Debugger.disable', {}, 3000); } catch {}

    const results = [];
    for (const [, info] of found) {
      results.push({
        name: info.name,
        type: info.type,
        appId,
        params: info.params,
        count: info.count,
      });
    }

    if (onProgress) onProgress(`Scan complete, found ${results.length} cloud references`);
    return results;
  }

  async manualCall(name, data = {}) {
    await this._inject();
    const safeName = name.replace(/'/g, "\\'");
    const safeData = JSON.stringify(data);

    await this.cdp.evaluate(`window._cloudAuditLastResult=null`, 3000);
    const js = `window.cloudAudit.callFunction('${safeName}', ${safeData})` +
      `.then(function(r){window._cloudAuditLastResult=JSON.stringify(r)})` +
      `['catch'](function(e){window._cloudAuditLastResult=JSON.stringify({ok:false,error:e.message||String(e)})})`;
    await this.cdp.evaluate(js, 15000);

    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 500));
      const result = await this.cdp.evaluate(`window._cloudAuditLastResult`, 5000);
      const value = this._extractValue(result);
      if (value) {
        try { return JSON.parse(value); } catch {}
        return { ok: false, error: 'parse error' };
      }
    }
    return { ok: false, error: 'timeout' };
  }

  _extractValue(result) {
    if (!result) return null;
    const r = result.result || {};
    return r.value !== undefined ? r.value : null;
  }

  destroy() {
    this._enabled = false;
    this.cdp.disconnect();
  }
}

module.exports = CloudAuditor;
