'use strict';

const WebSocket = require('ws');

class CDPClient {
  constructor(port = 62000) {
    this.port = port;
    this.ws = null;
    this._cmdId = 70000;
    this._pending = new Map();
    this._eventListeners = new Map();
    this._connected = false;
    this._reconnectTimer = null;
  }

  get isConnected() {
    return this._connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        resolve();
        return;
      }
      try {
        this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      } catch (e) {
        reject(e);
        return;
      }

      this.ws.on('open', () => {
        this._connected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        this._handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this._connected = false;
        this._rejectAllPending('CDP connection closed');
      });

      this.ws.on('error', (err) => {
        this._connected = false;
        this._rejectAllPending(err.message);
        reject(err);
      });
    });
  }

  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this._rejectAllPending('Disconnected');
  }

  send(method, params = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('CDP client not connected'));
        return;
      }
      const id = ++this._cmdId;
      const msg = JSON.stringify({ id, method, params });

      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this._pending.set(id, { resolve, reject, timer });
      this.ws.send(msg);
    });
  }

  evaluate(expression, timeout = 5000) {
    return this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    }, timeout);
  }

  onEvent(method, callback) {
    if (!this._eventListeners.has(method)) {
      this._eventListeners.set(method, []);
    }
    this._eventListeners.get(method).push(callback);
  }

  offEvent(method, callback) {
    const listeners = this._eventListeners.get(method);
    if (listeners) {
      const idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }

  _handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.id !== undefined && this._pending.has(data.id)) {
      const { resolve, timer } = this._pending.get(data.id);
      clearTimeout(timer);
      this._pending.delete(data.id);
      resolve(data);
      return;
    }

    if (data.method) {
      const listeners = this._eventListeners.get(data.method);
      if (listeners) {
        for (const cb of listeners) {
          try { cb(data); } catch {}
        }
      }
    }
  }

  _rejectAllPending(reason) {
    for (const [id, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    this._pending.clear();
  }
}

module.exports = CDPClient;
