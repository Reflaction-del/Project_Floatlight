import { create } from 'zustand';

const LS_KEY = 'fl-recent-files';
const MAX_RECENTS = 10;

export interface RecentFile {
  /** 世界名称 */
  name: string;
  /** 文件/世界图标（emoji） */
  icon: string;
  /** 最后打开时间（ISO 字符串） */
  lastOpened: string;
}

interface RFState {
  recents: RecentFile[];
  addRecent: (name: string, icon?: string) => void;
  removeRecent: (name: string) => void;
  clearRecents: () => void;
}

function loadRecents(): RecentFile[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr as RecentFile[];
  } catch {
    return [];
  }
}

function saveRecents(recents: RecentFile[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(recents));
  } catch {
    /* ignore quota errors */
  }
}

export const useRecentFilesStore = create<RFState>((set, get) => ({
  recents: loadRecents(),

  addRecent: (name, icon) => {
    const list = get().recents.filter((r) => r.name !== name);
    list.unshift({
      name,
      icon: icon ?? '',
      lastOpened: new Date().toISOString(),
    });
    if (list.length > MAX_RECENTS) list.length = MAX_RECENTS;
    set({ recents: list });
    saveRecents(list);
  },

  removeRecent: (name) => {
    const list = get().recents.filter((r) => r.name !== name);
    set({ recents: list });
    saveRecents(list);
  },

  clearRecents: () => {
    set({ recents: [] });
    saveRecents([]);
  },
}));
