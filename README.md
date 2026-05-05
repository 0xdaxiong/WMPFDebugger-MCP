# WMPFDebugger-MCP

[English](README.md) | [中文](README.zh.md)

基于 [evi0s/WMPFDebugger](https://github.com/evi0s/WMPFDebugger) 的增强版，新增 **Electron GUI** 和 **MCP (Model Context Protocol)** 桥接，支持 AI 工具直接调试微信小程序。

## ✨ 新增特性

- **Electron GUI 界面** — 一键启动 F12 调试、DevTools、文件替换等功能
- **MCP 桥接服务** — 48 个调试工具通过 MCP 协议暴露，支持 Claude Desktop / Cursor / Cline 等 AI 工具直接操控小程序
- **Premium 暗黑主题** — 玻璃拟态 + 渐变背景 + 微动效，专业级调试体验
- **日志限流保护** — 高频日志自动限流，防止 GUI 卡死
- **自动打开 DevTools** — 启动调试窗口时自动打开 Chrome DevTools

## 📋 MCP 工具集 (48个)

| 分类 | 工具数 | 说明 |
|------|--------|------|
| 📌 基础调试 | 5 | JS执行、页面信息、截图、控制台、原始CDP |
| 🌐 DOM | 10 | DOM树、查找、搜索、修改、点击、事件监听 |
| 🎨 CSS | 2 | 计算样式、盒模型 |
| 📄 页面 | 3 | 重载、导航、性能指标 |
| 📡 网络 | 7 | 请求列表、JS拦截、Cookie管理、缓存、自定义头 |
| 🔀 Fetch | 1 | 协议级请求/响应拦截 |
| ⌨️ 输入 | 3 | 鼠标、键盘、文本输入 |
| 📱 仿真 | 3 | UA、屏幕、定位模拟 |
| 💾 存储 | 2 | localStorage/sessionStorage 读写 |
| 🗄️ IndexedDB | 2 | 数据库列表、数据读取 |
| 🎯 目标 | 2 | 调试目标列表、附加 |
| 🔍 Debugger | 6 | 断点调试：启用、源码、设/移断点、暂停/恢复 |
| 🔧 Runtime | 2 | 堆内存、对象属性检查 |

> 所有未封装的 CDP 功能均可通过 `send_cdp_command` 灵活调用。

## 🔧 环境要求

- Node.js >= LTS v22
- yarn 包管理器
- 基于 Chromium 的浏览器 (Chrome / Edge)

## 🚀 快速开始

**1. 克隆并安装依赖**

```bash
git clone https://github.com/0xdaxiong/WMPFDebugger-MCP
cd WMPFDebugger-MCP
yarn
cd gui && npm install
```

**2. 启动 GUI**

```bash
cd gui
npx electron .
```

**3. 使用流程**

1. 点击 **启动 F12** 开启调试服务（Frida hook + CDP 代理）
2. 在微信中打开任意小程序
3. 点击 **DevTools** 打开 Chrome 开发者工具
4. 点击 **MCP** 按钮查看 AI 工具接入配置

**4. AI 工具接入**

在 MCP 弹窗中复制配��到 Claude Desktop / Cursor / Cline 的 MCP 设置即可。

## 📁 项目结构

```
WMPFDebugger-MCP/
├── src/                    # 核心调试引擎 (TypeScript)
│   ├── index.ts           # Frida + CDP 代理服务
│   ├── cli.ts             # 命令行参数解析
│   └── third-party/       # 微信开发者工具协议实现
├── frida/
│   ├── hook.js            # Frida 注入脚本 (CDP filter patch)
│   └── config/            # 各版本地址配置
├── gui/                   # Electron GUI
│   ├── main.js            # 主进程
│   ├── renderer.js        # 渲染进程
│   ├── preload.js         # 预加载桥接
│   ├── mcp_bridge.js      # MCP 协议桥接 (48工具)
│   ├── index.html         # 界面
│   └── styles.css         # 样式
└── replace_files/          # 文件替换目录
```

## 🔌 支持的 WMPF 版本

* 19459 (最新)
* 19339 / 19201 / 19027 / 18955 / 18891

<details>
<summary>更早版本</summary>

18787 / 18151 / 18055 / 17127 / 17071 / 17037 / 16965 / 16815 / 16771 / 16467 / 16389 / 16203 / 16133 / 14315 / 14199 / 14161 / 13909 / 13871 / 13655 / 13639 / 13487 / 13341 / 13331 / 11633

</details>

版本适配指南：[ADAPTATION.md](ADAPTATION.md) | 网页调试：[EXTENSION.md](EXTENSION.md)

## ⚠️ 免责声明

**本库只能作为学习用途，造成的任何问题与本库开发者无关。如侵犯到你的权益，请联系删除。**

本程序以 GPLv2 许可证开源。`src/third-party` 中的代码版权归腾讯控股有限公司所有。

## 🙏 致谢

- [evi0s/WMPFDebugger](https://github.com/evi0s/WMPFDebugger) — 原始项目
