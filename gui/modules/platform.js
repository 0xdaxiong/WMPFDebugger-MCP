'use strict';

const os = require('os');
const path = require('path');

const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';

function getProcessName() {
  return isMac ? 'WeChatAppEx' : 'WeChatAppEx.exe';
}

function getConfigDir(projectRoot) {
  const subdir = isMac ? 'mac' : 'config';
  return path.join(projectRoot, 'frida', subdir);
}

function getDefaultWxapkgPaths() {
  const home = os.homedir();
  if (isWindows) {
    return [
      path.join(home, 'AppData', 'Roaming', 'Tencent', 'xwechat', 'radium', 'Applet', 'packages'),
      path.join(home, 'Documents', 'WeChat Files', 'Applet'),
    ];
  }
  if (isMac) {
    return [
      path.join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents', 'app_data', 'radium', 'users'),
    ];
  }
  return [];
}

function findWxapkgDir() {
  const fs = require('fs');
  const candidates = getDefaultWxapkgPaths();
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

module.exports = {
  platform,
  isWindows,
  isMac,
  getProcessName,
  getConfigDir,
  getDefaultWxapkgPaths,
  findWxapkgDir,
};
