// 浮光世界观编辑器 v2.0.0 · 预加载脚本
// 通过 contextBridge 向渲染进程暴露原生能力：插图选择、文件持久化、导入/导出对话框。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 插图：选择图片并以 dataURL 返回
  openImage: () => ipcRenderer.invoke('open-image'),
  // 启动时从磁盘拉取世界数据快照
  boot: () => ipcRenderer.invoke('boot'),
  // 写入存储目录下的文件（content 为字符串）
  writeFile: (name, content) => ipcRenderer.invoke('fs-write-file', name, content),
  readFile: (name) => ipcRenderer.invoke('fs-read-file', name),
  // 读取/设置/打开存储目录
  getSaveDir: () => ipcRenderer.invoke('fs-get-save-dir'),
  setSaveDir: (dir) => ipcRenderer.invoke('fs-set-save-dir', dir),
  openSaveDir: () => ipcRenderer.invoke('fs-open-save-dir'),
  // 导入：调起系统文件选择器，返回 { name, content }
  pickImport: () => ipcRenderer.invoke('fs-pick-import'),
  // 导出：调起系统保存对话框，写入 content
  exportFile: (defaultName, content) => ipcRenderer.invoke('fs-export', defaultName, content),
  // 动态更新原生窗口标题栏背景色（跟随主题切换）
  setWinBg: (color) => ipcRenderer.invoke('win-set-bg', color),
  // 完整主题同步：背景色 + 标题栏覆盖层 + 原生主题源
  setWinTheme: (theme) => ipcRenderer.invoke('win-set-theme', theme),
  // 原生窗口偏好读写
  winGetPrefs: () => ipcRenderer.invoke('win-get-prefs'),
  winSetPrefs: (prefs) => ipcRenderer.invoke('win-set-prefs', prefs),
  // 自定义标题栏窗口控制
  winControl: (action) => ipcRenderer.invoke('win-control', action),
  // 弹出应用菜单
  winPopupMenu: () => ipcRenderer.invoke('win-popup-menu'),
  // 完全重启应用（标题栏模式切换后使用）
  winRelaunch: () => ipcRenderer.invoke('win-relaunch'),
  // 窗口最大化状态监听
  onWinState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('win-state', handler);
    return () => ipcRenderer.removeListener('win-state', handler);
  },
  // 列出系统已安装字体
  listFonts: () => ipcRenderer.invoke('list-fonts'),
  // 导出 PDF：将 HTML 内容渲染为 PDF 文件
  exportPdf: (htmlContent, title) => ipcRenderer.invoke('export-pdf', htmlContent, title),
  // 视觉物料生成器：离屏截图返回 PNG dataURL
  captureMaterialPng: (html, opts) => ipcRenderer.invoke('material:capture', html, opts),
  // 视觉物料生成器：直接截取当前窗口预览区并保存为 PNG（所见即所得）
  exportPreviewPng: (rect, defaultName) => ipcRenderer.invoke('material:export-preview', rect, defaultName),
  // 视觉物料生成器：截图并保存为 PNG（印刷）
  exportMaterialPng: (html, opts) => ipcRenderer.invoke('material:export-png', html, opts),
  // 视觉物料生成器：打印并保存为 PDF（印刷）
  exportMaterialPdf: (html, opts) => ipcRenderer.invoke('material:export-pdf', html, opts),
  // 视觉物料生成器：选择批量导出目录
  pickFolder: () => ipcRenderer.invoke('material:pick-folder'),
  // 视觉物料生成器：批量写入 PNG 序列 + manifest.json
  materialExportBatch: (folder, items) => ipcRenderer.invoke('material:export-batch', folder, items),
});
