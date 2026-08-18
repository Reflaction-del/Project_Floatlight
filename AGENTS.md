# AGENTS.md — 浮光世界观编辑器 (Floating Light Worldbuilding Editor)


本文件为在本仓库工作的 AI 助手提供项目背景、架构约定与工程红线。
人工维护，请在本文件顶部追加变更，不要删除历史上下文。

## 变更记录

- **2026-08-18**：根目录工程/用户文档归拢至 `dev-docs/`（AGENTS/CLAUDE/README 仍留根）。
- **2026-08-18**：彻底移除 Android（Capacitor）支持——删除 `android/` 工程、Capacitor 依赖与配置、release.yml 的 build-android job；bump 脚本去除 `android/app/build.gradle` 写入（版本号仅桌面单一来源）。

## 0. CLI Agent 的测试与验证红线

- **仅限 CLI agent 场景**：当以 CLI agent（如 `/claude-security` 的补丁生成等无人值守/受限环境）工作时，**不实际运行测试**，只做语法检查与逻辑核对（逐行复核变更区域、用 Node 探针验证纯函数），不执行编译/测试/启动应用；交付时如实声明「未跑编译与测试，仅语法/逻辑核对」，不声称行为经测试验证。非 CLI agent 的正常开发会话不受此限。
- **修复漏洞后必须更新漏洞报告**：在 `CLAUDE-SECURITY-*/CLAUDE-SECURITY-RESULTS.md` 中把对应漏洞条目标注「已修复」（含提交号/补丁号、修复方式、验证情况），并在报告顶部 Update 表登记该次修复。

## 0.1 自动化测试与提交门禁（2026-08-15 新增）

- **测试框架**：vitest 4（`vitest.config.ts`，node 环境）。用例与源码同目录：`src/**/*.test.ts`。
- **命令**：`npm test`（跑一次）/ `npm test:watch` / `npm run check`（test + build 全量门禁）。
- **提交门禁**：husky 9 pre-commit（`.husky/pre-commit`）自动执行 `npm test`，**测试失败阻止 commit**。每次开发完成、提交前必须保证测试通过。
- **测试面**（71 用例）：`utils/ai.test.ts`（AI 解析链）、`utils/consistency.test.ts`（一致性六规则）、`features/materials/bindings.test.ts`（八源绑定）、`utils/worldContext.test.ts`（分词/token 估算/引用反查）、`features/agent/agentPropose.test.ts`（主动提议）、`store/proposalTypes.test.ts`（来源标签）。**AI 相关函数改动必须保证对应测试通过**（回归保护）。
- **双份解析实现红线**：`utils/ai.ts` 与 `utils/aiStreamWorker.ts` 的 `extractContent`/`parseMessageFromBody` 逻辑必须保持一致，改任一侧须两侧同改；`ai.test.ts` 守护 ai.ts 一侧，用例须保持通过。
- **reasoning 兜底约定**：content 为空串 `''` 时必须回退 `reasoning_content`/`reasoning`（`??` 对空串不生效，须用「取第一个非空串」），测试覆盖此回归场景。
- **主进程写串行化红线**：`electron-main.cjs` 所有磁盘写（fs-write-file / fs-set-save-dir / fs-export / export-pdf / material:export-* / export-batch）必须经 `enqueueWrite` 串行队列执行，禁止直接裸写——LAN 远程写与本地写共用同一入口，保证顺序与原子性。新增写路径时务必包队列。
- 新增依赖：`vitest` / `husky` / `lint-staged`（devDependencies）。

## 1. 产品定位

- **是什么**：面向小说作者、游戏策划、TRPG 主持人的**世界观管理工具**。把零散灵感整合为可用产出物（实体卡、关系图、时间线、视觉物料）。
- **形态**：Electron 桌面应用（Windows 已发布）。**不是纯网页应用**，发布站仅做静态展示，不放本体运行。
- **当前版本**：`v2.2.9`（桌面统一单一版本）。详见 `package.json` 的 `version` 与 `build` 段。
- **开源仓库**：https://github.com/Reflaction-del/Project_Floatlight
  - 介绍站（GitHub Pages）：https://Reflaction-del.github.io/Project_Floatlight/
  - 下载（GitHub Releases）：https://github.com/Reflaction-del/Project_Floatlight/releases

## 2. 技术栈

| 层 | 选型 |
|----|------|
| 外壳 | Electron 31（`electron-main.cjs` 主进程，`preload.cjs` 桥接） |
| UI 框架 | React 18 + TypeScript 5 + Vite 5 |
| 富文本 | TipTap 2（StarterKit + Table + Image + TextStyle/Color/FontFamily + Underline + Placeholder + Suggestion） |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite`），Fluent Design System（v1.6.13+ 重构） |
| 状态 | zustand 4 |
| 打包 | electron-builder 24.13.3（win: nsis + portable） |

## 3. 目录结构（关键部分）

```
src/
  components/        通用 UI 组件
  features/
    entities/       实体库（核心数据）
    relations/      关系图
    consistency/    一致性检查
    timeline/       时间线
    drafts/         草稿
    materials/      视觉物料生成器 MaterialForge（重点模块）
    ai/             AI 辅助功能（提案队列、文章抽取、实体消歧、多模态设卡、NL→模板）
    editor/         富文本编辑器封装
    settings/       设置（含 AI/embedding 配置持久化）
    share/          分享
    onboarding/     新手引导
  store/            zustand store（worldStore / materialStore / aiStore / proposalStore …）
  utils/            ai.ts 等工具（OpenAI 兼容调用、图片 content 支持）
  seed/             种子数据
electron-main.cjs  主进程（boot 快照、material:capture/export-* 等 IPC）
preload.cjs        contextBridge 暴露的 API
docs/              GitHub Pages 介绍站（黑金配色，单文件零依赖）
```

## 4. 视觉物料生成器（MaterialForge）架构要点

目录 `src/features/materials/`：

- `types.ts`：核心类型、`StyleToken`/`LayoutToken`/`SIZE_PRESETS`/`CATEGORY_LABELS`
- `store.ts`：`useMaterialStore`
- `bindings.ts`：八源字段解析 `entity / customField / field / world / style / image / static / relation`，插值 `{entity:name}`、`{customField:key}`、`{world:xxx}`、`{style:xxx}`，`showIf` 条件渲染
- `TemplateRenderer.tsx`：Block 树递归渲染，**全内联样式、不用 CSS 变量**
- `Preview.tsx`（`MaterialPreview`）：实时预览外壳，主界面与模板编辑器共用
- `previewToHtml.tsx`（`renderMaterialHtml`）：离屏序列化
- `SvgRenderer.tsx`：SVG 渲染

### ⚠️ WYSIWYG 统一外壳红线（极易踩坑）

实时预览 `MaterialPreview` 与离屏 `renderMaterialHtml` 必须共用同一套纸张外壳：

- 类名：`.mf-preview-frame` / `.mf-pv-header` / `.mf-pv-body` / `.mf-pv-footer`
- 内联样式 + 相同 logo(10px)/水印(64px)/页眉(14px) 参数
- 离屏文档需在 `<style>` 内联 `index.css` 中这些类的布局规则（离屏窗口不加载 index.css）
- **修改任一边的版式、padding、logo 偏移、水印字号时，必须同步另一边，否则"导出与预览不符"**
- 导出尺寸优先级：模板 `pageOverride` → 风格 `layout.page` → `'A4'`；切换模板/风格时 `exportPage` 须同步

## 5. 关键工程规则

- **实体通用字段按 key 映射**：`customFields[key]`，不要假设固定字段名。
- **生成=混合模式**：每张物料可单开 AI；AI 接入 **OpenAI 兼容协议**（`base_url`+`api_key`+`model`），头像走 `/images/generations`，`refImage` 锁一致；不支持 img2img 的 provider 退化为强 prompt。
- **嵌入模型（语义检索）配置持久化**：
  - 桌面版 → 独立 `fl-embedding.json`
  - 浏览器版 → `fl-embedding` localStorage key
  - **桌面版 `electron-main.cjs` 的 `boot` 快照必须显式读取并返回 `embedding` 字段**，否则每次启动被 `aiStore.loadState` 重置为 `null`。
- **旧 Visual/Card 画布已彻底删除**，不迁移。
- **模板/风格市场 = 纯本地零在线依赖**（`.fugu*` 文件导入导出）。
- AI 辅助 5 大功能规划：文章抽取 / 实体消歧 / 多模态设卡 / 提案队列基座 / NL→模板。基座为「AI 提案队列 + 对话持久化」（`proposalStore` + `WorldData.proposals` / `WorldData.chats`），accept 时 dispatch 到 worldStore/materialStore。

## 6. 打包与发布红线

### 冲版本（用 bump 脚本，一处改处处改）

发版升号统一用 `npm run version:bump -- <新版本>`（如 `2.3.0`），脚本自动同步：
`package.json` 的 `version` → `README.md` / `AGENTS.md` / `docs/preview-*.html` 中的版本串。
跑完**人工** `git add && git commit`（脚本不自动提交）。

- **真相源唯一**：`package.json` 的 `version`。`build.nsis.artifactName` / `build.portable.artifactName` 已改用 electron-builder `${version}` 宏，构建时自动填号，**无需手动改产物名**。
- 发版后删 `release/` 下被取代的旧版 exe/Setup/blockmap。

### 桌面构建

1. `npx tsc --noEmit` 与 `npm run build`（tsc+vite）须**零错误**
2. `npx electron-builder --win nsis portable`（**必须用 `npx`**，electron-builder 不在 PATH）
3. 仅 `npm run build` 不会触发配置 schema 校验，非法字段会漏网——发版前务必真正跑一次 `npx electron-builder`

### electron-builder 24.13.3 配置坑（务必牢记）

- `win.fileVersionInfo` **不是合法属性** → 删除；安装包 FileDescription 实际取自 `package.json.description`（`NsisTarget.js:364`）。本仓库 description 现设为「萨卡萨卡斑斑~~」即为该用途。
- `nsis.allowDowngrade` **不是合法属性** → 删除；高版本覆盖安装由相同 appId 自动升级。
- **NSIS 更新安装误报"无法关闭"**：electron-builder 默认 `tasklist/find` 检测在中文进程名/路径下易误报。已用 `build/installer.nsh` 自定义 `!macro customCheckAppRunning`，安装/卸载前静默 `taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /t`，并在 `package.json` 的 `nsis` 加 `"include": "build/installer.nsh"`。

## 7. 常用命令

```bash
npm install                 # 安装依赖
npm run dev                # 前端开发服务器（Vite）
npm run build              # tsc --noEmit && vite build（发版前必须零错误）
npm run electron:dev       # vite build + 启动 Electron 桌面
npm run dist:win           # npm run build && electron-builder --win
```

## 8. 对外宣传文案口径（已确认）

- 布局称「三栏式布局」（**不要**写 "Obsidian 式"，避免版权纠纷）。
- AI 模块称「AI 赋能」（**不要**写 "AI 副驾"）；接入称「内置 OpenAI 兼容接口」（**不要**写 "接入 OpenAI"）。
- 英文产品标识统一为 **`floatlight`**（**不要**写 Fuguang/FUGUANG）。
- 介绍站声明：本介绍页及程序本体的需求分析、功能设计、实现路径规划全部由生成式模型完成。
- 介绍站配色已对齐 logo：黑底 `#0a0a0c` + 金铜色 `#c9a45c`，全页 logo 淡背景 + hero logo 金色光晕。

## 9. Git 注意事项

- 仓库已 `git init`，远程 `origin` 指向 GitHub。**推送前先 `unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy`**——本机系统代理 `127.0.0.1:10809` 未运行时会导致 push 静默失败。
- 大目录已被 `.gitignore` 排除：`node_modules/`、`release/`、`dist/`、`generated-images/`、`.deleted-backup/`、`vite.config.ts.timestamp-*` 等。**不要**把这些目录加回跟踪。
- 介绍站文件在 `docs/`，GitHub Pages 从 `main` 分支的 `/docs` 提供。
