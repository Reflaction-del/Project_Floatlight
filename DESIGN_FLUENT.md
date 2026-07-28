# 浮光世界观编辑器 · Fluent Design System 设计文档

> 版本：v1.6.13-preview ｜ 设计语言重构日期：2026-07-19
> 设计原则：Fluent Design System（Microsoft）—— 通信蓝主色、Segoe UI 字体、克制圆角、轻层级阴影、Reveal 悬停高光。**不引入重材质（Acrylic/Mica 原生效果在 Electron 中无法原生实现，以 CSS 模拟浅层深度）。**

---

## 1. 设计目标与范围

| 项 | 决策 |
|---|---|
| 设计语言 | Fluent Design System（替换原默认配色/圆角/控件形态） |
| 覆盖主题 | 全部 4 套：浅色 / 深色 / 蓝调 / 暖色，均套用 Fluent 令牌 |
| 图标策略 | 工具栏/文件树等 UI chrome 的 emoji → Fluent UI System Icons（内联 SVG，MIT 授权） |
| 用户数据 | 用户文档中自定义的 emoji（如世界图标、ICON_PRESETS）**原样保留**，不破坏存量数据 |
| 交付物 | 便携 exe + NSIS 安装包；源码另存为新目录（原 `source_v1.6.13` 不动） |

---

## 2. 色彩令牌（Design Tokens）

### 2.1 浅色（默认）
| 令牌 | 值 | 用途 |
|---|---|---|
| `--accent` | `#0F6CBD` | Fluent 通信蓝，主强调 |
| `--accent-soft` | `#C7E0F4` | 激活态底纹 / 浅染 |
| `--accent-2` | `#5B5FC7` | 靛蓝辅色（Logo 渐变） |
| `--bg` | `#FAF9F8` | 中性背景 |
| `--bg-elev` | `#FFFFFF` | 抬升面（卡片/顶栏） |
| `--bg-sunken` | `#F3F2F1` | 下沉面（命令栏/侧栏底） |
| `--fg` | `#242424` | 前景文字 |
| `--fg-muted` | `#616161` | 次级文字 |
| `--border` | `#D1D1D1` | 描边 |
| `--danger` | `#C4314B` | 错误红 |
| `--ok` | `#13A10E` | 成功绿 |

### 2.2 深色 / 蓝调 / 暖色
- **深色**：`--bg #1F1F1F` / `--bg-elev #2B2B2B` / `--accent #2899F5` / `--accent-soft #0F2A44`
- **蓝调**：`--bg #0E1B2A` / `--bg-elev #15263A` / `--accent #2DA3E0`（沉浸式深色工作区）
- **暖色**：`--bg #F7F2E9` / `--accent #BE6A15`（Fluent 琥珀暖调）
- 四套均保持 `--radius-*`、`--ring`、`--shadow*` 一致结构，确保跨主题视觉连续性。

### 2.3 语义令牌
```css
--radius-sm: 4px;   /* 控件 */
--radius-md: 8px;   /* 卡片/面板 */
--radius-lg: 12px;
--radius-xl: 16px;
--ring: 0 0 0 2px var(--bg-elev), 0 0 0 4px var(--accent);  /* Fluent 焦点框 */
--shadow:    0 1px 2px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12);
--shadow-md: 0 2px 4px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12);
--shadow-lg: 0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12);
```

---

## 3. 字体

```css
font-family: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system,
             "PingFang SC", "Microsoft YaHei", sans-serif;
```
- 优先 Fluent 系统字体；中文回退 PingFang SC / 微软雅黑。
- 正文 14px，标题 16–36px 阶梯；行高 1.5（UI）/ 1.75（编辑器正文）。

---

## 4. 组件规范

### 4.1 命令栏（Toolbar）
- 背景 `--bg-sunken`，图标按钮 40×40、`--radius-sm`。
- 激活态（`.active` / `.mod-active`）：`--accent-soft` 底 + 同色 1px inset 描边（`color-mix` 40%）。
- **Reveal 高光**：`:hover` 时浅强调 inset 描边（22%），柔和反馈。

### 4.2 标签页 / 文件树项
- 选中态统一 `--accent-soft` + `--accent` 文字，1px inset 描边。
- 用户文档 tab 的 `icon` 字段若为用户自定义 emoji，仍按 `<span>` 原样渲染（见 `TabIcon` 兜底逻辑）。

### 4.3 卡片 / 模态
- `.card` 常驻 `--shadow`；`:hover` 抬升至 `--shadow-md` 并 `translateY(-2px)`。
- `.modal` / 弹窗类使用 `--shadow-lg` 强层级分离。

### 4.4 表单控件
- 输入框聚焦：`outline:none` + `border-color: var(--accent)`，辅以 3px 浅染外晕。
- 键盘焦点：全局焦点框 `--ring`（2px 底色 + 2px 强调），满足 WCAG AA 可见焦点。

### 4.5 滚动条
- Fluent 细条：`scrollbar-width: thin`；WebKit 拇指 10px、`--fg-muted` 45% 透明、8px 圆角、`background-clip: padding-box` 留白。

---

## 5. 图标迁移（Fluent UI System Icons）

新增 `src/components/icons.tsx`，提供内联 SVG 图标集与 `TabIcon` 映射组件：

| 组件 | 对应模块 / 用途 |
|---|---|
| `IconEntities` | 实体库 |
| `IconRelations` | 线索板 |
| `IconConsistency` | 一致性检查 |
| `IconShare` | 协作与分享 |
| `IconSettings` | 设置 |
| `IconPanel` | 文件树开关 |
| `IconCopilot` | AI 侧栏 |
| `IconSave` | 保存 |
| `IconDoc` / `IconFolder` / `IconVisual` / `IconTimeline` | 文件树节点 |

- SVG 规格：24×24 viewBox，1.6 stroke，`fill:none`，`stroke:currentColor`（自动跟随 `--fg` / `--accent`）。
- **`TabIcon({ icon, size })`**：命中 `TAB_ICON_MAP` 渲染对应 SVG；未命中（用户自定义 emoji）按原样文本渲染，确保存量数据兼容。

### 改动文件
- `Toolbar.tsx`：模块按钮 / 文件树 / AI / 保存 / 设置改用 Fluent 图标。
- `TabBar.tsx`：搜索结果图标（drafts/timeline/visual）+ 标签渲染改用 `<TabIcon>`。
- `FileTree.tsx`：文件树头部与工具按钮改用 Fluent 图标（用户 emoji 数组保留）。
- `App.tsx`：模块热键 `icon` 改为 `entities`/`relations`/`settings` 等键。
- `types.ts`：扩展 `ModuleKey` 以包含 `entities|relations|consistency|share`（修复 TS2367 类型错误）。

---

## 6. 构建与打包

```bash
# 类型检查 + 生产构建（tsc --noEmit && vite build）
npm run build

# 打包：便携 exe + NSIS 安装包（同时产出）
./node_modules/.bin/electron-builder --win nsis portable
```

输出（`release/`）：
- `浮光世界观编辑器_v1.6.13_preview.exe`（便携版，约 70 MB）
- `浮光世界观编辑器_v1.6.13_preview_Setup.exe`（NSIS 安装包，约 71 MB，可改安装目录、创建桌面/开始菜单快捷方式）

> 注：打包时日志提示 `author is missed` 与 `default Electron icon is used`——均为非致命提示。如需定制应用图标，在 `package.json` 的 `build` 中补充 `icon` 字段即可。

---

## 7. 设计令牌对照（预览页）

`FLUENT_PREVIEW.html` 为本设计系统的自包含预览页，可切换四主题、查看色板/控件/卡片/圆角/排版，无需启动应用。

---

## 8. 可访问性（WCAG AA）

- 焦点框 `--ring` 提供清晰可见键盘焦点。
- 色彩对比：强调色与背景满足 4.5:1（普通文字）。
- 交互元素最小触达区 40×40（命令栏按钮），≥ 44px 友好。
- 支持 `prefers-reduced-motion` 时过渡收敛（后续可补强）。
