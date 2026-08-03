import { useEffect, useState, lazy, Suspense } from 'react';
import { useUIStore } from './store/uiStore';
import { useWorldStore } from './store/worldStore';
import { useThemeStore } from './store/themeStore';
import { useWorldviewStore } from './store/worldviewStore';
import { useRecentFilesStore } from './store/recentFilesStore';
import { Toolbar } from './components/Toolbar';
import { FileTree } from './components/FileTree';
import { CopilotSidebar } from './components/CopilotSidebar';
import { ProposalCenter } from './components/ProposalCenter';
import { AILogPanel } from './components/AILogPanel';
import { TabBar } from './components/TabBar';
import { TitleBar } from './components/TitleBar';
import { PromptModal } from './components/PromptModal';
import { Editor } from './features/editor/Editor';
import { SettingsView } from './features/settings/SettingsView';
import { DraftsView } from './features/drafts/DraftsView';
import { EntityEditor } from './features/entities/EntityEditor';
import { EntityLibrary } from './features/entities/EntityLibrary';
import { OnboardingModal } from './features/onboarding/OnboardingModal';
import { FirstRunModal } from './components/FirstRunModal';
import { StartPage } from './components/StartPage';

// 重型视图改为按需懒加载：首屏只加载外壳与轻量视图，物料生成器（含 qrcode /
// canvas / svg 渲染链）、关系图（图布局）、一致性检查、分享、时间轴等仅在打开
// 对应标签页时才下载对应 chunk，显著缩短启动时的 JS 解析量、提升打开速度。
const MaterialForgeView = lazy(() =>
  import('./features/materials/MaterialForgeView').then((m) => ({ default: m.MaterialForgeView })),
);
const RelationGraphView = lazy(() =>
  import('./features/relations/RelationGraphView').then((m) => ({ default: m.RelationGraphView })),
);
const ConsistencyView = lazy(() =>
  import('./features/consistency/ConsistencyView').then((m) => ({ default: m.ConsistencyView })),
);
const SharePanel = lazy(() =>
  import('./features/share/SharePanel').then((m) => ({ default: m.SharePanel })),
);
const TimelineView = lazy(() =>
  import('./features/timeline/TimelineView').then((m) => ({ default: m.TimelineView })),
);
import { useKeymapStore, eventToCombo, type KeymapAction } from './store/keymapStore';
import { storage } from './storage';
import { appPrefs } from './store/appPrefs';
import type { EditorMode } from './store/uiStore';
import type { TabItem, ThemeMode } from './types';
import { ENTITY_TEMPLATES, ENTITY_LABEL } from './types';

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'warm', 'blue', 'system'];

/** 执行某个快捷键动作（所有调用走 getState，避免重渲染） */
function runKeymapAction(action: KeymapAction) {
  const ui = useUIStore.getState();
  const world = useWorldStore.getState();
  switch (action) {
    case 'save':
      world.saveNow();
      break;
    case 'toggleFileTree':
      ui.toggleFileTree();
      break;
    case 'toggleCopilot':
      ui.toggleCopilot();
      break;
    case 'toggleTheme': {
      const cur = useThemeStore.getState().mode;
      const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
      useThemeStore.getState().setMode(next);
      break;
    }
    case 'openSettings':
      ui.openTab({ title: '设置', icon: 'settings', kind: 'module', ref: 'settings' });
      break;
    case 'openClueBoard':
      ui.openTab({ title: '线索板', icon: 'relations', kind: 'module', ref: 'relations' });
      break;
    case 'openEntities':
      ui.openTab({ title: '实体库', icon: 'entities', kind: 'module', ref: 'entities' });
      break;
    case 'closeTab':
      if (ui.activeTabId) ui.closeTab(ui.activeTabId);
      break;
    case 'focusSearch': {
      const el = document.getElementById('global-search-input') as HTMLInputElement | null;
      el?.focus();
      break;
    }
    case 'newEntity': {
      const tpl = ENTITY_TEMPLATES.find((t) => t.type === 'character');
      const name = (ENTITY_LABEL.character ?? '角色') + '·未命名';
      const id = world.addEntity({
        type: 'character',
        name,
        fields: (tpl?.fields ?? []).map((f) => ({ label: f.label, value: '', kind: f.kind, entityType: f.entityType })),
      });
      ui.openTab({ title: name, icon: 'character', kind: 'entity', ref: id });
      break;
    }
    case 'newDoc': {
      const wd = world.worldsData[world.current];
      const folder = wd?.folders?.[0] ?? '未分组';
      world.addDoc('未命名文章', folder);
      const docs = useWorldStore.getState().worldsData[useWorldStore.getState().current]?.docs ?? [];
      const created = docs[docs.length - 1];
      if (created) ui.openTab({ title: created.title, icon: created.icon || 'doc', kind: 'doc', ref: created.id });
      break;
    }
    case 'undo':
      window.dispatchEvent(new CustomEvent('fg-editor-undo'));
      break;
    case 'redo':
      window.dispatchEvent(new CustomEvent('fg-editor-redo'));
      break;
  }
}

function TabContent({ tab, mode }: { tab: TabItem; mode: EditorMode }) {
  if (tab.kind === 'doc') return <Editor key={tab.ref} docId={tab.ref} mode={mode} />;
  if (tab.kind === 'timeline') return <TimelineView key={tab.ref} timelineId={tab.ref} />;
  if (tab.kind === 'entity') return <EntityEditor key={tab.ref} entityId={tab.ref} />;
  if (tab.kind === 'drafts') return <DraftsView key={tab.ref} />;
  switch (tab.ref) {
    case 'materials':
      return <MaterialForgeView />;
    case 'timeline':
      return <TimelineView />;
    case 'settings':
      return <SettingsView />;
    case 'entities':
      return <EntityLibrary />;
    case 'consistency':
      return <ConsistencyView />;
    case 'relations':
      return <RelationGraphView />;
    case 'share':
      return <SharePanel />;
    case 'drafts':
      return <DraftsView />;
    default:
      return null;
  }
}

function Main() {
  const tabs = useUIStore((s) => s.tabs);
  const activeTabId = useUIStore((s) => s.activeTabId);
  const splitTabId = useUIStore((s) => s.splitTabId);
  const mode = useUIStore((s) => s.mode);
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const split = tabs.find((t) => t.id === splitTabId) ?? null;

  return (
    <div className="main">
      <TabBar />
      <div className={'panes' + (split ? ' split' : '')}>
        <div className="pane">
          {active ? (
            active.kind === 'start' ? (
              <StartPage />
            ) : (
              <Suspense fallback={<div className="loading-view">模块加载中…</div>}>
                <TabContent tab={active} mode={mode} />
              </Suspense>
            )
          ) : (
            <div className="placeholder-view">
              <div className="ph-card">
                <div className="big app-logo-placeholder">浮光</div>
                <div className="ph-title">欢迎使用浮光</div>
                <div className="ph-text">从左侧文件管理新建文章 / 可视化，或点击图标栏打开实体库、线索板、一致性检查等模块，开始搭建你的世界。</div>
                <div className="ph-hint">所有改动实时自动保存</div>
              </div>
            </div>
          )}
        </div>
        {split && (
          <div className="pane split-pane">
            <Suspense fallback={<div className="loading-view">模块加载中…</div>}>
              <TabContent tab={split} mode={mode} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const fileTreeOpen = useUIStore((s) => s.fileTreeOpen);
  const copilotOpen = useUIStore((s) => s.copilotOpen);
  const firstRun = useWorldviewStore((s) => s.firstRun);
  const [titleBar, setTitleBar] = useState(appPrefs.titleBar);

  // 启动时与主进程实际窗口模式校准（自定义标题栏需 frameless）
  useEffect(() => {
    (async () => {
      try {
        const prefs = await (window as any).api?.winGetPrefs?.();
        if (prefs?.titleBar) {
          appPrefs.syncTitleBar(prefs.titleBar);
          setTitleBar(prefs.titleBar);
        }
      } catch { /* 非 Electron 环境忽略 */ }
    })();
  }, []);

  // 退出前（窗口关闭 / 刷新）再做一次落盘，确保最后一次改动已写入磁盘
  useEffect(() => {
    const flush = () => {
      try {
        useWorldStore.getState().saveNow();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // 全局快捷键：单一 window keydown 监听，按 keymap 分发动作
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const combo = eventToCombo(e);
      if (!combo) return;
      const km = useKeymapStore.getState().keymap;
      const action = (Object.keys(km) as KeymapAction[]).find((a) => km[a] === combo);
      if (!action) return;
      const target = e.target as HTMLElement | null;
      const editable = !!target?.closest('input,textarea,[contenteditable],.ProseMirror');
      // 撤销/重做在可编辑区域放手给原生（避免破坏编辑器撤销栈）
      if ((action === 'undo' || action === 'redo') && editable) return;
      // 在可编辑区域内，无修饰键的单字符输入直接放行，避免干扰正常打字
      if (editable && !e.ctrlKey && !e.metaKey && !e.altKey) return;
      e.preventDefault();
      runKeymapAction(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 启动即应用已保存的窗口效果（aero/acrylic/mica/none）
  useEffect(() => {
    try {
      appPrefs.setWindowEffect(appPrefs.windowEffect);
    } catch {
      /* ignore */
    }
  }, []);

  // 标签页状态持久化：任何增删改都实时写盘，崩溃/重启也能恢复
  useEffect(() => {
    const unsub = useUIStore.subscribe((s, prev) => {
      if (s.tabs === prev.tabs && s.activeTabId === prev.activeTabId) return;
      storage.saveTabs(s.tabs, s.activeTabId);
    });
    return unsub;
  }, []);

  // 当文档/实体/时间轴/可视化被删除时，同步关闭对应标签页，避免残留“幽灵页签”
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { kind: TabItem['kind']; ref: string } | undefined;
      if (!detail) return;
      useUIStore.getState().closeTabsByRef(detail.kind, detail.ref);
    };
    window.addEventListener('fg-close-tabs', handler);
    return () => window.removeEventListener('fg-close-tabs', handler);
  }, []);

  // 世界切换时自动记录到近期文件
  useEffect(() => {
    const unsub = useWorldviewStore.subscribe((s, prev) => {
      if (s.current !== prev.current && s.current) {
        const w = s.worlds.find((x) => x.name === s.current);
        if (w) useRecentFilesStore.getState().addRecent(s.current, w.icon);
      }
    });
    return unsub;
  }, []);

  // 将 UI 控制方法暴露给编辑器右键菜单等独立组件
  useEffect(() => {
    (window as any).__FG_UI__ = {
      setCopilot: (v: boolean) => useUIStore.getState().setCopilot(v),
    };
  }, []);

  return (
    <div className="app-root">
      {titleBar === 'custom' && <TitleBar />}
      <div className={'shell' + (titleBar === 'custom' ? ' with-custom-titlebar' : '')}>
        <Toolbar />
        {fileTreeOpen && <FileTree />}
        <Main />
        {copilotOpen && <CopilotSidebar />}
        <ProposalCenter />
        <AILogPanel />
        <PromptModal />
        <OnboardingModal />
        {firstRun && <FirstRunModal />}
      </div>
    </div>
  );
}
