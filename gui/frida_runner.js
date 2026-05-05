/**
 * Frida Runner - 独立进程运行 frida 注入
 * 
 * 环境变量:
 *   WMPF_PROJECT_ROOT - 项目根目录
 *   WMPF_FRIDA_MODULE - frida 模块路径 (可选)
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = process.env.WMPF_PROJECT_ROOT || path.join(__dirname, '..');
const fridaPath = process.env.WMPF_FRIDA_MODULE || path.join(PROJECT_ROOT, 'node_modules', 'frida');
const frida = require(fridaPath);

async function main() {
  try {
    const localDevice = await frida.getLocalDevice();
    const processes = await localDevice.enumerateProcesses({ scope: frida.Scope.Metadata });
    const wmpfProcesses = processes.filter(p => p.name === 'WeChatAppEx.exe');

    if (wmpfProcesses.length === 0) {
      console.error('ERROR:WeChatAppEx.exe process not found. 请先打开微信。');
      process.exit(1);
    }

    // 找到父进程 (出现次数最多的 ppid)
    const wmpfPids = wmpfProcesses.map(p => p.parameters.ppid ? p.parameters.ppid : 0);
    const wmpfPid = wmpfPids
      .sort((a, b) => wmpfPids.filter(v => v === a).length - wmpfPids.filter(v => v === b).length)
      .pop();

    if (!wmpfPid) {
      console.error('ERROR:WeChatAppEx.exe parent process not found');
      process.exit(1);
    }

    const wmpfProcess = processes.find(p => p.pid === wmpfPid);
    const wmpfProcessPath = wmpfProcess?.parameters?.path || '';

    // 从路径中提取版本号 (例如 .../RadiumWMPF/19459/extracted/...)
    const wmpfVersionMatch = wmpfProcessPath.match(/\d+/g);
    const wmpfVersion = wmpfVersionMatch ? Number(wmpfVersionMatch.pop()) : 0;

    if (wmpfVersion === 0) {
      console.error('ERROR:Unable to determine WMPF version, path: ' + wmpfProcessPath);
      process.exit(1);
    }

    console.log('INFO:detected WMPF version: ' + wmpfVersion + ', pid: ' + wmpfPid);

    // 读取 hook 脚本
    const hookPath = path.join(PROJECT_ROOT, 'frida', 'hook.js');
    if (!fs.existsSync(hookPath)) {
      console.error('ERROR:hook script not found: ' + hookPath);
      process.exit(1);
    }
    let scriptContent = fs.readFileSync(hookPath, 'utf-8');

    // 读取版本配置
    const configPath = path.join(PROJECT_ROOT, 'frida', 'config', 'addresses.' + wmpfVersion + '.json');
    if (!fs.existsSync(configPath)) {
      console.error('ERROR:version config not found for ' + wmpfVersion);
      process.exit(1);
    }
    const configContent = JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
    scriptContent = scriptContent.replace('@@CONFIG@@', configContent);

    // 附加到进程并注入
    const session = await localDevice.attach(Number(wmpfPid));
    const script = await session.createScript(scriptContent);

    script.message.connect((message) => {
      if (message.type === 'error') {
        console.error('FRIDA_ERROR:' + JSON.stringify(message));
        return;
      }
      console.log('FRIDA:' + message.payload);
    });

    await script.load();
    console.log('SUCCESS:script loaded, WMPF version: ' + wmpfVersion + ', pid: ' + wmpfPid);
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
