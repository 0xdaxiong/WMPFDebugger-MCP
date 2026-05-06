// cloud_audit_inject.js - Injected into mini program context via CDP Runtime.evaluate
// Hooks wx.cloud.callFunction to capture cloud function invocations
(function() {
  'use strict';
  if (window.cloudAudit && window.cloudAudit._initialized) return;

  var _hookedCalls = [];
  var _hooked = false;
  var _origCallFunction = null;
  var _wxCloud = null;

  function findWxCloud() {
    var frames = [window];
    try {
      for (var i = 0; i < window.frames.length; i++) frames.push(window.frames[i]);
    } catch(e) {}

    for (var f = 0; f < frames.length; f++) {
      try {
        var w = frames[f];
        if (w.wx && w.wx.cloud && w.wx.cloud.callFunction) return w.wx.cloud;
        if (w.cloud && w.cloud.callFunction) return w.cloud;
      } catch(e) {}
    }
    return null;
  }

  function installHook() {
    if (_hooked) return { ok: true, already: true };
    _wxCloud = findWxCloud();
    if (!_wxCloud) return { ok: false, reason: 'wx.cloud not found' };

    _origCallFunction = _wxCloud.callFunction;
    _wxCloud.callFunction = function(opts) {
      var record = {
        name: opts.name || '',
        data: null,
        timestamp: Date.now(),
        result: null,
        error: null,
      };
      try { record.data = JSON.parse(JSON.stringify(opts.data || {})); } catch(e) { record.data = String(opts.data); }

      _hookedCalls.push(record);

      var origSuccess = opts.success;
      var origFail = opts.fail;

      opts.success = function(res) {
        try { record.result = JSON.parse(JSON.stringify(res)); } catch(e) { record.result = String(res); }
        if (origSuccess) origSuccess(res);
      };
      opts.fail = function(err) {
        record.error = err && err.errMsg ? err.errMsg : String(err);
        if (origFail) origFail(err);
      };

      return _origCallFunction.call(_wxCloud, opts);
    };

    _hooked = true;
    return { ok: true, count: _hookedCalls.length };
  }

  function uninstallHook() {
    if (!_hooked || !_wxCloud || !_origCallFunction) return;
    _wxCloud.callFunction = _origCallFunction;
    _hooked = false;
  }

  function getHookedCalls() {
    return _hookedCalls;
  }

  function clearHookedCalls() {
    _hookedCalls = [];
  }

  function detectEnv() {
    var frames = [window];
    try {
      for (var i = 0; i < window.frames.length; i++) frames.push(window.frames[i]);
    } catch(e) {}

    for (var f = 0; f < frames.length; f++) {
      try {
        var w = frames[f];
        var cfg = w.__wxConfig || (w.wx && w.wx.__wxConfig);
        if (cfg && cfg.accountInfo) {
          return {
            ok: true,
            appId: cfg.accountInfo.appId || cfg.appid || '',
            envId: (cfg.cloud && cfg.cloud.env) || '',
          };
        }
      } catch(e) {}
    }
    return { ok: false };
  }

  function callFunction(name, data) {
    var cloud = _wxCloud || findWxCloud();
    if (!cloud) return Promise.reject(new Error('wx.cloud not found'));
    return new Promise(function(resolve, reject) {
      cloud.callFunction({
        name: name,
        data: data || {},
        success: function(res) { resolve({ ok: true, result: res.result || res }); },
        fail: function(err) { reject(err); },
      });
    });
  }

  window.cloudAudit = {
    _initialized: true,
    _hooked: _hooked,
    installHook: installHook,
    uninstallHook: uninstallHook,
    getHookedCalls: getHookedCalls,
    clearHookedCalls: clearHookedCalls,
    detectEnv: detectEnv,
    callFunction: callFunction,
  };
})();
