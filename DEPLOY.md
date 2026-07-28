# 开源与 GitHub Pages 部署指南

本文档说明如何将「浮光世界观编辑器」开源到 GitHub，并启用 GitHub Pages 项目介绍站。

## 前置检查

已为你完成以下准备：

- [x] 根目录 `.gitignore`（排除 node_modules / android-sdk / release / dist 等）
- [x] `LICENSE`（MIT）
- [x] `README.md`（更新为 v2.2.8 完整介绍）
- [x] `docs/index.html`（项目介绍站页面）
- [x] `docs/404.html`（自定义 404 页）
- [x] `docs/logo.png`、`docs/logo-128.png`、`docs/favicon.png`

## 第 1 步：创建 GitHub 仓库

1. 登录 [GitHub](https://github.com)
2. 点击右上角 **+** → **New repository**
3. 填写仓库名（例如 `Project_Floatlight`）
4. 选择 **Public**（公开，开源）
5. 不要勾选初始化 README 或 .gitignore（本地已准备好）
6. 点击 **Create repository**

## 第 2 步：占位链接（已替换完成）

仓库地址 `https://github.com/Reflaction-del/Project_Floatlight` 已替换到以下文件的所有占位链接：

- `README.md`
- `docs/index.html`
- `docs/404.html`
- `docs/preview-minimal.html` / `docs/preview-glass.html` / `docs/preview-editorial.html`
- `DEPLOY.md`

GitHub Pages 站点地址将是：`https://Reflaction-del.github.io/Project_Floatlight/`

如果将来需要更换仓库地址，可在项目根目录执行：

```bash
sed -i 's|Reflaction-del/Project_Floatlight|新用户名/新仓库名|g' README.md docs/*.html DEPLOY.md
```

## 第 3 步：初始化并推送代码

在项目根目录执行：

```bash
# 初始化仓库
git init

# 添加所有文件
git add .

# 提交
git commit -m "chore: 开源准备 - 添加 LICENSE、README、GitHub Pages 介绍站"

# 关联远程仓库（替换为你的真实地址）
git remote add origin https://github.com/Reflaction-del/Project_Floatlight.git

# 推送
git branch -M main
git push -u origin main
```

> 注意：首次 push 可能需要输入 GitHub 账号密码，或使用 SSH/Personal Access Token。

## 第 4 步：启用 GitHub Pages

1. 打开仓库页面，点击 **Settings**
2. 左侧菜单选择 **Pages**
3. **Source** 选择 **Deploy from a branch**
4. **Branch** 选择 **main**，文件夹选择 **/docs**
5. 点击 **Save**

GitHub 会在几分钟后构建并发布站点。发布成功后，页面顶部会显示：

```
Your site is live at https://Reflaction-del.github.io/Project_Floatlight/
```

## 第 5 步：创建 Release（可选但推荐）

为了让 README 和介绍站中的「下载」按钮生效，需要上传构建产物到 GitHub Releases：

1. 在 GitHub 仓库页面点击右侧 **Releases**
2. 点击 **Create a new release**
3. Tag version 填写 `v2.2.8`
4. Release title 填写 `浮光世界观编辑器 v2.2.8`
5. 将以下文件拖入上传区：
   - `release/浮光世界观编辑器_v2.2.8.exe`
   - `release/浮光世界观编辑器_v2.2.8_Setup.exe`
   - `release/android/浮光世界观编辑器_v2.2.6.apk`
6. 点击 **Publish release**

## 后续更新

每次修改 `docs/` 目录后，只需 push 到 main 分支，GitHub Pages 会自动重新部署，通常 1-3 分钟内生效。

```bash
git add docs/
git commit -m "docs: 更新介绍站"
git push
```

## 常见问题

**Q：页面 404 或样式丢失？**
A：检查 GitHub Pages 设置中是否选择了 `/docs` 文件夹，以及占位链接是否已替换。

**Q：仓库太大 push 失败？**
A：确认 `.gitignore` 已正确排除 `node_modules/`、`android-sdk/`、`release/`、`dist/` 等目录。如果已经误提交，需要清理 Git 历史后重新 push。

**Q：想绑定自定义域名？**
A：在仓库 Settings → Pages 下方的 Custom domain 中填写域名，并在域名 DNS 添加 CNAME 记录指向 `Reflaction-del.github.io`。同时在 `docs/` 目录下创建名为 `CNAME` 的文件，内容为你的域名。
