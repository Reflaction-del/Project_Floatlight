// 浮光世界观编辑器 v2.0.0 · Electron 主进程
// 内嵌静态服务器托管 dist，规避 file:// 下 ES Module 限制。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');

const DIST = path.join(app.getAppPath(), 'dist');
const PRELOAD = path.join(app.getAppPath(), 'preload.cjs');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath;
      try {
        urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      } catch {
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      if (urlPath === '/') urlPath = '/index.html';
      // 路径穿越防护：拒绝含 '..' 的路径，并确保解析后的路径仍位于 DIST 内
      if (urlPath.includes('..')) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      let filePath = path.normalize(path.join(DIST, urlPath));
      if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST, 'index.html'); // SPA 回退
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// 存储目录配置（位于用户数据目录下），可被设置界面覆盖
const SAVE_CONFIG = path.join(app.getPath('userData'), 'fl-savedir.json');

// 原生窗口偏好（标题栏模式等），主进程启动前必须读取
const WIN_PREFS_FILE = path.join(app.getPath('userData'), 'fl-window-prefs.json');

function readWinPrefs() {
  try {
    const raw = fs.readFileSync(WIN_PREFS_FILE, 'utf8');
    const p = JSON.parse(raw);
    return { titleBar: p.titleBar === 'custom' ? 'custom' : 'system' };
  } catch {
    return { titleBar: 'system' };
  }
}

function writeWinPrefs(prefs) {
  try {
    fs.writeFileSync(WIN_PREFS_FILE, JSON.stringify(prefs, null, 2));
  } catch {
    /* ignore */
  }
}

let winPrefs = { titleBar: 'system' };

function getSaveDir() {
  try {
    const c = JSON.parse(fs.readFileSync(SAVE_CONFIG, 'utf8'));
    if (c && c.dir) return c.dir;
  } catch { /* 未配置则用默认目录 */ }
  return path.join(app.getPath('userData'), 'worlds');
}

function ensureDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  return d;
}

function safeName(n) {
  return String(n).replace(/[\\/:*?"<>|]/g, '_');
}

// 备份冷却：避免每次按键都复制大文件，仅周期性保留上一份“已成功写入”的副本作为安全网
let lastBackupMs = 0;
const BACKUP_COOLDOWN_MS = 5 * 60 * 1000;

// 原子写：先写临时文件再 rename，避免进程崩溃 / 断电导致目标文件被截断而损坏（修复 P0-1.2）
function atomicWriteFile(targetPath, content) {
  try {
    if (fs.existsSync(targetPath) && Date.now() - lastBackupMs > BACKUP_COOLDOWN_MS) {
      fs.copyFileSync(targetPath, targetPath + '.bak');
      lastBackupMs = Date.now();
    }
  } catch { /* 备份失败不影响主写入 */ }
  const tmpPath = targetPath + '.tmp';
  fs.writeFileSync(tmpPath, String(content));
  fs.renameSync(tmpPath, targetPath);
}

function readJson(f) {
  const p = path.join(getSaveDir(), f);
  let raw = null;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { raw = null; }
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // 主文件损坏：尝试回退到最近备份，避免“截断即全丢”
    try {
      const bak = fs.readFileSync(p + '.bak', 'utf8');
      console.warn(`[storage] ${f} 解析失败，已回退到 .bak 备份`);
      return JSON.parse(bak);
    } catch {
      return null;
    }
  }
}

// 启动时把磁盘上的世界数据一次性交给渲染进程
ipcMain.handle('boot', () => {
  const dir = ensureDir(getSaveDir());
  // 若世界观列表文件尚不存在，说明是“首次安装”启动
  const freshInstall = !fs.existsSync(path.join(dir, 'fl-worlds.json'));
  return {
    saveDir: dir,
    freshInstall,
    worldsData: readJson('fl-worlds-data.json'),
    worldview: readJson('fl-worlds.json'),
    worldviewCurrent: readJson('fl-current-world.json'),
    ai: readJson('fl-ai-store-v2.json'),
    embedding: readJson('fl-embedding.json')?.embedding ?? null,
    aiUsage: readJson('fl-ai-usage-v1.json'),
    keymap: readJson('fl-keymap.json'),
    uiTabs: readJson('fl-ui-tabs.json'),
  };
});

// 渲染进程写入存储目录下的文件（原子写，见 atomicWriteFile）
ipcMain.handle('fs-write-file', (e, name, content) => {
  const dir = ensureDir(getSaveDir());
  atomicWriteFile(path.join(dir, safeName(name)), content);
});

// 渲染进程读取存储目录下的文件（用于加载语义索引等侧车文件）
ipcMain.handle('fs-read-file', (e, name) => {
  const dir = ensureDir(getSaveDir());
  const p = path.join(dir, safeName(name));
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
});

ipcMain.handle('fs-get-save-dir', () => getSaveDir());

ipcMain.handle('fs-open-save-dir', () => {
  const dir = ensureDir(getSaveDir());
  // 在资源管理器中打开存储目录；失败时不阻断流程
  try { shell.openPath(dir); } catch { /* ignore */ }
  return dir;
});

// 把旧目录下所有 JSON 数据文件迁移到新目录，避免切换路径后数据“一分为二”
function migrateSaveDir(oldDir, newDir) {
  if (!oldDir || !newDir || oldDir === newDir) return;
  if (!fs.existsSync(oldDir)) return;
  try {
    const entries = fs.readdirSync(oldDir);
    for (const name of entries) {
      const src = path.join(oldDir, name);
      if (!fs.statSync(src).isFile()) continue;
      if (!name.endsWith('.json') && !name.endsWith('.bak') && !name.endsWith('.tmp')) continue;
      const dst = path.join(newDir, name);
      fs.copyFileSync(src, dst);
    }
  } catch (err) {
    console.error('[storage] 迁移旧目录数据失败', err);
  }
}

ipcMain.handle('fs-set-save-dir', (e, dir) => {
  const oldDir = getSaveDir();
  const d = ensureDir(dir);
  // 先迁移，再保存配置：保证新目录立即包含完整历史数据
  migrateSaveDir(oldDir, d);
  try { fs.writeFileSync(SAVE_CONFIG, JSON.stringify({ dir: d })); } catch { /* ignore */ }
  return d;
});

// 导入：系统文件选择器
ipcMain.handle('fs-pick-import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '导入世界观',
    properties: ['openFile'],
    filters: [{ name: '世界观 JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return null;
  try {
    return { name: path.basename(filePaths[0]), content: fs.readFileSync(filePaths[0], 'utf8') };
  } catch {
    return null;
  }
});

// 导出：系统保存对话框
ipcMain.handle('fs-export', async (e, defaultName, content) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出世界观',
    defaultPath: safeName(defaultName),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return false;
  try { fs.writeFileSync(filePath, String(content)); return true; } catch { return false; }
});

// 唤起系统文件选择器，读取图片并以 dataURL 返回
ipcMain.handle('open-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择插图',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
  });
  if (canceled || filePaths.length === 0) return null;
  const p = filePaths[0];
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).toLowerCase().replace('.', '');
  const mime = ['jpg', 'jpeg'].includes(ext) ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
  return `data:image/${mime};base64,${buf.toString('base64')}`;
});

// 列出系统已安装字体
ipcMain.handle('list-fonts', async () => {
  try {
    const fontList = require('font-list');
    return await fontList.getFonts();
  } catch { return []; }
});

// 导出 PDF：将 HTML 渲染为 PDF 并通过保存对话框输出
ipcMain.handle('export-pdf', async (e, htmlContent, title) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return false;
  try {
    const tempWin = new BrowserWindow({
      show: false,
      width: 794, // A4 width @96dpi
      height: 1123, // A4 height @96dpi
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    // 注入打印友好的基础样式 + 内容
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;padding:36px 48px;color:#1a1a1a;line-height:1.8;font-size:14px}
      h1{font-size:22px;margin:.6em 0 .4em;border-bottom:2px solid #0F6CBD;padding-bottom:.3em}
      h2{font-size:18px;margin:.5em 0 .3em;color:#333}
      h3{font-size:16px;margin:.4em 0 .25em;color:#444}
      p{margin:.3em 0}
      blockquote{border-left:3px solid #ccc;margin:.4em 0;padding:.2em 1em;color:#666;background:#f9f9f9}
      code{background:#f0f0f0;padding:1px 5px;border-radius:3px;font-size:13px}
      pre{background:#f5f5f5;padding:12px;border-radius:6px;overflow:auto;font-size:13px}
      table{border-collapse:collapse;width:100%;margin:.5em 0}
      th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:13px}
      th{background:#f0f0f0;font-weight:600}
      img{max-width:100%;height:auto;border-radius:4px}
      hr{border:none;border-top:1px solid #ddd;margin:1em 0}
      ul,ol{padding-left:1.5em;margin:.3em 0}
    </style></head><body>${htmlContent}</body></html>`;
    await tempWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);
    // 等待渲染完成
    await new Promise((r) => setTimeout(r, 300));
    const pdfData = await tempWin.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.7, bottom: 0.7, left: 0.65, right: 0.65 },
      preferCSSPageSize: false,
    });
    tempWin.close();
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 PDF',
      defaultPath: safeName(title || '文档') + '.pdf',
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, pdfData);
    return true;
  } catch (err) {
    console.error('[export-pdf]', err);
    return false;
  }
});

// 视觉物料生成器 · 离屏渲染与导出（P0-6b）
// 把“自包含 HTML 文档字符串”载入一个隐藏 BrowserWindow，
// 等待渲染完成后截图（capturePage）或打印为 PDF；返回 dataURL / 写入文件。
function openHidden(w, h, scale) {
  return new BrowserWindow({
    show: false,
    useContentSize: true, // width/height 指内容区，避免边框挤压导致滚动条
    width: w,
    height: h,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    ...(scale && scale !== 1 ? { deviceScaleFactor: scale } : {}),
  });
}
function loadAndSettle(win, html) {
  return new Promise((resolve, reject) => {
    win.webContents.once('did-fail-load', (_e, _code, desc) => reject(new Error(desc || 'load failed')));
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => {
      // 字体 / 内联图片解码需要一点延迟，350ms 足够离线场景
      setTimeout(resolve, 350);
    }).catch(reject);
  });
}
// 直接截取当前窗口中指定区域的预览图并保存为 PNG（WYSIWYG 导出）
ipcMain.handle('material:export-preview', async (_e, rect, defaultName = 'preview') => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win || !rect) return false;
  let zoom = 1;
  try {
    // 确保缩放因子为 1，使 rect 与截图像素 1:1 对应
    zoom = win.webContents.getZoomFactor();
    win.webContents.setZoomFactor(1);
    await new Promise((r) => setTimeout(r, 50));
    const image = await win.webContents.capturePage({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出预览图',
      defaultPath: safeName(defaultName) + '.png',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, image.toPNG());
    return true;
  } catch (err) {
    console.error('[material:export-preview]', err);
    return false;
  } finally {
    try { win.webContents.setZoomFactor(zoom); } catch { /* ignore */ }
  }
});
// 截图并返回 PNG dataURL（供预览/社交复制使用）
ipcMain.handle('material:capture', async (_e, html, opts) => {
  const { width = 794, height = 1123, scale = 2 } = opts || {};
  let win;
  try {
    win = openHidden(width, height, scale);
    await loadAndSettle(win, html);
    const image = await win.webContents.capturePage();
    return 'data:image/png;base64,' + image.toPNG().toString('base64');
  } catch (err) {
    console.error('[material:capture]', err);
    return null;
  } finally {
    if (win) win.close();
  }
});
// 截图并通过保存对话框导出 PNG（印刷实体，自定义像素密度）
ipcMain.handle('material:export-png', async (_e, html, opts) => {
  const { width = 794, height = 1123, scale = 3, defaultName = 'material' } = opts || {};
  let win;
  try {
    win = openHidden(width, height, scale);
    await loadAndSettle(win, html);
    const png = await win.webContents.capturePage();
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 PNG（印刷）',
      defaultPath: safeName(defaultName) + '.png',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, png.toPNG());
    return true;
  } catch (err) {
    console.error('[material:export-png]', err);
    return false;
  } finally {
    if (win) win.close();
  }
});
// 打印为 PDF（自定义毫米尺寸 → 微米，保证 1:1 物理比例）
ipcMain.handle('material:export-pdf', async (_e, html, opts) => {
  const { widthMm = 210, heightMm = 297, defaultName = 'material' } = opts || {};
  const wpx = Math.round(widthMm * 96 / 25.4);
  const hpx = Math.round(heightMm * 96 / 25.4);
  let win;
  try {
    win = openHidden(wpx, hpx, 1);
    await loadAndSettle(win, html);
    const buf = await win.webContents.printToPDF({
      pageSize: { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) },
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 PDF（印刷）',
      defaultPath: safeName(defaultName) + '.pdf',
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, buf);
    return true;
  } catch (err) {
    console.error('[material:export-pdf]', err);
    return false;
  } finally {
    if (win) win.close();
  }
});
// 选择批量导出目录（创建物料套系用）
ipcMain.handle('material:pick-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择批量导出目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});
// 批量写入 PNG 序列 + manifest.json（零新依赖，直接落盘）
ipcMain.handle('material:export-batch', async (_e, folder, items) => {
  try {
    if (!folder || !Array.isArray(items)) return { written: 0, folder: null };
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    let written = 0;
    for (const it of items) {
      const m = /^data:image\/png;base64,(.+)$/.exec(it.dataUrl || '');
      if (!m) continue;
      const name = safeName(it.filename || `item-${written + 1}`) + '.png';
      fs.writeFileSync(path.join(folder, name), Buffer.from(m[1], 'base64'));
      written++;
    }
    const manifest = {
      generatedAt: new Date().toISOString(),
      count: written,
      items: items.map((it) => ({
        filename: safeName(it.filename || '') + '.png',
        entityId: it.entityId ?? '',
        entityName: it.entityName ?? '',
      })),
    };
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { written, folder };
  } catch (err) {
    console.error('[material:export-batch]', err);
    return { written: 0, folder: null, error: String(err) };
  }
});

// 动态更新窗口标题栏背景色（跟随主题切换）
ipcMain.handle('win-set-bg', (_e, color) => {
  const wins = BrowserWindow.getAllWindows();
  if (wins[0]) wins[0].setBackgroundColor(color);
});

// 获取当前原生窗口偏好（供渲染进程校准 UI）
ipcMain.handle('win-get-prefs', () => winPrefs);

// 设置原生窗口偏好（标题栏模式等需重启生效）
ipcMain.handle('win-set-prefs', (_e, prefs) => {
  if (prefs && typeof prefs === 'object') {
    if (prefs.titleBar === 'system' || prefs.titleBar === 'custom') {
      winPrefs.titleBar = prefs.titleBar;
      writeWinPrefs(winPrefs);
    }
  }
  return winPrefs;
});

// 自定义标题栏窗口控制
ipcMain.handle('win-control', (_e, action) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return { maximized: false };
  switch (action) {
    case 'minimize':
      win.minimize();
      break;
    case 'maximize':
      win.maximize();
      break;
    case 'restore':
      win.unmaximize();
      break;
    case 'close':
      win.close();
      break;
    case 'toggle-maximize':
      if (win.isMaximized()) win.unmaximize(); else win.maximize();
      break;
    case 'query':
      break;
  }
  return { maximized: win.isMaximized() };
});

// 弹出应用菜单（自定义标题栏模式下替代原生菜单栏）
ipcMain.handle('win-popup-menu', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  const menu = Menu.getApplicationMenu();
  if (menu) menu.popup({ window: win, x: 10, y: 36 });
});

// 完全重启应用（标题栏模式切换后必须重启主进程才能生效）
let isRelaunching = false;
ipcMain.handle('win-relaunch', () => {
  isRelaunching = true;
  app.relaunch();
  app.quit();
});

// 完整主题同步：背景色 + 标题栏覆盖层 + 原生主题源（解决系统标题栏与编辑器主题不同步）
ipcMain.handle('win-set-theme', (_e, theme) => {
  const wins = BrowserWindow.getAllWindows();
  const win = wins[0];
  if (!win || !theme) return;
  const { bg, fg, mode } = theme;
  if (bg) win.setBackgroundColor(bg);

  // 同步 Windows 标题栏按钮暗/亮模式
  const themeSource = mode === 'system' ? 'system' : (mode === 'light' || mode === 'warm' ? 'light' : 'dark');
  nativeTheme.themeSource = themeSource;

  // Windows 11：自定义标题栏覆盖层颜色，使系统标题栏与编辑器融为一体
  if (process.platform === 'win32' && win.setTitleBarOverlay) {
    try {
      win.setTitleBarOverlay({
        color: bg || '#202020',
        symbolColor: fg || (themeSource === 'light' ? '#1a1a1a' : '#ffffff'),
        height: 32,
      });
    } catch {
      /* 旧版 Windows 忽略 */
    }
  }
});

// —— 原生菜单（中文） ——
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '关闭窗口', role: 'close' },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于浮光',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: '关于浮光',
              message: '浮光 · AI 世界观编辑器（预览版）',
              detail: '用于世界观写作、关系梳理与可视化的本地桌面工具。',
            }),
        },
        { label: '重新加载', role: 'reload' },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

async function createWindow() {
  const port = await startServer();
  const useCustomTitleBar = winPrefs.titleBar === 'custom';
  const win = new BrowserWindow({
    width: 1280,
    height: useCustomTitleBar ? 892 : 860, // 自定义标题栏占用 32px，保持内容区一致
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#202020', // 默认深色中性底；渲染进程可通过 IPC 动态覆盖
    icon: path.join(__dirname, 'dist', 'logo', 'logo_256x256.png'),
    frame: !useCustomTitleBar,
    titleBarStyle: useCustomTitleBar ? undefined : 'default',
    autoHideMenuBar: useCustomTitleBar, // 自建标题栏时隐藏原生菜单栏，通过菜单按钮弹出
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,
    },
  });
  win.loadURL(`http://127.0.0.1:${port}/`);

  // 修复：启动时窗口偶尔未在系统层面获得焦点，表现为「所有文本框无法输入，
  // 必须切走再切回应用才恢复」。加载完成后主动请求焦点（win + webContents 双重保险），
  // 并延时补一次，避免首帧焦点被系统吃掉的边界情况。
  win.once('ready-to-show', () => { try { win.focus(); } catch { /* ignore */ } });
  win.once('did-finish-load', () => {
    try { win.focus(); } catch { /* ignore */ }
    try { win.webContents.focus(); } catch { /* ignore */ }
  });
  try { win.focus(); } catch { /* ignore */ }
  setTimeout(() => { try { win.focus(); } catch { /* ignore */ } }, 300);
  setTimeout(() => { try { win.webContents.focus(); } catch { /* ignore */ } }, 600);

  // 向渲染进程广播窗口最大化/还原状态（自定义标题栏更新图标）
  win.on('maximize', () => win.webContents.send('win-state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win-state', { maximized: false }));

  // 关闭确认：数据已实时自动保存，弹原生确认框询问是否退出。
  // 避免 Electron 新版 beforeunload 不再弹窗导致“无法关闭且无提示”的问题。
  let allowClose = false;
  win.on('close', async (e) => {
    if (allowClose || isRelaunching) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: '退出浮光',
      message: '确定要退出浮光 · AI 世界观编辑器吗？',
      detail: '所有改动已自动保存到本地，退出后不会丢失。',
      buttons: ['取消', '退出'],
      defaultId: 1,
      cancelId: 0,
    });
    if (response === 1) {
      allowClose = true;
      win.close();
    }
  });
}

app.whenReady().then(async () => {
  winPrefs = readWinPrefs();
  Menu.setApplicationMenu(buildMenu());
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
