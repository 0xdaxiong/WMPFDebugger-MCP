/**
 * MCP Bridge Server - 为 WMPF 调试会话提供 MCP 协议接入
 * 通过 stdio 与 AI 工具通信，通过 WebSocket 连接 CDP Proxy
 * 
 * 用法（在 AI 工具的 MCP 配置中添加）:
 *   node mcp_bridge.js [--cdp-port 62000]
 */

const WebSocket = require('ws');
const readline = require('readline');

const CDP_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--cdp-port') || '62000');

let ws = null;
let cdpRequestId = 1;
let pendingRequests = new Map(); // CDP request id -> { resolve, reject, timeout }
let connected = false;

// ========== CDP WebSocket 连接管理 ==========
function connectCDP() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    ws = new WebSocket(`ws://127.0.0.1:${CDP_PORT}`);

    ws.on('open', () => {
      connected = true;
      resolve();
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id && pendingRequests.has(msg.id)) {
          const pending = pendingRequests.get(msg.id);
          clearTimeout(pending.timeout);
          pendingRequests.delete(msg.id);
          pending.resolve(msg);
        }
      } catch (e) { /* ignore non-JSON */ }
    });

    ws.on('close', () => {
      connected = false;
      ws = null;
    });

    ws.on('error', (err) => {
      connected = false;
      reject(new Error(`CDP connection failed: ${err.message}`));
    });

    setTimeout(() => {
      if (!connected) reject(new Error('CDP connection timeout'));
    }, 5000);
  });
}

function sendCDPCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('CDP not connected'));
      return;
    }

    const id = cdpRequestId++;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`CDP command timeout: ${method}`));
    }, 30000);

    pendingRequests.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// ========== MCP 工具定义 ==========
const MCP_TOOLS = [
  {
    name: 'evaluate_javascript',
    description: '在当前小程序/网页中执行JavaScript代码并返回结果',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '要执行的JavaScript表达式'
        },
        awaitPromise: {
          type: 'boolean',
          description: '是否等待Promise resolve',
          default: false
        }
      },
      required: ['expression']
    }
  },
  {
    name: 'get_page_info',
    description: '获取当前调试页面的基本信息（URL、标题等）',
    inputSchema: {
      type: 'object',
      properties: {},
    }
  },
  {
    name: 'get_dom_tree',
    description: '获取当前页面的DOM树结构',
    inputSchema: {
      type: 'object',
      properties: {
        depth: {
          type: 'number',
          description: 'DOM树深度限制',
          default: 3
        }
      }
    }
  },
  {
    name: 'query_selector',
    description: '通过CSS选择器查找DOM元素并返回其属性',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS选择器'
        }
      },
      required: ['selector']
    }
  },
  {
    name: 'get_network_requests',
    description: '获取最近的网络请求列表',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_console_logs',
    description: '获取控制台日志',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'send_cdp_command',
    description: '发送原始Chrome DevTools Protocol命令',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'CDP方法名，如 Runtime.evaluate, DOM.getDocument'
        },
        params: {
          type: 'object',
          description: 'CDP命令参数',
          default: {}
        }
      },
      required: ['method']
    }
  },
  {
    name: 'take_screenshot',
    description: '对当前页面截图，返回base64编码的PNG图片',
    inputSchema: {
      type: 'object',
      properties: {
        quality: {
          type: 'number',
          description: 'JPEG质量 (0-100)，仅jpeg格式有效',
          default: 80
        },
        format: {
          type: 'string',
          description: '图片格式: png 或 jpeg',
          default: 'png'
        }
      }
    }
  },
  {
    name: 'get_storage_data',
    description: '获取小程序的本地存储数据(localStorage/sessionStorage)',
    inputSchema: {
      type: 'object',
      properties: {
        storageType: {
          type: 'string',
          description: '存储类型: localStorage 或 sessionStorage',
          default: 'localStorage'
        }
      }
    }
  },
  {
    name: 'get_all_targets',
    description: '获取所有可调试目标（标签页、Service Worker等）',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'attach_to_target',
    description: '附加到指定的调试目标（通过targetId），用于调试微信内网页等',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: {
          type: 'string',
          description: '目标ID，可从 get_all_targets 获取'
        },
        flatten: {
          type: 'boolean',
          description: '是否扁平化session消息',
          default: true
        }
      },
      required: ['targetId']
    }
  },

  {
    name: 'get_cookies',
    description: '获取当前页面的所有Cookie',
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: '可选，指定获取哪些URL的Cookie'
        }
      }
    }
  },
  {
    name: 'set_cookie',
    description: '设置Cookie',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Cookie名称' },
        value: { type: 'string', description: 'Cookie值' },
        url: { type: 'string', description: '关联的URL' },
        domain: { type: 'string', description: '域名' },
        path: { type: 'string', description: '路径', default: '/' }
      },
      required: ['name', 'value']
    }
  },
  {
    name: 'get_computed_styles',
    description: '获取DOM元素的计算样式',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS选择器，定位要查询的元素'
        }
      },
      required: ['selector']
    }
  },
  {
    name: 'get_performance_metrics',
    description: '获取页面性能指标（内存、DOM节点数、布局耗时等）',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_element_box_model',
    description: '获取DOM元素的盒模型信息（位置、尺寸、margin、padding等）',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS选择器'
        }
      },
      required: ['selector']
    }
  },
  {
    name: 'enable_network_intercept',
    description: '启用网络请求拦截，可查看完整请求/响应头和body',
    inputSchema: {
      type: 'object',
      properties: {
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'URL匹配模式列表，为空则拦截所有请求'
        }
      }
    }
  },
  {
    name: 'search_dom',
    description: '在DOM中搜索包含指定文本或匹配选择器的所有元素',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索文本或CSS选择器' },
        type: { type: 'string', description: '搜索类型: text(文本搜索) 或 selector(CSS选择器)', default: 'selector' }
      },
      required: ['query']
    }
  },
  // ===== DOM 操作 =====
  {
    name: 'query_selector_all',
    description: '通过CSS选择器查找所有匹配的DOM元素(返回列表)',
    inputSchema: { type: 'object', properties: { selector: { type: 'string', description: 'CSS选择器' }, limit: { type: 'number', description: '最大返回数量', default: 30 } }, required: ['selector'] }
  },
  {
    name: 'set_attribute',
    description: '修改DOM元素的属性值',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' }, name: { type: 'string', description: '属性名' }, value: { type: 'string', description: '属性值' } }, required: ['selector', 'name', 'value'] }
  },
  {
    name: 'remove_node',
    description: '从DOM中移除指定元素',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] }
  },
  {
    name: 'set_outer_html',
    description: '替换DOM元素的outerHTML',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' }, html: { type: 'string', description: '新的HTML内容' } }, required: ['selector', 'html'] }
  },

  {
    name: 'click_element',
    description: '模拟点击指定DOM元素',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] }
  },
  {
    name: 'get_event_listeners',
    description: '获取DOM元素上绑定的所有事件监听器',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] }
  },

  // ===== 页面控制 =====
  {
    name: 'reload_page',
    description: '重新加载当前页面',
    inputSchema: { type: 'object', properties: { ignoreCache: { type: 'boolean', description: '是否忽略缓存', default: false } } }
  },
  {
    name: 'navigate_to',
    description: '导航到指定URL',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  },


  // ===== 网络控制 =====
  {
    name: 'delete_cookies',
    description: '删除指定Cookie',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, domain: { type: 'string' } }, required: ['name'] }
  },
  {
    name: 'clear_browser_cache',
    description: '清除浏览器缓存',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_extra_http_headers',
    description: '为所有后续请求设置自定义HTTP头',
    inputSchema: { type: 'object', properties: { headers: { type: 'object', description: '键值对形式的HTTP头' } }, required: ['headers'] }
  },


  // ===== 输入模拟 =====
  {
    name: 'dispatch_mouse_event',
    description: '模拟鼠标事件(点击/移动/滚轮)',
    inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'mousePressed/mouseReleased/mouseMoved/mouseWheel' }, x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', description: 'none/left/middle/right', default: 'left' }, clickCount: { type: 'number', default: 1 } }, required: ['type', 'x', 'y'] }
  },
  {
    name: 'dispatch_key_event',
    description: '模拟键盘事件(按键/输入文本)',
    inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'keyDown/keyUp/char' }, text: { type: 'string', description: '输入的文本字符' }, key: { type: 'string', description: '按键名称(如Enter/Tab/Backspace)' }, code: { type: 'string', description: '按键代码' } }, required: ['type'] }
  },

  {
    name: 'type_text',
    description: '在当前焦点元素中输入文本(逐字符模拟)',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要输入的文本' }, selector: { type: 'string', description: '可选, 先聚焦此元素再输入' } }, required: ['text'] }
  },
  // ===== 设备仿真 =====
  {
    name: 'set_user_agent',
    description: '覆盖User-Agent字符串',
    inputSchema: { type: 'object', properties: { userAgent: { type: 'string' } }, required: ['userAgent'] }
  },
  {
    name: 'set_device_metrics',
    description: '模拟设备屏幕尺寸(手机/平板等)',
    inputSchema: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' }, deviceScaleFactor: { type: 'number', default: 1 }, mobile: { type: 'boolean', default: false } }, required: ['width', 'height'] }
  },
  {
    name: 'set_geolocation',
    description: '模拟地理位置',
    inputSchema: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, accuracy: { type: 'number', default: 100 } }, required: ['latitude', 'longitude'] }
  },

  // ===== 存储操作 =====
  {
    name: 'set_storage_item',
    description: '设置localStorage/sessionStorage中的值',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, storageType: { type: 'string', default: 'localStorage' } }, required: ['key', 'value'] }
  },

  // ===== Runtime增强 =====
  {
    name: 'get_heap_usage',
    description: '获取JavaScript堆内存使用情况',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_object_properties',
    description: '获取JS对象的所有属性(深度检查)',
    inputSchema: { type: 'object', properties: { expression: { type: 'string', description: '返回对象的JS表达式' }, depth: { type: 'number', description: '展开深度', default: 1 } }, required: ['expression'] }
  },
  {
    name: 'call_function_on_element',
    description: '在指定DOM元素上调用JS函数',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' }, functionBody: { type: 'string', description: '函数体, 参数为element. 如: return element.value' } }, required: ['selector', 'functionBody'] }
  },
  // ===== Debugger 断点调试 =====
  {
    name: 'debugger_enable',
    description: '启用JS调试器，获取所有已加载脚本列表',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'debugger_get_script_source',
    description: '获取指定脚本的源代码',
    inputSchema: { type: 'object', properties: { scriptId: { type: 'string', description: '脚本ID(从debugger_enable获取)' } }, required: ['scriptId'] }
  },
  {
    name: 'debugger_remove_breakpoint',
    description: '移除断点',
    inputSchema: { type: 'object', properties: { breakpointId: { type: 'string' } }, required: ['breakpointId'] }
  },
  {
    name: 'debugger_pause',
    description: '暂停JS执行',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'debugger_resume',
    description: '恢复JS执行',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'debugger_set_breakpoint_by_url',
    description: '按URL和行号设置断点(不需要scriptId)',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: '脚本URL(支持部分匹配)' }, lineNumber: { type: 'number' }, condition: { type: 'string' } }, required: ['lineNumber'] }
  },
  // ===== IndexedDB =====
  {
    name: 'indexeddb_list',
    description: '列出页面所有IndexedDB数据库及其objectStore',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'indexeddb_read',
    description: '读取IndexedDB中指定objectStore的数据',
    inputSchema: { type: 'object', properties: { dbName: { type: 'string' }, storeName: { type: 'string' }, limit: { type: 'number', default: 50 } }, required: ['dbName', 'storeName'] }
  },
  // ===== Fetch 协议级拦截 =====
  {
    name: 'fetch_enable',
    description: '启用协议级请求拦截(可修改请求/响应), 禁用请用send_cdp_command调Fetch.disable',
    inputSchema: { type: 'object', properties: { patterns: { type: 'array', items: { type: 'object', properties: { urlPattern: { type: 'string' }, requestStage: { type: 'string', description: 'Request或Response' } } }, description: '拦截模式, 为空则拦截所有' } } }
  },
  // ===== New tools: Route Navigator =====
  {
    name: 'miniapp_get_routes',
    description: '获取小程序所有页面路由列表、TabBar页面和应用信息',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'miniapp_navigate',
    description: '导航到指定小程序页面路由',
    inputSchema: { type: 'object', properties: { route: { type: 'string', description: '目标页面路由，如 pages/index/index' } }, required: ['route'] }
  },
  {
    name: 'miniapp_get_current_route',
    description: '获取当前小程序页面路由',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'miniapp_auto_visit',
    description: '自动遍历所有小程序页面（用于触发网络请求、发现接口）',
    inputSchema: { type: 'object', properties: { delay: { type: 'number', description: '每个页面停留时间(ms)', default: 2000 } } }
  },
  // ===== New tools: Cloud Audit =====
  {
    name: 'cloud_start_hook',
    description: '启动云函数调用Hook，拦截wx.cloud.callFunction',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cloud_get_calls',
    description: '获取已捕获的云函数调用列表',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cloud_static_scan',
    description: '静态扫描所有JS脚本，提取云函数引用、数据库collection、存储操作',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cloud_manual_call',
    description: '手动调用指定云函数并返回结果',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: '云函数名称' }, data: { type: 'object', description: '调用参数', default: {} } }, required: ['name'] }
  },
  // ===== New tools: wxapkg =====
  {
    name: 'wxapkg_list_packages',
    description: '列出本地微信小程序包文件(.wxapkg)',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wxapkg_decrypt',
    description: '解密并解包wxapkg文件，返回提取的文件列表',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'wxapkg文件路径' }, appId: { type: 'string', description: '小程序AppID (如 wx1234567890abcdef)' }, outputDir: { type: 'string', description: '输出目录路径' } }, required: ['path', 'appId', 'outputDir'] }
  },
  // ===== New tools: Scanner =====
  {
    name: 'scan_directory',
    description: '扫描目录中的敏感信息（密钥、Token、PII等）',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: '要扫描的目录路径' } }, required: ['path'] }
  },
  {
    name: 'scan_wxapkg',
    description: '一键解密解包wxapkg并扫描敏感信息',
    inputSchema: { type: 'object', properties: { wxapkgPath: { type: 'string', description: 'wxapkg文件路径' }, appId: { type: 'string', description: '小程序AppID' } }, required: ['wxapkgPath', 'appId'] }
  },
  // ===== New tools: UserScript =====
  {
    name: 'userscript_list',
    description: '列出已加载的UserScript脚本',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'userscript_inject',
    description: '注入JavaScript代码到小程序（包裹在IIFE中）',
    inputSchema: { type: 'object', properties: { source: { type: 'string', description: 'JavaScript源代码' }, persistent: { type: 'boolean', description: '是否在新页面加载时自动注入', default: false } }, required: ['source'] }
  },
  // ===== New tools: Anti-Debug =====
  {
    name: 'antidebug_toggle',
    description: '切换反调试绕过（Debugger.setSkipAllPauses）',
    inputSchema: { type: 'object', properties: { enable: { type: 'boolean', description: 'true启用绕过，false禁用' } }, required: ['enable'] }
  }
];

// ========== DOM 查询辅助 ==========
async function findNodeBySelector(selector) {
  const doc = await sendCDPCommand('DOM.getDocument', { depth: 0 });
  const rootId = doc.result?.root?.nodeId;
  if (!rootId) throw new Error('Cannot get document root');
  const q = await sendCDPCommand('DOM.querySelector', { nodeId: rootId, selector });
  if (!q.result?.nodeId || q.result.nodeId === 0) throw new Error(`No element: ${selector}`);
  return q.result.nodeId;
}

// ========== MCP 工具执行 ==========
async function executeTool(name, args) {
  await connectCDP();


  switch (name) {
    case 'evaluate_javascript': {
      const result = await sendCDPCommand('Runtime.evaluate', {
        expression: args.expression,
        returnByValue: true,
        awaitPromise: args.awaitPromise || false,
        generatePreview: true,
      });
      if (result.result?.exceptionDetails) {
        return { error: result.result.exceptionDetails.text || 'Evaluation error' };
      }
      return result.result?.result || result;
    }

    case 'get_page_info': {
      const titleResult = await sendCDPCommand('Runtime.evaluate', {
        expression: 'JSON.stringify({ url: location.href, title: document.title, readyState: document.readyState, charset: document.characterSet })',
        returnByValue: true,
      });
      try {
        return JSON.parse(titleResult.result?.result?.value || '{}');
      } catch {
        return titleResult.result?.result || {};
      }
    }

    case 'get_dom_tree': {
      const doc = await sendCDPCommand('DOM.getDocument', {
        depth: args.depth || 3,
        pierce: true,
      });
      return doc.result?.root || doc;
    }

    case 'query_selector': {
      const doc = await sendCDPCommand('DOM.getDocument', { depth: 0 });
      const rootId = doc.result?.root?.nodeId;
      if (!rootId) return { error: 'Cannot get document root' };

      const queryResult = await sendCDPCommand('DOM.querySelector', {
        nodeId: rootId,
        selector: args.selector,
      });
      if (!queryResult.result?.nodeId || queryResult.result.nodeId === 0) {
        return { error: `No element found for selector: ${args.selector}` };
      }

      const nodeInfo = await sendCDPCommand('DOM.describeNode', {
        nodeId: queryResult.result.nodeId,
        depth: 2,
      });
      
      // 获取 outerHTML
      const htmlResult = await sendCDPCommand('DOM.getOuterHTML', {
        nodeId: queryResult.result.nodeId,
      });
      
      return {
        node: nodeInfo.result?.node || {},
        outerHTML: htmlResult.result?.outerHTML || '',
      };
    }

    case 'get_network_requests': {
      // 启用 Network domain 并获取请求
      await sendCDPCommand('Network.enable', {});
      const result = await sendCDPCommand('Runtime.evaluate', {
        expression: `JSON.stringify(performance.getEntriesByType('resource').slice(-50).map(e => ({
          name: e.name, type: e.initiatorType, duration: Math.round(e.duration),
          size: e.transferSize || 0, startTime: Math.round(e.startTime)
        })))`,
        returnByValue: true,
      });
      try {
        return JSON.parse(result.result?.result?.value || '[]');
      } catch {
        return [];
      }
    }

    case 'get_console_logs': {
      const result = await sendCDPCommand('Runtime.evaluate', {
        expression: `(function() {
          if (!window.__mcpConsoleLogs) return '[]';
          return JSON.stringify(window.__mcpConsoleLogs.slice(-100));
        })()`,
        returnByValue: true,
      });
      // 安装 console 拦截器
      await sendCDPCommand('Runtime.evaluate', {
        expression: `(function() {
          if (window.__mcpConsoleInstalled) return;
          window.__mcpConsoleInstalled = true;
          window.__mcpConsoleLogs = [];
          const orig = {};
          ['log','warn','error','info','debug'].forEach(m => {
            orig[m] = console[m];
            console[m] = function(...args) {
              window.__mcpConsoleLogs.push({type:m, args: args.map(a => {
                try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                catch(e) { return String(a); }
              }), time: Date.now()});
              if (window.__mcpConsoleLogs.length > 500) window.__mcpConsoleLogs.shift();
              orig[m].apply(console, args);
            };
          });
        })()`,
        returnByValue: true,
      });
      try {
        return JSON.parse(result.result?.result?.value || '[]');
      } catch {
        return [];
      }
    }

    case 'send_cdp_command': {
      const result = await sendCDPCommand(args.method, args.params || {});
      return result.result || result;
    }

    case 'take_screenshot': {
      const result = await sendCDPCommand('Page.captureScreenshot', {
        format: args.format || 'png',
        quality: args.format === 'jpeg' ? (args.quality || 80) : undefined,
      });
      return {
        format: args.format || 'png',
        data: result.result?.data || '',
        dataLength: (result.result?.data || '').length,
      };
    }

    case 'get_storage_data': {
      const storageType = args.storageType || 'localStorage';
      const result = await sendCDPCommand('Runtime.evaluate', {
        expression: `JSON.stringify(Object.fromEntries(Object.keys(${storageType}).map(k => [k, ${storageType}.getItem(k)])))`,
        returnByValue: true,
      });
      try {
        return JSON.parse(result.result?.result?.value || '{}');
      } catch {
        return {};
      }
    }

    case 'get_all_targets': {
      const result = await sendCDPCommand('Target.getTargets', {});
      return result.result?.targetInfos || result;
    }

    case 'attach_to_target': {
      const result = await sendCDPCommand('Target.attachToTarget', {
        targetId: args.targetId,
        flatten: args.flatten !== false,
      });
      return result.result || result;
    }

    case 'detach_from_target': {
      const result = await sendCDPCommand('Target.detachFromTarget', {
        sessionId: args.sessionId,
      });
      return result.result || { success: true };
    }

    case 'get_cookies': {
      const params = args.urls ? { urls: args.urls } : {};
      const result = await sendCDPCommand('Network.getCookies', params);
      return result.result?.cookies || [];
    }

    case 'set_cookie': {
      const result = await sendCDPCommand('Network.setCookie', {
        name: args.name,
        value: args.value,
        url: args.url || undefined,
        domain: args.domain || undefined,
        path: args.path || '/',
      });
      return result.result || result;
    }

    case 'get_computed_styles': {
      const doc = await sendCDPCommand('DOM.getDocument', { depth: 0 });
      const rootId = doc.result?.root?.nodeId;
      if (!rootId) return { error: 'Cannot get document root' };
      const queryResult = await sendCDPCommand('DOM.querySelector', {
        nodeId: rootId, selector: args.selector,
      });
      if (!queryResult.result?.nodeId || queryResult.result.nodeId === 0) {
        return { error: `No element found: ${args.selector}` };
      }
      const styles = await sendCDPCommand('CSS.getComputedStyleForNode', {
        nodeId: queryResult.result.nodeId,
      });
      // 转换为 key-value 对象方便阅读
      const styleObj = {};
      (styles.result?.computedStyle || []).forEach(s => {
        if (s.value && s.value !== '' && s.value !== 'initial' && s.value !== 'none' && s.value !== 'normal' && s.value !== 'auto') {
          styleObj[s.name] = s.value;
        }
      });
      return styleObj;
    }

    case 'get_performance_metrics': {
      await sendCDPCommand('Performance.enable', {});
      const result = await sendCDPCommand('Performance.getMetrics', {});
      const metrics = {};
      (result.result?.metrics || []).forEach(m => { metrics[m.name] = m.value; });
      return metrics;
    }

    case 'get_element_box_model': {
      const doc = await sendCDPCommand('DOM.getDocument', { depth: 0 });
      const rootId = doc.result?.root?.nodeId;
      if (!rootId) return { error: 'Cannot get document root' };
      const queryResult = await sendCDPCommand('DOM.querySelector', {
        nodeId: rootId, selector: args.selector,
      });
      if (!queryResult.result?.nodeId || queryResult.result.nodeId === 0) {
        return { error: `No element found: ${args.selector}` };
      }
      const box = await sendCDPCommand('DOM.getBoxModel', {
        nodeId: queryResult.result.nodeId,
      });
      return box.result?.model || box;
    }

    case 'enable_network_intercept': {
      await sendCDPCommand('Network.enable', {});
      // 安装请求/响应监听
      const result = await sendCDPCommand('Runtime.evaluate', {
        expression: `(function() {
          if (window.__mcpNetworkInstalled) return 'already installed';
          window.__mcpNetworkInstalled = true;
          window.__mcpNetworkData = [];
          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            const req = { url: String(args[0]?.url || args[0]), method: args[1]?.method || 'GET', time: Date.now() };
            try {
              const resp = await origFetch.apply(this, args);
              const clone = resp.clone();
              let body = '';
              try { body = await clone.text(); } catch(e) {}
              req.status = resp.status;
              req.responseBody = body.substring(0, 2000);
              window.__mcpNetworkData.push(req);
              if (window.__mcpNetworkData.length > 200) window.__mcpNetworkData = window.__mcpNetworkData.slice(-100);
              return resp;
            } catch(e) {
              req.error = e.message;
              window.__mcpNetworkData.push(req);
              throw e;
            }
          };
          const origXHR = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {
            this.__mcpReq = { url: String(url), method, time: Date.now() };
            return origXHR.apply(this, arguments);
          };
          const origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function(body) {
            this.addEventListener('load', function() {
              if (this.__mcpReq) {
                this.__mcpReq.status = this.status;
                this.__mcpReq.responseBody = (this.responseText || '').substring(0, 2000);
                window.__mcpNetworkData.push(this.__mcpReq);
                if (window.__mcpNetworkData.length > 200) window.__mcpNetworkData = window.__mcpNetworkData.slice(-100);
              }
            });
            return origSend.apply(this, arguments);
          };
          return 'installed';
        })()`,
        returnByValue: true,
      });
      return { status: result.result?.result?.value || 'unknown', message: '网络拦截已启用，后续可通过 get_network_requests 查看拦截到的数据' };
    }

    case 'search_dom': {
      if (args.type === 'text' || !args.type) {
        const result = await sendCDPCommand('Runtime.evaluate', {
          expression: `JSON.stringify(
            Array.from(document.querySelectorAll('*'))
              .filter(el => el.innerText && el.innerText.includes(${JSON.stringify(args.query)}) && el.children.length === 0)
              .slice(0, 30)
              .map(el => ({
                tag: el.tagName.toLowerCase(),
                id: el.id || undefined,
                class: el.className || undefined,
                text: (el.innerText || '').substring(0, 200),
              }))
          )`,
          returnByValue: true,
        });
        try { return JSON.parse(result.result?.result?.value || '[]'); }
        catch { return []; }
      } else {
        const result = await sendCDPCommand('Runtime.evaluate', {
          expression: `JSON.stringify(
            Array.from(document.querySelectorAll(${JSON.stringify(args.query)}))
              .slice(0, 30)
              .map(el => ({
                tag: el.tagName.toLowerCase(),
                id: el.id || undefined,
                class: el.className || undefined,
                text: (el.innerText || '').substring(0, 200),
                html: el.outerHTML.substring(0, 300),
              }))
          )`,
          returnByValue: true,
        });
        try { return JSON.parse(result.result?.result?.value || '[]'); }
        catch { return []; }
      }
    }

    // ===== DOM 操作 =====
    case 'query_selector_all': {
      const limit = args.limit || 30;
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(args.selector)})).slice(0,${limit}).map((el,i)=>({index:i,tag:el.tagName.toLowerCase(),id:el.id||undefined,class:el.className||undefined,text:(el.innerText||'').substring(0,150),html:el.outerHTML.substring(0,200)})))`,
        returnByValue: true,
      });
      try { return JSON.parse(r.result?.result?.value || '[]'); } catch { return []; }
    }
    case 'set_attribute': {
      const nodeId = await findNodeBySelector(args.selector);
      await sendCDPCommand('DOM.setAttributeValue', { nodeId, name: args.name, value: args.value });
      return { success: true };
    }
    case 'remove_node': {
      const nodeId = await findNodeBySelector(args.selector);
      await sendCDPCommand('DOM.removeNode', { nodeId });
      return { success: true };
    }
    case 'set_outer_html': {
      const nodeId = await findNodeBySelector(args.selector);
      await sendCDPCommand('DOM.setOuterHTML', { nodeId, outerHTML: args.html });
      return { success: true };
    }
    case 'highlight_element': {
      const c = args.color || 'red';
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `(function(){const el=document.querySelector(${JSON.stringify(args.selector)});if(!el)return 'not found';el.style.outline='3px solid ${c}';el.style.outlineOffset='-1px';setTimeout(()=>{el.style.outline='';el.style.outlineOffset=''},3000);return 'highlighted'})()`,
        returnByValue: true,
      });
      return { result: r.result?.result?.value || 'done' };
    }
    case 'click_element': {
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `(function(){const el=document.querySelector(${JSON.stringify(args.selector)});if(!el)return 'not found';el.click();return 'clicked'})()`,
        returnByValue: true,
      });
      return { result: r.result?.result?.value || 'done' };
    }
    case 'get_event_listeners': {
      const nodeId = await findNodeBySelector(args.selector);
      const resolved = await sendCDPCommand('DOM.resolveNode', { nodeId });
      const objectId = resolved.result?.object?.objectId;
      if (!objectId) return { error: 'Cannot resolve node' };
      const listeners = await sendCDPCommand('DOMDebugger.getEventListeners', { objectId, depth: 1 });
      return (listeners.result?.listeners || []).map(l => ({ type: l.type, useCapture: l.useCapture, passive: l.passive, once: l.once, handler: l.handler?.description?.substring(0, 200) }));
    }
    case 'get_matched_styles': {
      const nodeId = await findNodeBySelector(args.selector);
      await sendCDPCommand('CSS.enable', {});
      const matched = await sendCDPCommand('CSS.getMatchedStylesForNode', { nodeId });
      const rules = (matched.result?.matchedCSSRules || []).map(r => ({ selector: r.rule?.selectorList?.text, properties: (r.rule?.style?.cssProperties || []).filter(p => !p.disabled).map(p => `${p.name}: ${p.value}`) }));
      return rules;
    }

    // ===== 页面控制 =====
    case 'reload_page': {
      await sendCDPCommand('Page.reload', { ignoreCache: args.ignoreCache || false });
      return { success: true };
    }
    case 'navigate_to': {
      const r = await sendCDPCommand('Page.navigate', { url: args.url });
      return r.result || r;
    }
    case 'get_resource_tree': {
      const r = await sendCDPCommand('Page.getResourceTree', {});
      return r.result?.frameTree || r;
    }
    case 'get_resource_content': {
      const r = await sendCDPCommand('Page.getResourceContent', { frameId: args.frameId, url: args.url });
      return { content: (r.result?.content || '').substring(0, 5000), base64Encoded: r.result?.base64Encoded || false, truncated: (r.result?.content || '').length > 5000 };
    }
    case 'get_layout_metrics': {
      const r = await sendCDPCommand('Page.getLayoutMetrics', {});
      return r.result || r;
    }
    case 'add_script_on_load': {
      const r = await sendCDPCommand('Page.addScriptToEvaluateOnNewDocument', { source: args.source });
      return { identifier: r.result?.identifier, message: '脚本已注入，将在每次页面加载时执行' };
    }
    case 'set_document_content': {
      let frameId = args.frameId;
      if (!frameId) {
        const tree = await sendCDPCommand('Page.getResourceTree', {});
        frameId = tree.result?.frameTree?.frame?.id;
      }
      if (!frameId) return { error: 'Cannot determine frameId' };
      await sendCDPCommand('Page.setDocumentContent', { frameId, html: args.html });
      return { success: true };
    }

    // ===== 网络控制 =====
    case 'delete_cookies': {
      const p = { name: args.name };
      if (args.url) p.url = args.url;
      if (args.domain) p.domain = args.domain;
      await sendCDPCommand('Network.deleteCookies', p);
      return { success: true };
    }
    case 'clear_browser_cache': {
      await sendCDPCommand('Network.clearBrowserCache', {});
      return { success: true };
    }
    case 'set_extra_http_headers': {
      await sendCDPCommand('Network.enable', {});
      await sendCDPCommand('Network.setExtraHTTPHeaders', { headers: args.headers });
      return { success: true, headers: args.headers };
    }
    case 'emulate_network_conditions': {
      await sendCDPCommand('Network.enable', {});
      await sendCDPCommand('Network.emulateNetworkConditions', {
        offline: args.offline || false,
        latency: args.latency || 0,
        downloadThroughput: args.downloadThroughput ?? -1,
        uploadThroughput: args.uploadThroughput ?? -1,
      });
      return { success: true };
    }
    case 'get_response_body': {
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `JSON.stringify((window.__mcpNetworkData||[]).slice(${args.index != null && args.index >= 0 ? args.index : '-5'}${args.index != null && args.index >= 0 ? ','+String(args.index+1) : ''}))`,
        returnByValue: true,
      });
      try { return JSON.parse(r.result?.result?.value || '[]'); } catch { return []; }
    }

    // ===== 输入模拟 =====
    case 'dispatch_mouse_event': {
      await sendCDPCommand('Input.dispatchMouseEvent', {
        type: args.type, x: args.x, y: args.y,
        button: args.button || 'left', clickCount: args.clickCount || 1,
      });
      return { success: true };
    }
    case 'dispatch_key_event': {
      const p = { type: args.type };
      if (args.text) p.text = args.text;
      if (args.key) p.key = args.key;
      if (args.code) p.code = args.code;
      await sendCDPCommand('Input.dispatchKeyEvent', p);
      return { success: true };
    }
    case 'dispatch_touch_event': {
      await sendCDPCommand('Input.dispatchTouchEvent', {
        type: args.type,
        touchPoints: [{ x: args.x, y: args.y }],
      });
      return { success: true };
    }
    case 'type_text': {
      if (args.selector) {
        await sendCDPCommand('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(args.selector)})?.focus()`, returnByValue: true });
      }
      for (const ch of args.text) {
        await sendCDPCommand('Input.dispatchKeyEvent', { type: 'char', text: ch });
      }
      return { success: true, length: args.text.length };
    }

    // ===== 设备仿真 =====
    case 'set_user_agent': {
      await sendCDPCommand('Emulation.setUserAgentOverride', { userAgent: args.userAgent });
      return { success: true };
    }
    case 'set_device_metrics': {
      await sendCDPCommand('Emulation.setDeviceMetricsOverride', {
        width: args.width, height: args.height,
        deviceScaleFactor: args.deviceScaleFactor || 1, mobile: args.mobile || false,
      });
      return { success: true };
    }
    case 'set_geolocation': {
      await sendCDPCommand('Emulation.setGeolocationOverride', {
        latitude: args.latitude, longitude: args.longitude, accuracy: args.accuracy || 100,
      });
      return { success: true };
    }
    case 'set_touch_emulation': {
      await sendCDPCommand('Emulation.setTouchEmulationEnabled', { enabled: args.enabled !== false });
      return { success: true };
    }

    // ===== 存储操作 =====
    case 'set_storage_item': {
      const st = args.storageType || 'localStorage';
      await sendCDPCommand('Runtime.evaluate', { expression: `${st}.setItem(${JSON.stringify(args.key)},${JSON.stringify(args.value)})`, returnByValue: true });
      return { success: true };
    }
    case 'remove_storage_item': {
      const st = args.storageType || 'localStorage';
      await sendCDPCommand('Runtime.evaluate', { expression: `${st}.removeItem(${JSON.stringify(args.key)})`, returnByValue: true });
      return { success: true };
    }
    case 'clear_storage': {
      const st = args.storageType || 'localStorage';
      await sendCDPCommand('Runtime.evaluate', { expression: `${st}.clear()`, returnByValue: true });
      return { success: true };
    }

    // ===== Runtime增强 =====
    case 'get_heap_usage': {
      const r = await sendCDPCommand('Runtime.getHeapUsage', {});
      return { usedSize: r.result?.usedSize, totalSize: r.result?.totalSize, usedMB: Math.round((r.result?.usedSize || 0) / 1048576 * 100) / 100, totalMB: Math.round((r.result?.totalSize || 0) / 1048576 * 100) / 100 };
    }
    case 'get_object_properties': {
      const evalResult = await sendCDPCommand('Runtime.evaluate', { expression: args.expression, returnByValue: false, generatePreview: true });
      const objectId = evalResult.result?.result?.objectId;
      if (!objectId) return evalResult.result?.result || { error: 'Not an object' };
      const props = await sendCDPCommand('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true });
      return (props.result?.result || []).filter(p => !p.isDefault).map(p => ({ name: p.name, type: p.value?.type, value: p.value?.value ?? p.value?.description?.substring(0, 200) }));
    }
    case 'call_function_on_element': {
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `(function(){const element=document.querySelector(${JSON.stringify(args.selector)});if(!element)return JSON.stringify({error:'not found'});const fn=new Function('element',${JSON.stringify(args.functionBody)});return JSON.stringify(fn(element))})()`,
        returnByValue: true,
      });
      try { return JSON.parse(r.result?.result?.value || '{}'); } catch { return r.result?.result?.value; }
    }

    // ===== Debugger 断点调试 =====
    case 'debugger_enable': {
      const scripts = [];
      // 收集脚本解析事件
      const origHandler = ws.onmessage;
      await sendCDPCommand('Debugger.enable', {});
      // 通过 Runtime 获取已加载脚本信息
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `JSON.stringify(performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script'||e.name.endsWith('.js')).map(e=>({url:e.name,size:e.transferSize||0})))`,
        returnByValue: true,
      });
      try { return { status: 'enabled', scripts: JSON.parse(r.result?.result?.value || '[]') }; }
      catch { return { status: 'enabled' }; }
    }
    case 'debugger_get_script_source': {
      await sendCDPCommand('Debugger.enable', {});
      const r = await sendCDPCommand('Debugger.getScriptSource', { scriptId: args.scriptId });
      const src = r.result?.scriptSource || '';
      return { scriptId: args.scriptId, length: src.length, source: src.substring(0, 8000), truncated: src.length > 8000 };
    }
    case 'debugger_set_breakpoint': {
      await sendCDPCommand('Debugger.enable', {});
      const p = { location: { scriptId: args.scriptId, lineNumber: args.lineNumber, columnNumber: args.columnNumber || 0 } };
      if (args.condition) p.condition = args.condition;
      const r = await sendCDPCommand('Debugger.setBreakpoint', p);
      return r.result || r;
    }
    case 'debugger_remove_breakpoint': {
      await sendCDPCommand('Debugger.removeBreakpoint', { breakpointId: args.breakpointId });
      return { success: true };
    }
    case 'debugger_pause': {
      await sendCDPCommand('Debugger.enable', {});
      await sendCDPCommand('Debugger.pause', {});
      return { success: true };
    }
    case 'debugger_resume': {
      await sendCDPCommand('Debugger.resume', {});
      return { success: true };
    }
    case 'debugger_step_over': {
      await sendCDPCommand('Debugger.stepOver', {});
      return { success: true };
    }
    case 'debugger_step_into': {
      await sendCDPCommand('Debugger.stepInto', {});
      return { success: true };
    }
    case 'debugger_step_out': {
      await sendCDPCommand('Debugger.stepOut', {});
      return { success: true };
    }
    case 'debugger_set_breakpoint_by_url': {
      await sendCDPCommand('Debugger.enable', {});
      const p = { lineNumber: args.lineNumber };
      if (args.url) p.urlRegex = args.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (args.condition) p.condition = args.condition;
      const r = await sendCDPCommand('Debugger.setBreakpointByUrl', p);
      return r.result || r;
    }

    // ===== IndexedDB =====
    case 'indexeddb_list': {
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `(async()=>{try{const dbs=await indexedDB.databases();const result=[];for(const db of dbs){const r=indexedDB.open(db.name,db.version);const p=new Promise((res,rej)=>{r.onsuccess=e=>{const d=e.target.result;const stores=Array.from(d.objectStoreNames);d.close();res({name:db.name,version:db.version,stores})};r.onerror=()=>res({name:db.name,version:db.version,stores:[]})});result.push(await p)}return JSON.stringify(result)}catch(e){return JSON.stringify({error:e.message})}})()`,
        returnByValue: true, awaitPromise: true,
      });
      try { return JSON.parse(r.result?.result?.value || '[]'); } catch { return []; }
    }
    case 'indexeddb_read': {
      const limit = args.limit || 50;
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `(async()=>{return new Promise((resolve)=>{const r=indexedDB.open(${JSON.stringify(args.dbName)});r.onsuccess=e=>{const db=e.target.result;try{const tx=db.transaction(${JSON.stringify(args.storeName)},'readonly');const store=tx.objectStore(${JSON.stringify(args.storeName)});const items=[];const cursor=store.openCursor();cursor.onsuccess=e=>{const c=e.target.result;if(c&&items.length<${limit}){items.push({key:c.key,value:c.value});c.continue()}else{db.close();resolve(JSON.stringify(items))}};cursor.onerror=()=>{db.close();resolve('[]')}}catch(err){db.close();resolve(JSON.stringify({error:err.message}))}};r.onerror=()=>resolve('[]')})})()`,
        returnByValue: true, awaitPromise: true,
      });
      try { return JSON.parse(r.result?.result?.value || '[]'); } catch { return []; }
    }
    case 'indexeddb_clear': {
      const r = await sendCDPCommand('Runtime.evaluate', {
        expression: `(async()=>{return new Promise((resolve)=>{const r=indexedDB.open(${JSON.stringify(args.dbName)});r.onsuccess=e=>{const db=e.target.result;try{const tx=db.transaction(${JSON.stringify(args.storeName)},'readwrite');tx.objectStore(${JSON.stringify(args.storeName)}).clear();tx.oncomplete=()=>{db.close();resolve('cleared')};tx.onerror=()=>{db.close();resolve('error')}}catch(err){db.close();resolve(err.message)}};r.onerror=()=>resolve('open failed')})})()`,
        returnByValue: true, awaitPromise: true,
      });
      return { result: r.result?.result?.value || 'unknown' };
    }

    // ===== Fetch 协议级拦截 =====
    case 'fetch_enable': {
      const patterns = args.patterns || [{ urlPattern: '*', requestStage: 'Response' }];
      await sendCDPCommand('Fetch.enable', { patterns });
      return { success: true, patterns, message: '协议级拦截已启用。被拦截的请求会暂停，需通过 send_cdp_command 调用 Fetch.continueRequest/fulfillRequest 来处理' };
    }
    case 'fetch_disable': {
      await sendCDPCommand('Fetch.disable', {});
      return { success: true };
    }

    // ===== DOMSnapshot =====
    case 'capture_dom_snapshot': {
      const styles = args.computedStyles || ['display','visibility','opacity','color','background-color','font-size'];
      const r = await sendCDPCommand('DOMSnapshot.captureSnapshot', { computedStyles: styles });
      return r.result || r;
    }

    // ===== Accessibility =====
    case 'get_accessibility_tree': {
      const r = await sendCDPCommand('Accessibility.getFullAXTree', { depth: args.depth || 3 });
      const nodes = (r.result?.nodes || []).slice(0, 100).map(n => ({
        nodeId: n.nodeId, role: n.role?.value, name: n.name?.value,
        properties: (n.properties || []).map(p => ({ name: p.name, value: p.value?.value })),
      }));
      return nodes;
    }

    // ===== Profiler =====
    case 'profiler_start': {
      await sendCDPCommand('Profiler.enable', {});
      await sendCDPCommand('Profiler.setSamplingInterval', { interval: args.interval || 100 });
      await sendCDPCommand('Profiler.start', {});
      return { success: true, message: '采样已开始，使用 profiler_stop 停止并获取结果' };
    }
    case 'profiler_stop': {
      const r = await sendCDPCommand('Profiler.stop', {});
      const profile = r.result?.profile;
      if (!profile) return { error: 'No profile data' };
      // 精简输出: 取 top N 热点函数
      const nodes = profile.nodes || [];
      const hotFuncs = nodes.filter(n => n.hitCount > 0).sort((a, b) => b.hitCount - a.hitCount).slice(0, 30).map(n => ({
        functionName: n.callFrame?.functionName || '(anonymous)',
        url: n.callFrame?.url, lineNumber: n.callFrame?.lineNumber,
        hitCount: n.hitCount,
      }));
      return { totalSamples: profile.samples?.length || 0, duration: `${((profile.endTime - profile.startTime) / 1000).toFixed(1)}ms`, topFunctions: hotFuncs };
    }

    // ===== Route Navigator =====
    case 'miniapp_get_routes': {
      const RouteNavigator = require('./modules/route_navigator');
      const nav = new RouteNavigator(CDP_PORT);
      try {
        const data = await nav.fetchRoutes();
        return data;
      } finally {
        nav.cdp.disconnect();
      }
    }

    case 'miniapp_navigate': {
      const RouteNavigator = require('./modules/route_navigator');
      const nav = new RouteNavigator(CDP_PORT);
      try {
        await nav.navigateTo(args.route);
        return { success: true, route: args.route };
      } finally {
        nav.cdp.disconnect();
      }
    }

    case 'miniapp_get_current_route': {
      const RouteNavigator = require('./modules/route_navigator');
      const nav = new RouteNavigator(CDP_PORT);
      try {
        const route = await nav.getCurrentRoute();
        return { route };
      } finally {
        nav.cdp.disconnect();
      }
    }

    case 'miniapp_auto_visit': {
      const RouteNavigator = require('./modules/route_navigator');
      const nav = new RouteNavigator(CDP_PORT);
      try {
        const routeData = await nav.fetchRoutes();
        if (!routeData.pages || routeData.pages.length === 0) {
          return { error: 'No routes found. Make sure a miniapp is connected.' };
        }
        const delay = args.delay || 2000;
        const visited = [];
        for (const page of routeData.pages) {
          try {
            await nav.safeNavigate(page);
            visited.push(page);
            await new Promise(r => setTimeout(r, delay));
          } catch {}
        }
        return { success: true, visited, total: routeData.pages.length };
      } finally {
        nav.cdp.disconnect();
      }
    }

    // ===== Cloud Audit =====
    case 'cloud_start_hook': {
      const CloudAuditor = require('./modules/cloud_auditor');
      const cloud = new CloudAuditor(CDP_PORT);
      try {
        const result = await cloud.start();
        return result;
      } catch (e) {
        return { error: e.message };
      }
    }

    case 'cloud_get_calls': {
      const CloudAuditor = require('./modules/cloud_auditor');
      const cloud = new CloudAuditor(CDP_PORT);
      try {
        const calls = await cloud.poll();
        return { calls };
      } catch (e) {
        return { error: e.message };
      }
    }

    case 'cloud_static_scan': {
      const CloudAuditor = require('./modules/cloud_auditor');
      const cloud = new CloudAuditor(CDP_PORT);
      try {
        const results = await cloud.staticScan();
        return results;
      } finally {
        cloud.cdp.disconnect();
      }
    }

    case 'cloud_manual_call': {
      const CloudAuditor = require('./modules/cloud_auditor');
      const cloud = new CloudAuditor(CDP_PORT);
      try {
        const result = await cloud.manualCall(args.name, args.data || {});
        return result;
      } finally {
        cloud.cdp.disconnect();
      }
    }

    // ===== wxapkg =====
    case 'wxapkg_list_packages': {
      const wxapkg = require('./modules/wxapkg_decrypt');
      const packages = wxapkg.findPackages();
      return { packages };
    }

    case 'wxapkg_decrypt': {
      const wxapkg = require('./modules/wxapkg_decrypt');
      const fs = require('fs');
      try {
        const data = fs.readFileSync(args.path);
        const result = wxapkg.extractToDir(data, args.outputDir, args.appId);
        return { success: true, files: result };
      } catch (e) {
        return { error: e.message };
      }
    }

    // ===== Scanner =====
    case 'scan_directory': {
      const SensitiveScanner = require('./modules/sensitive_scanner');
      const scanner = new SensitiveScanner();
      try {
        const result = await scanner.scanDirectory(args.path);
        return result;
      } catch (e) {
        return { error: e.message };
      }
    }

    case 'scan_wxapkg': {
      const wxapkg = require('./modules/wxapkg_decrypt');
      const SensitiveScanner = require('./modules/sensitive_scanner');
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      try {
        const data = fs.readFileSync(args.wxapkgPath);
        const tmpDir = path.join(os.tmpdir(), `wxapkg_scan_${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        wxapkg.extractToDir(data, tmpDir, args.appId);
        const scanner = new SensitiveScanner();
        const result = await scanner.scanDirectory(tmpDir);
        return result;
      } catch (e) {
        return { error: e.message };
      }
    }

    // ===== UserScript =====
    case 'userscript_list': {
      const UserScriptManager = require('./modules/userscript_manager');
      const mgr = new UserScriptManager(CDP_PORT);
      const scripts = mgr.listScripts();
      return { scripts };
    }

    case 'userscript_inject': {
      const source = args.source;
      const wrapped = `(function(){try{${source}}catch(e){console.error('[UserScript]',e)}})();`;
      if (args.persistent) {
        const result = await sendCDPCommand('Page.addScriptToEvaluateOnNewDocument', { source: wrapped });
        return { success: true, persistent: true, identifier: result.result?.identifier };
      } else {
        const result = await sendCDPCommand('Runtime.evaluate', {
          expression: wrapped,
          returnByValue: true,
          awaitPromise: false,
        });
        return { success: true, persistent: false, result: result.result?.result };
      }
    }

    // ===== Anti-Debug =====
    case 'antidebug_toggle': {
      if (args.enable) {
        await sendCDPCommand('Debugger.enable', {});
        await sendCDPCommand('Debugger.setSkipAllPauses', { skip: true });
        return { success: true, enabled: true, message: 'Anti-debug bypass enabled (setSkipAllPauses)' };
      } else {
        await sendCDPCommand('Debugger.setSkipAllPauses', { skip: false });
        return { success: true, enabled: false, message: 'Anti-debug bypass disabled' };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ========== MCP JSON-RPC 处理 ==========
function handleMCPRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'wmpf-debugger-mcp',
            version: '2.2.4',
          },
        },
      };

    case 'notifications/initialized':
      return null; // no response needed

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOLS },
      };

    case 'tools/call':
      return executeTool(params.name, params.arguments || {})
        .then((result) => ({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            }],
          },
        }))
        .catch((err) => ({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: `Error: ${err.message}`,
            }],
            isError: true,
          },
        }));

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ========== stdio 通信 ==========
function sendResponse(response) {
  if (!response) return;
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line.trim());
    const response = handleMCPRequest(request);

    if (response instanceof Promise) {
      sendResponse(await response);
    } else {
      sendResponse(response);
    }
  } catch (err) {
    process.stderr.write(`MCP parse error: ${err.message}\n`);
  }
});

rl.on('close', () => {
  if (ws) ws.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (ws) ws.close();
  process.exit(0);
});

process.stderr.write('WMPF Debugger MCP Server started\n');
