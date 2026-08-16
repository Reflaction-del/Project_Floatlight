// ============================================================
// workspaceStore：Dock 布局状态 + 拖拽 + 预设切换 + 持久化
// ============================================================
import { create } from 'zustand';
import type { DockId, DockPanel, DockState, Workspace } from '../features/workspace/types';
import type { FloatingItem } from '../features/workspace/types';
import { WORKSPACE_PRESETS, DEFAULT_WORKSPACE, createCustomWorkspace } from '../features/workspace/presets';

const LS_CURRENT = 'fl:workspace:current';
const LS_CUSTOM = 'fl:workspace:custom';

function loadFloating(): FloatingItem[] {
  try {
    const raw = localStorage.getItem(LS_FLOATING);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function loadCustom(): Workspace[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

interface WorkspaceStoreState {
  /** 当前工作区 id */
  currentId: string;
  /** 当前工作区的实时 docks（拖拽/调整后即时更新） */
  docks: Record<DockId, DockState>;
  /** 用户自定义工作区列表 */
  customs: Workspace[];
  /** 拖拽中的面板 id（跨 dock 高亮/放置） */
  draggingPanelId: string | null;
  /** 当前悬停高亮的 dock（拖拽放置目标） */
  hoverDock: DockId | null;
  /** 浮动窗口列表 */
  floating: FloatingItem[];
  /** 面板上次所在 dock（关闭后重开回到原位置） */
  lastDockOf: Record<string, DockId>;

  switchWorkspace: (id: string) => void;
  applyWorkspace: (ws: Workspace) => void;
  /** 把面板移动到指定 dock（拖拽放置）；targetIndex 为插入位置（可选） */
  movePanel: (panelId: string, toDock: DockId, targetIndex?: number) => void;
  /** 往指定 dock 添加面板（已在其它 dock 则移动；不存在则创建默认面板）；toDock 缺省用上次位置 */
  addPanel: (panelId: string, toDock?: DockId) => void;
  /** 把面板拖出为浮动窗口 */
  floatPanel: (panelId: string, x: number, y: number) => void;
  /** 浮动窗口放回 dock（缺省回上次 dock） */
  unfloatPanel: (panelId: string, toDock?: DockId) => void;
  moveFloating: (panelId: string, x: number, y: number) => void;
  resizeFloating: (panelId: string, w: number, h: number) => void;
  closeFloating: (panelId: string) => void;
  closePanel: (panelId: string) => void;
  /** 调整 dock 主尺寸 */
  setDockSize: (dock: DockId, size: number) => void;
  /** 保存当前布局为新自定义工作区 */
  saveAsCustom: (name: string) => string;
  deleteCustom: (id: string) => void;
  /** 重置为默认（写作模式） */
  resetToDefault: () => void;
  /** 拖拽状态 */
  setDragging: (panelId: string | null, hoverDock?: DockId | null) => void;
}

function persist(docks: Record<DockId, DockState>, currentId: string) {
  try {
    localStorage.setItem(LS_CURRENT, JSON.stringify({ currentId, docks }));
  } catch {}
}

function persistCustoms(customs: Workspace[]) {
  try {
    localStorage.setItem(LS_CUSTOM, JSON.stringify(customs));
  } catch {}
}

const LS_FLOATING = 'fl:workspace:floating';
function persistFloating(floating: FloatingItem[]) {
  try {
    localStorage.setItem(LS_FLOATING, JSON.stringify(floating));
  } catch {}
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => {
  // 初始化：尝试恢复上次工作区
  let initialDocks = DEFAULT_WORKSPACE.docks;
  let initialId = DEFAULT_WORKSPACE.id;
  let initialFloating: FloatingItem[] = [];
  try {
    const raw = localStorage.getItem(LS_CURRENT);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.docks) {
        initialDocks = saved.docks;
        initialId = saved.currentId || DEFAULT_WORKSPACE.id;
      }
    }
  } catch {}
  initialFloating = loadFloating();

  return {
    currentId: initialId,
    docks: initialDocks,
    floating: initialFloating,
    customs: loadCustom(),
    draggingPanelId: null,
    hoverDock: null,
    lastDockOf: {},

    switchWorkspace: (id) => {
      const { customs } = get();
      const preset = WORKSPACE_PRESETS.find((w) => w.id === id);
      const custom = customs.find((c) => c.id === id);
      const ws = preset ?? custom;
      if (!ws) return;
      set({ currentId: id, docks: JSON.parse(JSON.stringify(ws.docks)) });
      persist(JSON.parse(JSON.stringify(ws.docks)), id);
    },

    applyWorkspace: (ws) => {
      set({ currentId: ws.id, docks: JSON.parse(JSON.stringify(ws.docks)) });
      persist(JSON.parse(JSON.stringify(ws.docks)), ws.id);
    },

    movePanel: (panelId, toDock, targetIndex) => {
      const { docks } = get();
      const fromDock = (Object.keys(docks) as DockId[]).find((d) => docks[d].panels.some((p) => p.id === panelId));
      const from = fromDock ? docks[fromDock] : null;
      const fromPanels = from?.panels ?? [];
      const panel = fromPanels.find((p) => p.id === panelId);
      if (!panel) return;
      if (fromDock) get().lastDockOf[panelId] = fromDock;
      // 新 dock 中已有同名面板则跳过（不允许重复）
      if (docks[toDock].panels.some((p) => p.id === panelId)) return;

      const next: Record<DockId, DockState> = {
        left: { ...docks.left, panels: [...docks.left.panels] },
        center: { ...docks.center, panels: [...docks.center.panels] },
        right: { ...docks.right, panels: [...docks.right.panels] },
        bottom: { ...docks.bottom, panels: [...docks.bottom.panels] },
      };
      if (from) next[fromDock!].panels = fromPanels.filter((p) => p.id !== panelId);
      const targetPanels = next[toDock].panels;
      const idx = typeof targetIndex === 'number' ? Math.min(targetIndex, targetPanels.length) : targetPanels.length;
      next[toDock].panels.splice(idx, 0, panel);
      next[toDock].active = panel.id;
      if (from && next[fromDock!].active === panelId) {
        next[fromDock!].active = next[fromDock!].panels[0]?.id ?? null;
      }
      set({ docks: next });
      persist(next, get().currentId);
    },

    addPanel: (panelId, toDock) => {
      const { docks } = get();
      const dock = toDock ?? get().lastDockOf[panelId] ?? 'left';
      const targetDock = dock as DockId;
      toDock = targetDock;
      // 已在目标 dock？无操作
      if (docks[toDock].panels.some((p) => p.id === panelId)) {
        set({ docks: { ...docks, [toDock]: { ...docks[toDock], active: panelId } } });
        return;
      }
      // 在其它 dock？移动
      const fromDock = (Object.keys(docks) as DockId[]).find((d) => docks[d].panels.some((p) => p.id === panelId));
      if (fromDock) { get().movePanel(panelId, toDock); return; }
      // 不存在 → 用预设定义创建
      const defs: Record<string, DockPanel> = {
        filetree: { id: 'filetree', kind: 'filetree', title: '文件', icon: 'folder' },
        copilot: { id: 'copilot', kind: 'copilot', title: 'AI 协作者', icon: 'copilot' },
        entities: { id: 'entities', kind: 'module', title: '实体库', icon: 'entities', ref: 'entities' },
        outline: { id: 'outline', kind: 'module', title: '全局大纲', icon: 'outline', ref: 'outline' },
        timeline: { id: 'timeline', kind: 'module', title: '时间线', icon: 'timeline', ref: 'timeline' },
        materials: { id: 'materials', kind: 'module', title: '可视化编辑器', icon: 'materials', ref: 'materials' },
        consistency: { id: 'consistency', kind: 'module', title: '一致性检查', icon: 'consistency', ref: 'consistency' },
        simulation: { id: 'simulation', kind: 'module', title: '角色模拟', icon: 'simulation', ref: 'simulation' },
        ttrpg: { id: 'ttrpg', kind: 'module', title: '跑团', icon: 'dice', ref: 'ttrpg' },
        relations: { id: 'relations', kind: 'module', title: '线索板', icon: 'relations', ref: 'relations' },
        share: { id: 'share', kind: 'module', title: '协作与分享', icon: 'share', ref: 'share' },
      };
      const panel = defs[panelId];
      if (!panel) return;
      const next = { ...docks, [toDock]: { ...docks[toDock], panels: [...docks[toDock].panels, panel], active: panelId } };
      set({ docks: next });
      persist(next, get().currentId);
    },

    closePanel: (panelId) => {
      const { docks } = get();
      const next: Record<DockId, DockState> = {
        left: { ...docks.left, panels: docks.left.panels.filter((p) => p.id !== panelId) },
        center: { ...docks.center, panels: docks.center.panels.filter((p) => p.id !== panelId) },
        right: { ...docks.right, panels: docks.right.panels.filter((p) => p.id !== panelId) },
        bottom: { ...docks.bottom, panels: docks.bottom.panels.filter((p) => p.id !== panelId) },
      };
      for (const d of Object.keys(next) as DockId[]) {
        if (next[d].active === panelId) next[d].active = next[d].panels[0]?.id ?? null;
      }
      set({ docks: next });
      persist(next, get().currentId);
    },

    floatPanel: (panelId, x, y) => {
      const { docks, floating } = get();
      const fromDock = (Object.keys(docks) as DockId[]).find((d) => docks[d].panels.some((p) => p.id === panelId));
      const panel = fromDock ? docks[fromDock].panels.find((p) => p.id === panelId) : null;
      if (!panel) return;
      if (fromDock) get().lastDockOf[panelId] = fromDock;
      const nextDocks = { ...docks };
      if (fromDock) {
        nextDocks[fromDock] = { ...docks[fromDock], panels: docks[fromDock].panels.filter((p) => p.id !== panelId), active: docks[fromDock].active === panelId ? null : docks[fromDock].active };
      }
      const maxW = typeof window !== 'undefined' ? window.innerWidth - 240 : 1200;
      const maxH = typeof window !== 'undefined' ? window.innerHeight - 160 : 800;
      const item: FloatingItem = { panel, x: Math.max(40, Math.min(x, maxW)), y: Math.max(40, Math.min(y, maxH)), w: 380, h: 480, z: Date.now() };
      set({ docks: nextDocks, floating: [...floating, item] });
      persist(nextDocks, get().currentId);
      persistFloating([...floating, item]);
    },
    unfloatPanel: (panelId, toDock) => {
      const { floating, lastDockOf } = get();
      const item = floating.find((f) => f.panel.id === panelId);
      if (!item) return;
      const rest = floating.filter((f) => f.panel.id !== panelId);
      set({ floating: rest });
      persistFloating(rest);
      const dock = toDock ?? lastDockOf[panelId] ?? 'left';
      get().addPanel(panelId, dock);
    },
    moveFloating: (panelId, x, y) => {
      set((st) => ({ floating: st.floating.map((f) => (f.panel.id === panelId ? { ...f, x, y } : f)) }));
      persistFloating(get().floating);
    },
    resizeFloating: (panelId, w, h) => {
      set((st) => ({ floating: st.floating.map((f) => (f.panel.id === panelId ? { ...f, w: Math.max(200, w), h: Math.max(140, h) } : f)) }));
      persistFloating(get().floating);
    },
    closeFloating: (panelId) => {
      const rest = get().floating.filter((f) => f.panel.id !== panelId);
      set({ floating: rest });
      persistFloating(rest);
    },

    setDockSize: (dock, size) => {
      const { docks } = get();
      const next = { ...docks, [dock]: { ...docks[dock], size } };
      set({ docks: next });
      persist(next, get().currentId);
    },

    saveAsCustom: (name) => {
      const { docks, customs } = get();
      const id = `custom-${Date.now().toString(36)}`;
      const ws = createCustomWorkspace(id, name.trim() || '自定义工作区');
      ws.docks = JSON.parse(JSON.stringify(docks));
      const next = [...customs, ws];
      set({ customs: next, currentId: id, docks: ws.docks });
      persistCustoms(next);
      persist(ws.docks, id);
      return id;
    },

    deleteCustom: (id) => {
      const { customs } = get();
      const next = customs.filter((c) => c.id !== id);
      set({ customs: next, currentId: get().currentId === id ? DEFAULT_WORKSPACE.id : get().currentId });
      persistCustoms(next);
    },

    resetToDefault: () => {
      set({ currentId: DEFAULT_WORKSPACE.id, docks: JSON.parse(JSON.stringify(DEFAULT_WORKSPACE.docks)) });
      persist(JSON.parse(JSON.stringify(DEFAULT_WORKSPACE.docks)), DEFAULT_WORKSPACE.id);
    },

    setDragging: (panelId, hoverDock = null) => set({ draggingPanelId: panelId, hoverDock }),
  };
});
