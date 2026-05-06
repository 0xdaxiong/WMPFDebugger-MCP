// nav_inject.js - Injected into mini program context via CDP Runtime.evaluate
// Provides window.nav object for route enumeration and navigation control
(function() {
  'use strict';
  if (window.nav && window.nav._initialized) return;

  var wxFrame = null;
  var frames = [window];
  try {
    for (var i = 0; i < window.frames.length; i++) {
      frames.push(window.frames[i]);
    }
  } catch(e) {}

  for (var f = 0; f < frames.length; f++) {
    try {
      var w = frames[f];
      if (w.wx && w.__wxConfig && w.__wxConfig.pages) {
        wxFrame = w;
        break;
      }
      if (w.__wxAppCode__ && w.__wxConfig) {
        wxFrame = w;
        break;
      }
    } catch(e) {}
  }

  if (!wxFrame) {
    try {
      if (window.wx && window.__wxConfig) wxFrame = window;
    } catch(e) {}
  }

  var config = null;
  var allPages = [];
  var tabBarPages = [];

  if (wxFrame && wxFrame.__wxConfig) {
    config = wxFrame.__wxConfig;
    allPages = (config.pages || []).slice();
    if (config.tabBar && config.tabBar.list) {
      tabBarPages = config.tabBar.list.map(function(item) {
        return item.pagePath || item.url || '';
      }).filter(Boolean);
    }
  }

  var _redirectGuardEnabled = false;
  var _blockedRedirects = [];
  var _origRedirectTo = null;
  var _origReLaunch = null;

  function goTo(route) {
    if (!wxFrame || !wxFrame.wx) return;
    route = route.replace(/^\/+/, '');
    var isTabBar = tabBarPages.indexOf(route) !== -1;
    if (isTabBar) {
      wxFrame.wx.switchTab({ url: '/' + route, fail: function() {
        wxFrame.wx.reLaunch({ url: '/' + route });
      }});
    } else {
      wxFrame.wx.navigateTo({ url: '/' + route, fail: function() {
        wxFrame.wx.redirectTo({ url: '/' + route, fail: function() {
          wxFrame.wx.reLaunch({ url: '/' + route });
        }});
      }});
    }
  }

  function _safeNavigate(route) {
    if (!wxFrame || !wxFrame.wx) return;
    route = route.replace(/^\/+/, '');
    wxFrame.wx.reLaunch({ url: '/' + route, fail: function() {
      var isTabBar = tabBarPages.indexOf(route) !== -1;
      if (isTabBar) {
        wxFrame.wx.switchTab({ url: '/' + route, fail: function() {
          wxFrame.wx.redirectTo({ url: '/' + route });
        }});
      } else {
        wxFrame.wx.redirectTo({ url: '/' + route });
      }
    }});
  }

  function back(delta) {
    if (!wxFrame || !wxFrame.wx) return;
    wxFrame.wx.navigateBack({ delta: delta || 1 });
  }

  function getCurrentRoute() {
    if (!wxFrame || !wxFrame.getCurrentPages) return '';
    try {
      var pages = wxFrame.getCurrentPages();
      if (!pages || !pages.length) return '';
      var cur = pages[pages.length - 1];
      return cur.route || cur.__route__ || '';
    } catch(e) { return ''; }
  }

  function enableRedirectGuard() {
    if (_redirectGuardEnabled) return { ok: true, already: true };
    if (!wxFrame || !wxFrame.wx) return { ok: false, reason: 'no wx frame' };

    _origRedirectTo = wxFrame.wx.redirectTo;
    _origReLaunch = wxFrame.wx.reLaunch;

    wxFrame.wx.redirectTo = function(opts) {
      _blockedRedirects.push({ type: 'redirectTo', url: opts.url, time: Date.now() });
      if (opts.fail) opts.fail({ errMsg: 'redirectTo:blocked by guard' });
    };
    wxFrame.wx.reLaunch = function(opts) {
      _blockedRedirects.push({ type: 'reLaunch', url: opts.url, time: Date.now() });
      if (opts.fail) opts.fail({ errMsg: 'reLaunch:blocked by guard' });
    };

    _redirectGuardEnabled = true;
    return { ok: true };
  }

  function disableRedirectGuard() {
    if (!_redirectGuardEnabled) return;
    if (wxFrame && wxFrame.wx) {
      if (_origRedirectTo) wxFrame.wx.redirectTo = _origRedirectTo;
      if (_origReLaunch) wxFrame.wx.reLaunch = _origReLaunch;
    }
    _redirectGuardEnabled = false;
  }

  function getBlockedRedirects() {
    return _blockedRedirects.slice();
  }

  window.nav = {
    _initialized: true,
    wxFrame: wxFrame,
    config: config,
    allPages: allPages,
    tabBarPages: tabBarPages,
    goTo: goTo,
    _safeNavigate: _safeNavigate,
    back: back,
    getCurrentRoute: getCurrentRoute,
    enableRedirectGuard: enableRedirectGuard,
    disableRedirectGuard: disableRedirectGuard,
    getBlockedRedirects: getBlockedRedirects,
  };
})();
