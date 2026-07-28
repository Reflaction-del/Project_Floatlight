> 世界是无限的，创作不应被工具束缚。

<p align="center">
  <img src="public/logo/logo_256x256.png" width="120" alt="浮光世界观编辑器">
</p>

<h1 align="center">浮光世界观编辑器</h1>

<p align="center">
  为小说作者、游戏策划、TRPG 主持人打造的桌面端世界观管理工具。
  <br>
  集实体管理、关系网络、时间线、视觉物料生成与 AI 辅助于一体。
</p>

<p align="center">
  <a href="#下载">下载</a> ·
  <a href="#功能">功能</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#开发">开发</a> ·
  <a href="#许可证">许可证</a>
</p>

---

## 简介

浮光世界观编辑器是一款面向创作者的世界观构建与管理工具。它以 **三栏式布局** 为基础，围绕「世界数据」这一核心，提供从资料整理、关系梳理到视觉产出、一致性检查的全流程支持。

> 当前版本：**v2.2.8**

支持平台：

- Windows（便携版 / 安装包）
- Android（Capacitor 侧载 APK）
- 浏览器预览（开发模式）

## 下载

访问 [Releases](https://github.com/Reflaction-del/Project_Floatlight/releases) 获取最新安装包：

| 平台 | 文件 |
|------|------|
| Windows 安装包 | `浮光世界观编辑器_v2.2.8_Setup.exe` |
| Windows 便携版 | `浮光世界观编辑器_v2.2.8.exe` |
| Android APK | `release/android/浮光世界观编辑器_v2.2.6.apk` |

> 请将上方链接替换为你的实际 GitHub Releases 地址。

## 功能

### 核心工作区

- **三栏式布局**：工具栏、文件树、主工作区、赋能侧栏可自由组合
- **TipTap 所见即所得编辑器**：支持 Markdown 快捷输入、双链 `[[` 补全、`@` 关键词联想
- **图片绕排**：支持左 / 中 / 右 / 内联多种对齐方式
- **浅色 / 深色 / 护眼主题**：跟随系统或手动切换

### 世界数据

- **实体库**：角色、地点、组织、概念、文档等自定义类型
- **关系图**：可视化实体之间的关联网络
- **时间线**：多事件编排 + 影响力指数可视化
- **一致性检查**：自动发现设定冲突，保持世界观逻辑自洽

### 视觉物料生成器（MaterialForge）

- 模板化卡片渲染，支持拖拽布局
- 字段绑定八源解析：`entity` / `customField` / `world` / `style` / `image` / `static` / `relation` / `ai`
- 风格系统：调色板、字体、纹理、水印统一管理
- 导出 PNG / PDF / SVG，支持批量套系生成

### AI 辅助

- AI 侧栏对话，接入任意 OpenAI 兼容接口
- 文章自动抽取实体与关系
- 实体消歧与去重
- 自然语言生成视觉模板
- 文生图头像 / Logo

## 技术栈

- **Electron 31** — 桌面端跨平台壳
- **React 18 + TypeScript** — 前端框架与类型安全
- **Vite 5** — 开发与构建工具链
- **TipTap 2** — 富文本编辑器核心
- **Tailwind CSS v4** — 原子化样式
- **Zustand** — 轻量状态管理
- **Capacitor 8** — Android 端封装

## 开发

### 环境要求

- Node.js 20+
- npm 9+
- Windows 打包需安装 NSIS（由 electron-builder 自动处理）

### 本地运行

```bash
npm install
npm run dev          # 浏览器开发模式 http://localhost:5173
npm run electron:dev # 桌面端开发模式
```

### 构建

```bash
npm run build        # 浏览器产物 -> dist/
npm run dist:win     # Windows 安装包与便携版 -> release/
```

### Android 构建

```bash
npx cap sync android
cd android
./gradlew assembleRelease
```

详细构建参数与注意事项请参阅项目内 `electron-builder.config.cjs` 与 `capacitor.config.ts`。

## 项目结构

```
.
├── android/              # Capacitor Android 工程
├── assets/               # 应用图标与静态资源
├── build/                # 构建辅助文件（NSIS 脚本等）
├── public/               # 公共资源（logo 等）
├── src/                  # 渲染进程源码
│   ├── features/         # 功能模块
│   │   ├── editor/       # 编辑器
│   │   ├── materials/    # 视觉物料生成器
│   │   ├── ai/           # AI 辅助功能
│   │   └── ...
│   ├── store/            # Zustand 状态
│   └── App.tsx
├── electron-main.cjs     # Electron 主进程
├── preload.cjs           # Electron 预加载脚本
├── vite.config.ts        # Vite 配置
├── capacitor.config.ts   # Capacitor 配置
└── docs/                 # GitHub Pages 介绍站
```

## 参与贡献

欢迎 Issue 与 PR。

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/你的功能`
3. 提交改动：`git commit -m 'feat: 新增功能'`
4. 推送分支：`git push origin feature/你的功能`
5. 发起 Pull Request

## 许可证

本项目基于 [MIT](LICENSE) 许可证开源。

---

<p align="center">
  由创作者为创作者打造 · 浮光工作室
</p>
