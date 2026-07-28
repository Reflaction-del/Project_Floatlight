import { create } from 'zustand';
import { storage } from '../storage';

const LS_KEY = 'fl-worlds';
const LS_CURRENT = 'fl-current-world';

export interface WorldInfo {
  name: string;
  /** 主色（accent），无则用主题默认色 */
  themeColor?: string;
  /** 显示图标（空字符串表示无图标，由界面回退为默认圆点） */
  icon: string;
  /** 是否为随包内置的示例工程（名称后追加「（示例）」标记） */
  isExample?: boolean;
}

interface WVState {
  current: string;
  worlds: WorldInfo[];
  dirty: boolean;
  /** 是否处于“首次安装”引导态 */
  firstRun: boolean;
  setCurrent: (name: string) => void;
  addWorld: (name: string, icon?: string) => void;
  removeWorld: (name: string) => string;
  updateWorld: (name: string, patch: Partial<WorldInfo>) => void;
  setFirstRun: (v: boolean) => void;
  markDirty: () => void;
  markClean: () => void;
}

/** 随包内置的示例工程名称（显示为「幻光纪元（示例）」） */
export const EXAMPLE_WORLD = '幻光纪元';

function loadWorlds(): WorldInfo[] {
  // 桌面版：由 main.tsx 启动期从磁盘注入；浏览器/预览环境从 localStorage 读取
  if (storage.isNative()) return [{ name: '幻光纪元', icon: '', isExample: true }];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [{ name: '幻光纪元', icon: '', isExample: true }];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) {
      // 兼容旧格式（字符串数组）
      if (typeof arr[0] === 'string') {
        return (arr as string[]).map((n) => ({ name: n, icon: '' }));
      }
      const list = arr as WorldInfo[];
      // 旧数据兼容：若列表含示例工程但无 isExample 标记则补上
      return list.map((w) => (w.name === EXAMPLE_WORLD && w.isExample === undefined ? { ...w, isExample: true } : w));
    }
    return [{ name: '幻光纪元', icon: '', isExample: true }];
  } catch {
    return [{ name: '幻光纪元', icon: '', isExample: true }];
  }
}

/** 计算世界在界面上的显示名：示例工程追加「（示例）」 */
export function displayWorldName(w: WorldInfo | undefined): string {
  if (!w) return '';
  return w.isExample ? `${w.name}（示例）` : w.name;
}

function saveWorlds(ws: WorldInfo[]) {
  storage.saveWorldview(ws);
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function applyTheme(world: WorldInfo | undefined) {
  if (!world?.themeColor) {
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-soft');
  } else {
    document.documentElement.style.setProperty('--accent', world.themeColor);
    document.documentElement.style.setProperty('--accent-soft', world.themeColor + '26');
  }
}

const initialWorlds = loadWorlds();
const initialCurrent = storage.isNative()
  ? initialWorlds[0]?.name || '幻光纪元'
  : (localStorage.getItem(LS_CURRENT) || initialWorlds[0]?.name || '幻光纪元');

export const useWorldviewStore = create<WVState>((set, get) => ({
  current: initialCurrent,
  worlds: initialWorlds,
  dirty: false,
  firstRun: false,
  setCurrent: (name) => {
    const w = get().worlds.find((x) => x.name === name);
    set({ current: name, dirty: false });
    storage.saveCurrent(name);
    applyTheme(w);
  },
  addWorld: (name, icon) => {
    const ws = [...get().worlds, { name, icon: icon ?? '' }];
    saveWorlds(ws);
    set({ worlds: ws });
  },
  removeWorld: (name) => {
    const ws = get().worlds.filter((w) => w.name !== name);
    saveWorlds(ws);
    const cur = get().current;
    const next = name === cur ? (ws[0]?.name ?? '默认') : cur;
    if (name === cur) storage.saveCurrent(next);
    set({ worlds: ws, current: next });
    if (name === cur) applyTheme(ws.find((x) => x.name === next));
    return next;
  },
  updateWorld: (name, patch) => {
    const trimmedName = typeof patch.name === 'string' ? patch.name.trim() : undefined;
    if (trimmedName === '') {
      // 禁止将世界名称设为空或仅空白；保持原名称
      const ws = get().worlds.map((w) => w.name === name ? { ...w, ...patch, name: w.name } : w);
      saveWorlds(ws);
      set({ worlds: ws });
      return;
    }
    if (trimmedName !== undefined && trimmedName !== name) {
      if (get().worlds.some((w) => w.name === trimmedName)) {
        // 与已有世界重名，忽略本次名称变更但保留其他 patch
        const ws = get().worlds.map((w) => w.name === name ? { ...w, ...patch, name: w.name } : w);
        saveWorlds(ws);
        set({ worlds: ws });
        return;
      }
    }
    const ws = get().worlds.map((w) => w.name === name ? { ...w, ...patch } : w);
    saveWorlds(ws);
    set({ worlds: ws });
    if (get().current === name) applyTheme(ws.find((x) => x.name === (trimmedName ?? name)));
  },
  setFirstRun: (v) => set({ firstRun: v }),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),
}));

// 启动时同步当前世界主题
if (typeof window !== 'undefined') {
  const w = initialWorlds.find((x) => x.name === initialCurrent);
  if (w) applyTheme(w);
}
