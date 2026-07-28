import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useThemeStore } from './store/themeStore';
import { useWorldStore, DEFAULT_WORLD, DEFAULT_DATA, isOldDemo, isDefaultWorldEmpty, needsSeedUpgrade } from './store/worldStore';
import { useWorldviewStore } from './store/worldviewStore';
import { useAIStore, getModelDefaults } from './store/aiStore';
import { useKeymapStore, DEFAULT_KEYMAP, type KeymapAction } from './store/keymapStore';
import { useUIStore, validateTabs } from './store/uiStore';
import { useAIUsageStore } from './store/aiUsageStore';
import { storage } from './storage';
import { initAutoIndex } from './utils/embeddingIndex';

async function init() {
  // 桌面版：用磁盘快照覆盖内存中的 localStorage 初始值，使数据持久可靠
  const snap = await storage.boot();
  if (snap) {
    if (snap.worldsData && Object.keys(snap.worldsData).length) {
      const wd = snap.worldsData as Record<string, any>;
      // 旧版示例工程（世界内一切皆空）视为待升级，替换为全新示例工程
      const ex = wd[DEFAULT_WORLD];
      const isStaleSample = isDefaultWorldEmpty(ex);
      const isOld = ex && isOldDemo(ex);
      if (isStaleSample || isOld || needsSeedUpgrade(ex)) {
        wd[DEFAULT_WORLD] = DEFAULT_DATA;
        storage.saveWorldsData(wd);
      }
      useWorldStore.setState({ worldsData: wd as any });
    } else {
      // 首次运行：把默认世界镜像到磁盘，保证数据落盘
      storage.saveWorldsData(useWorldStore.getState().worldsData);
    }
    if (Array.isArray(snap.worldview) && (snap.worldview as any[]).length) {
      const list = snap.worldview as { name: string }[];
      const cur = (typeof snap.worldviewCurrent === 'string' && snap.worldviewCurrent) || list[0].name;
      useWorldviewStore.setState({ worlds: list as any, current: cur });
    } else {
      storage.saveWorldview(useWorldviewStore.getState().worlds);
      storage.saveCurrent(useWorldviewStore.getState().current);
    }
    if (snap.ai) {
      const defaults = getModelDefaults();
      const models = ((snap.ai.models as any[]) || []).map((m) => ({ ...defaults, ...m }));
      useAIStore.setState({ models, currentId: snap.ai.currentId || '' });
    }
    if (snap.embedding !== undefined) {
      useAIStore.setState({ embeddingModel: (snap.embedding as any) ?? null });
    }
    if (snap.aiUsage && Array.isArray(snap.aiUsage)) {
      useAIUsageStore.setState({ records: snap.aiUsage as any });
    }
    if (snap.keymap) {
      useKeymapStore.setState({ keymap: { ...DEFAULT_KEYMAP, ...(snap.keymap as Record<KeymapAction, string>) } });
    }
    // 首次安装启动：进入“引导新建世界观”流程
    if (snap?.freshInstall) {
      useWorldviewStore.setState({ firstRun: true });
    }
  }
  // 统一当前世界（worldStore / worldviewStore 保持同步）
  const cur = useWorldviewStore.getState().current || useWorldStore.getState().current;
  useWorldStore.setState({ current: cur });
  useWorldviewStore.setState({ current: cur });

  // 恢复上次打开的标签页，并过滤掉已删除的文档/实体/时间轴/可视化等无效页签
  const savedTabs = snap?.uiTabs ?? storage.readTabs();
  if (savedTabs && savedTabs.tabs.length) {
    const wd = useWorldStore.getState().worldsData[cur];
    const { tabs, activeTabId } = validateTabs(savedTabs.tabs, savedTabs.activeTabId, wd);
    useUIStore.setState({ tabs, activeTabId, splitTabId: null });
  }
  // 根据「启动时显示开始页」开关，确保开始页标签的存在/移除（空标签栏时自动新建）
  useUIStore.getState().ensureStartPage();
  // 启动语义索引的自动更新监听（按用户设置的策略增量重建向量索引）
  initAutoIndex();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

init();
