import { create } from 'zustand';
import type { ModuleKey, TabItem } from '../types';
import type { WorldData } from './worldStore';
import { getStartPageEnabled } from '../features/settings/startPageSetting';

/** 开始页标签（特殊 tab，不参与文档/实体引用，永远视为有效） */
export const START_TAB_ID = 'tab-start';
function makeStartTab(): TabItem {
  return { id: START_TAB_ID, title: '开始', icon: 'home', kind: 'start', ref: 'start' };
}

/** 根据标签类型推断应高亮的工具栏模块 */
function moduleForTab(t: TabItem | undefined): ModuleKey {
  if (!t) return 'editor';
  if (t.kind === 'module') return t.ref as ModuleKey;
  if (t.kind === 'timeline') return 'timeline';
  return 'editor';
}

export type EditorMode = 'preview' | 'split';

interface OpenTabInput {
  title: string;
  icon?: string;
  kind: 'doc' | 'module' | 'timeline' | 'drafts' | 'entity' | 'start';
  ref: string;
}

/** 校验标签页引用的对象在当前世界中是否存在；module / drafts 等内部页签永远视为有效 */
export function validateTabs(
  tabs: TabItem[],
  activeTabId: string | null,
  wd: WorldData | undefined
): { tabs: TabItem[]; activeTabId: string | null } {
  if (!wd) return { tabs: [], activeTabId: null };
  const valid = tabs.filter((t) => {
    if (t.kind === 'module') return true;
    if (t.kind === 'drafts') return true;
    if (t.kind === 'start') return true;
    if (t.kind === 'doc') return wd.docs.some((d) => d.id === t.ref);
    if (t.kind === 'entity') return wd.entities.some((e) => e.id === t.ref);
    if (t.kind === 'timeline') return wd.timelines.some((tl) => tl.id === t.ref);
    return true;
  });
  const stillActive = activeTabId && valid.some((t) => t.id === activeTabId);
  return { tabs: valid, activeTabId: stillActive ? activeTabId : (valid[0]?.id ?? null) };
}

interface UIState {
  module: ModuleKey;
  mode: EditorMode;
  fileTreeOpen: boolean;
  copilotOpen: boolean;
  /** 提案中心弹窗开关（Phase 0） */
  showProposals: boolean;
  /** AI 调用日志窗口开关（进度窗口，Phase 1a 起） */
  showAILog: boolean;
  // —— 标签页 ——
  tabs: TabItem[];
  activeTabId: string | null;
  /** 右侧分屏标签页（拖出分屏用） */
  splitTabId: string | null;
  setModule: (m: ModuleKey) => void;
  setMode: (m: EditorMode) => void;
  toggleFileTree: () => void;
  toggleCopilot: () => void;
  setCopilot: (v: boolean) => void;
  toggleProposals: () => void;
  setProposals: (v: boolean) => void;
  setAILog: (v: boolean) => void;
  /** 打开（或激活已存在的）标签页；module 类会同步高亮工具栏 */
  openTab: (input: OpenTabInput) => void;
  /** 打开（或激活已存在的）开始页标签 */
  openStartTab: () => void;
  /** 根据开关设置确保开始页标签的存在/移除（用于启动恢复与开关切换） */
  ensureStartPage: () => void;
  closeTab: (id: string) => void;
  closeTabsByRef: (kind: OpenTabInput['kind'], ref: string) => void;
  setActiveTab: (id: string) => void;
  setSplitTab: (id: string | null) => void;
  moveTab: (fromId: string, toIndex: number) => void;
  renameTab: (kind: OpenTabInput['kind'], ref: string, title: string) => void;
  /** 直接替换标签页列表（用于启动时恢复/校验） */
  setTabs: (payload: { tabs: TabItem[]; activeTabId: string | null }) => void;
}

let tabSeq = 1;

export const useUIStore = create<UIState>((set, get) => ({
  module: 'editor',
  mode: 'preview',
  fileTreeOpen: true,
  copilotOpen: true,
  showProposals: false,
  showAILog: false,
  tabs: [],
  activeTabId: null,
  splitTabId: null,
  setModule: (m) => set({ module: m }),
  setMode: (m) => set({ mode: m }),
  toggleFileTree: () => set((s) => ({ fileTreeOpen: !s.fileTreeOpen })),
  toggleCopilot: () => set((s) => ({ copilotOpen: !s.copilotOpen })),
  setCopilot: (v) => set({ copilotOpen: v }),
  toggleProposals: () => set((s) => ({ showProposals: !s.showProposals })),
  setProposals: (v) => set({ showProposals: v }),
  setAILog: (v) => set({ showAILog: v }),
  openTab: ({ title, icon, kind, ref }) => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === kind && t.ref === ref);
    if (existing) {
      const patch: Partial<UIState> = { activeTabId: existing.id };
      if (kind === 'module') patch.module = ref as ModuleKey;
      else if (kind === 'timeline') patch.module = 'timeline';
      else patch.module = 'editor';
      set(patch);
      return;
    }
    // 避免与已持久化的旧标签 ID 重复（tabSeq 应用启动时重置为 1）
    const maxN = s.tabs.reduce((m, t) => {
      if (t.id === START_TAB_ID) return m;
      const n = Number(t.id.replace(/^tab-/, ''));
      return Number.isNaN(n) ? m : Math.max(m, n);
    }, 0);
    const id = `tab-${maxN + 1}`;
    tabSeq = maxN + 2;
    const tab: TabItem = { id, title, icon: icon ?? '', kind, ref };
    const patch: Partial<UIState> = { tabs: [...s.tabs, tab], activeTabId: id };
    if (kind === 'module') patch.module = ref as ModuleKey;
    else if (kind === 'timeline') patch.module = 'timeline';
    else patch.module = 'editor';
    set(patch);
  },
  openStartTab: () => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === 'start');
    if (existing) {
      set({ activeTabId: existing.id, module: 'editor' });
      return;
    }
    const tab = makeStartTab();
    set({ tabs: [...s.tabs, tab], activeTabId: tab.id, module: 'editor' });
  },
  ensureStartPage: () => {
    const s = get();
    const enabled = getStartPageEnabled();
    if (!enabled) {
      // 功能关闭：移除任何开始页标签；若其正激活则回退到其它标签或留空
      const tabs = s.tabs.filter((t) => t.kind !== 'start');
      const activeTabId =
        s.activeTabId && tabs.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : tabs[0]?.id ?? null;
      set({ tabs, activeTabId, splitTabId: s.splitTabId === START_TAB_ID ? null : s.splitTabId });
      return;
    }
    // 功能开启：当没有任何标签时，新建一个开始页标签
    if (s.tabs.length === 0) {
      const tab = makeStartTab();
      set({ tabs: [tab], activeTabId: tab.id, module: 'editor' });
    }
  },
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return {};
      const tab = s.tabs[idx];
      // 规则：当标签栏有且只有一个启动页时，启动页不可被关闭
      if (tab.kind === 'start' && s.tabs.length === 1) return {};
      let tabs = s.tabs.filter((t) => t.id !== id);
      const wasActive = s.activeTabId === id;
      const wasSplit = s.splitTabId === id;
      let activeTabId = s.activeTabId;
      let module = s.module;
      if (wasActive) {
        const next = tabs.length ? tabs[Math.max(0, idx - 1)] : undefined;
        activeTabId = next?.id ?? null;
        module = moduleForTab(next); // 同步工具栏高亮
      }
      // 规则：所有标签页被关闭时，若开启开始页功能则自动新建启动页标签
      if (tabs.length === 0 && getStartPageEnabled()) {
        const start = makeStartTab();
        tabs = [start];
        activeTabId = start.id;
        module = 'editor';
      }
      // 兜底：新激活的标签若恰为分屏标签，清空分屏，避免两栏显示同一内容
      let splitTabId = wasSplit ? null : s.splitTabId;
      if (splitTabId && splitTabId === activeTabId) splitTabId = null;
      return { tabs, activeTabId, module, splitTabId };
    }),
  closeTabsByRef: (kind, ref) =>
    set((s) => {
      const matched = s.tabs.filter((t) => t.kind === kind && t.ref === ref);
      if (matched.length === 0) return {};
      let tabs = s.tabs.filter((t) => !(t.kind === kind && t.ref === ref));
      const wasActive = matched.some((t) => t.id === s.activeTabId);
      const wasSplit = matched.some((t) => t.id === s.splitTabId);
      let activeTabId = s.activeTabId;
      let module = s.module;
      if (wasActive) {
        const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
        const next = tabs.length ? tabs[Math.max(0, idx - 1)] : undefined;
        activeTabId = next?.id ?? null;
        module = moduleForTab(next); // 同步工具栏高亮
      }
      // 所有标签页被关闭时，若开启开始页功能则自动新建启动页标签
      if (tabs.length === 0 && getStartPageEnabled()) {
        const start = makeStartTab();
        tabs = [start];
        activeTabId = start.id;
        module = 'editor';
      }
      let splitTabId = wasSplit ? null : s.splitTabId;
      if (splitTabId && splitTabId === activeTabId) splitTabId = null;
      return { tabs, activeTabId, module, splitTabId };
    }),
  setActiveTab: (id) =>
    set((s) => {
      const t = s.tabs.find((x) => x.id === id);
      const patch: Partial<UIState> = { activeTabId: id, module: moduleForTab(t) };
      // 当选中的标签恰好是分屏标签：交换主/分屏，避免两栏显示同一内容
      if (s.splitTabId === id) patch.splitTabId = s.activeTabId;
      return patch;
    }),
  setSplitTab: (id) =>
    set((s) => {
      if (id && id === s.activeTabId) return {}; // 不能与主标签相同
      return { splitTabId: id };
    }),
  moveTab: (fromId, toIndex) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === fromId);
      if (idx === -1 || idx === toIndex) return {};
      const tabs = [...s.tabs];
      const [tab] = tabs.splice(idx, 1);
      tabs.splice(toIndex, 0, tab);
      return { tabs };
    }),
  renameTab: (kind, ref, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.kind === kind && t.ref === ref ? { ...t, title } : t)) })),
  setTabs: (payload) => set({ tabs: payload.tabs, activeTabId: payload.activeTabId, splitTabId: null }),
}));
