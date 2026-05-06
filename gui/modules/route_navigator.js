'use strict';

const fs = require('fs');
const path = require('path');
const CDPClient = require('./cdp_client');

const NAV_INJECT_JS = fs.readFileSync(path.join(__dirname, '..', 'inject', 'nav_inject.js'), 'utf8');

class RouteNavigator {
  constructor(cdpPort = 62000) {
    this.cdp = new CDPClient(cdpPort);
    this.pages = [];
    this.tabBarPages = [];
    this.appInfo = {};
    this._injected = false;
  }

  async _ensure(force = false) {
    if (!this.cdp.isConnected) {
      await this.cdp.connect();
    }
    if (force || !this._injected) {
      await this.cdp.evaluate(NAV_INJECT_JS, 10000);
      this._injected = true;
    }
  }

  async fetchRoutes() {
    await this._ensure(true);
    const result = await this.cdp.evaluate(
      `JSON.stringify({
        pages: window.nav ? window.nav.allPages : [],
        tabBar: window.nav ? window.nav.tabBarPages : [],
        appid: window.nav && window.nav.config ? (window.nav.config.appid || '') : '',
        entry: window.nav && window.nav.config ? (window.nav.config.entryPagePath || '') : '',
        name: (function(){try{
          var cfg = window.nav && window.nav.config;
          var b = cfg && cfg.accountInfo && cfg.accountInfo.appAccount;
          return b && b.nickname || cfg && cfg.appname || '';
        }catch(e){return ''}})()
      })`,
      5000
    );
    const value = this._extractValue(result);
    if (!value) return { pages: [], tabBarPages: [], appInfo: {} };

    try {
      const config = JSON.parse(value);
      this.pages = config.pages || [];
      this.tabBarPages = config.tabBar || [];
      this.appInfo = {
        appId: config.appid || '',
        entry: config.entry || '',
        name: config.name || '',
      };
      return { pages: this.pages, tabBarPages: this.tabBarPages, appInfo: this.appInfo };
    } catch {
      return { pages: [], tabBarPages: [], appInfo: {} };
    }
  }

  async navigateTo(route) {
    await this._ensure();
    const safe = route.replace(/'/g, "\\'");
    await this.cdp.evaluate(`window.nav.goTo('${safe}')`, 5000);
  }

  async safeNavigate(route) {
    await this._ensure();
    const safe = route.replace(/'/g, "\\'");
    await this.cdp.evaluate(`window.nav._safeNavigate('${safe}')`, 5000);
  }

  async navigateBack(delta = 1) {
    await this._ensure();
    await this.cdp.evaluate(`window.nav.back(${delta})`, 5000);
  }

  async getCurrentRoute() {
    await this._ensure();
    const result = await this.cdp.evaluate(`window.nav.getCurrentRoute()`, 3000);
    return this._extractValue(result) || '';
  }

  async refreshPage() {
    await this._ensure();
    const result = await this.cdp.evaluate(
      `(function(){
        try {
          var nav = window.nav;
          if (!nav || !nav.wxFrame) return JSON.stringify({err:'no nav'});
          var p = nav.wxFrame.getCurrentPages();
          if (!p || !p.length) return JSON.stringify({err:'no page'});
          var cur = p[p.length-1];
          var route = cur.route || cur.__route__ || '';
          if (!route) return JSON.stringify({err:'no route'});
          var url = '/' + route;
          var opts = cur.options || {};
          var qs = Object.keys(opts).map(function(k){return k+'='+opts[k]}).join('&');
          if (qs) url += '?' + qs;
          nav.wxFrame.wx.reLaunch({url:url, fail:function(e){
            nav.wxFrame.wx.redirectTo({url:url});
          }});
          return JSON.stringify({ok:true, route:route});
        } catch(e) { return JSON.stringify({err:e.message}); }
      })()`,
      5000
    );
    return this._extractValue(result) || '';
  }

  async autoVisit(pages, delay = 2000, onProgress = null, cancelToken = null) {
    await this._ensure();
    const total = pages.length;
    for (let i = 0; i < total; i++) {
      if (cancelToken && cancelToken.cancelled) break;
      if (onProgress) onProgress(i, total, pages[i]);
      try {
        await this.safeNavigate(pages[i]);
      } catch {}
      await new Promise(r => setTimeout(r, delay));
    }
    if (onProgress) onProgress(total, total, 'done');
  }

  async enableRedirectGuard() {
    await this._ensure();
    const result = await this.cdp.evaluate(
      `JSON.stringify(window.nav.enableRedirectGuard())`, 5000
    );
    const value = this._extractValue(result);
    if (value) {
      try { return JSON.parse(value); } catch {}
    }
    return { ok: false };
  }

  async disableRedirectGuard() {
    await this._ensure();
    await this.cdp.evaluate(`window.nav.disableRedirectGuard()`, 5000);
  }

  async getBlockedRedirects() {
    await this._ensure();
    const result = await this.cdp.evaluate(
      `JSON.stringify(window.nav.getBlockedRedirects())`, 5000
    );
    const value = this._extractValue(result);
    if (value) {
      try { return JSON.parse(value); } catch {}
    }
    return [];
  }

  _extractValue(result) {
    if (!result) return null;
    const r = result.result || {};
    return r.value !== undefined ? r.value : null;
  }

  destroy() {
    this.cdp.disconnect();
  }
}

module.exports = RouteNavigator;
