/**
 * Frida Runner - 独立进程运行 frida 注入
 *
 * 支持 Windows 和 macOS
 *
 * 环境变量:
 *   WMPF_PROJECT_ROOT - 项目根目录
 *   WMPF_FRIDA_MODULE - frida 模块路径 (可选)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const PROJECT_ROOT = process.env.WMPF_PROJECT_ROOT || path.join(__dirname, '..');
const fridaPath = process.env.WMPF_FRIDA_MODULE || path.join(PROJECT_ROOT, 'node_modules', 'frida');
const frida = require(fridaPath);

const isMac = os.platform() === 'darwin';

async function findWmpfWindows(localDevice, processes) {
  const wmpfProcesses = processes.filter(p => p.name === 'WeChatAppEx.exe');

  if (wmpfProcesses.length === 0) {
    throw new Error('WeChatAppEx.exe process not found. 请先打开微信。');
  }

  const wmpfPids = wmpfProcesses.map(p => p.parameters.ppid ? p.parameters.ppid : 0);
  const wmpfPid = wmpfPids
    .sort((a, b) => wmpfPids.filter(v => v === a).length - wmpfPids.filter(v => v === b).length)
    .pop();

  if (!wmpfPid) {
    throw new Error('WeChatAppEx.exe parent process not found');
  }

  const wmpfProcess = processes.find(p => p.pid === wmpfPid);
  const wmpfProcessPath = wmpfProcess?.parameters?.path || '';

  const wmpfVersionMatch = wmpfProcessPath.match(/\d+/g);
  const wmpfVersion = wmpfVersionMatch ? Number(wmpfVersionMatch.pop()) : 0;

  if (wmpfVersion === 0) {
    throw new Error('Unable to determine WMPF version, path: ' + wmpfProcessPath);
  }

  return { pids: [wmpfPid], version: wmpfVersion, configDir: 'config' };
}

async function findWmpfMacOS(localDevice, processes) {
  // Try pgrep first
  let pids = [];
  try {
    const out = execSync('pgrep -f "/MacOS/WeChatAppEx.app/Contents/MacOS/WeChatAppEx"', { encoding: 'utf8' }).trim();
    pids = out.split('\n').filter(s => s.trim()).map(Number).filter(n => !isNaN(n));
  } catch {}

  // Fallback to frida process enumeration
  if (pids.length === 0) {
    const wmpfProcesses = processes.filter(p => p.name === 'WeChatAppEx');
    pids = wmpfProcesses.map(p => p.pid);
  }

  if (pids.length === 0) {
    throw new Error('WeChatAppEx process not found on macOS. 请先打开微信。');
  }

  // Get version from Info.plist
  let version = 0;
  try {
    const verOut = execSync(
      'defaults read /Applications/WeChat.app/Contents/MacOS/WeChatAppEx.app/Contents/Info.plist CFBundleVersion',
      { encoding: 'utf8' }
    ).trim();
    const parts = verOut.split('.');
    if (parts.length >= 2) {
      version = parseInt(parts[1], 10);
    }
  } catch {}

  // Fallback: try to extract from process path
  if (version === 0) {
    for (const pid of pids) {
      const proc = processes.find(p => p.pid === pid);
      if (proc && proc.parameters && proc.parameters.path) {
        const nums = proc.parameters.path.match(/\d+/g);
        if (nums && nums.length > 0) {
          version = parseInt(nums[nums.length - 1], 10);
          if (version > 10000) break;
          version = 0;
        }
      }
    }
  }

  if (version === 0) {
    throw new Error('Unable to determine WeChatAppEx version on macOS');
  }

  return { pids, version, configDir: path.join('config', 'mac') };
}

async function main() {
  try {
    const localDevice = await frida.getLocalDevice();
    const processes = await localDevice.enumerateProcesses({ scope: frida.Scope.Metadata });

    let pids, version, configDir;
    if (isMac) {
      ({ pids, version, configDir } = await findWmpfMacOS(localDevice, processes));
    } else {
      ({ pids, version, configDir } = await findWmpfWindows(localDevice, processes));
    }

    console.log(`INFO:detected WMPF version: ${version}, pids: [${pids.join(',')}], platform: ${isMac ? 'macOS' : 'Windows'}`);

    // 读取 hook 脚本
    const hookPath = path.join(PROJECT_ROOT, 'frida', 'hook.js');
    if (!fs.existsSync(hookPath)) {
      console.error('ERROR:hook script not found: ' + hookPath);
      process.exit(1);
    }
    let scriptContent = fs.readFileSync(hookPath, 'utf-8');

    // 读取版本配置 (try platform-specific dir first, then fallback to root config)
    let configPath = path.join(PROJECT_ROOT, 'frida', configDir, `addresses.${version}.json`);
    if (!fs.existsSync(configPath)) {
      configPath = path.join(PROJECT_ROOT, 'frida', 'config', `addresses.${version}.json`);
    }
    if (!fs.existsSync(configPath)) {
      console.error(`ERROR:version config not found for ${version} (tried ${configDir})`);
      process.exit(1);
    }
    const configContent = JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
    scriptContent = scriptContent.replace('@@CONFIG@@', configContent);

    // 附加到进程并注入 (inject into all pids on macOS, first pid on Windows)
    let session = null;
    let script = null;

    for (const pid of pids) {
      try {
        const s = await localDevice.attach(Number(pid));
        const sc = await s.createScript(scriptContent);

        sc.message.connect((message) => {
          if (message.type === 'error') {
            console.error('FRIDA_ERROR:' + JSON.stringify(message));
            return;
          }
          console.log('FRIDA:' + message.payload);
        });

        await sc.load();
        console.log(`INFO:injected pid=${pid}`);

        if (!session) {
          session = s;
          script = sc;
        }
      } catch (e) {
        console.log(`INFO:failed to inject pid=${pid}: ${e.message}`);
      }
    }

    if (!session) {
      console.error('ERROR:failed to inject any WeChatAppEx process');
      process.exit(1);
    }

    console.log(`SUCCESS:script loaded, WMPF version: ${version}, ${pids.length} process(es)`);
    console.log('INFO:you can now open any miniapps');

    // 保持进程运行，监听退出信号
    process.on('SIGTERM', async () => {
      try { await script.unload(); } catch (e) {}
      try { await session.detach(); } catch (e) {}
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      try { await script.unload(); } catch (e) {}
      try { await session.detach(); } catch (e) {}
      process.exit(0);
    });

  } catch (err) {
    console.error('ERROR:' + err.message);
    process.exit(1);
  }
}

main();
