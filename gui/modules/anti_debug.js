'use strict';

const CDPClient = require('./cdp_client');

class AntiDebug {
  constructor(cdpPort = 62000) {
    this.cdp = new CDPClient(cdpPort);
    this._enabled = false;
    this._contextListener = null;
  }

  get enabled() {
    return this._enabled;
  }

  async enable() {
    if (this._enabled) return { ok: true, already: true };

    if (!this.cdp.isConnected) {
      await this.cdp.connect();
    }

    await this._apply();
    this._enabled = true;

    this._contextListener = (data) => {
      this._apply().catch(() => {});
    };
    this.cdp.onEvent('Runtime.executionContextCreated', this._contextListener);

    return { ok: true };
  }

  async disable() {
    if (!this._enabled) return;
    this._enabled = false;

    if (this._contextListener) {
      this.cdp.offEvent('Runtime.executionContextCreated', this._contextListener);
      this._contextListener = null;
    }

    if (this.cdp.isConnected) {
      try {
        await this.cdp.send('Debugger.setSkipAllPauses', { skip: false });
        await this.cdp.send('Debugger.disable');
      } catch {}
    }
  }

  async _apply() {
    if (!this.cdp.isConnected) return;
    try {
      await this.cdp.send('Debugger.enable');
      await this.cdp.send('Debugger.setSkipAllPauses', { skip: true });
    } catch {}
  }

  async destroy() {
    await this.disable();
    this.cdp.disconnect();
  }
}

module.exports = AntiDebug;
