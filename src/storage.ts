// 统一存储抽象：Electron 环境下落盘到「存储位置」目录的 JSON 文件，
// 浏览器 / 预览环境下回退到 localStorage。渲染进程所有持久化调用都走这里。

import type { TabItem } from './types';

interface BootSnapshot {
  saveDir?: string;
  worldsData?: Record<string, unknown>;
  /** 世界观列表（WorldInfo[]），由 worldviewStore.saveWorldview 直接写数组 */
  worldview?: unknown[] | null;
  /** 当前世界观名称，由 worldviewStore.saveCurrent 写入 fl-current-world.json */
  worldviewCurrent?: string | null;
  /** 是否首次安装启动（世界观列表文件此前不存在） */
  freshInstall?: boolean | null;
  ai?: { models: unknown[]; currentId: string };
  /** 共享嵌入模型（语义检索用） */
  embedding?: unknown | null;
  aiUsage?: unknown[] | null;
  keymap?: Record<string, string>;
  /** 上次关闭时保存的标签页状态 */
  uiTabs?: { tabs: TabItem[]; activeTabId: string | null } | null;
}

const LS = {
  worldsData: 'fl-worlds-data',
  worlds: 'fl-worlds',
  current: 'fl-current-world',
  ai: 'fl-ai-store-v2',
  embedding: 'fl-embedding',
};

function api(): any {
  return typeof window !== 'undefined' ? (window as any).api : undefined;
}

function hasFS(): boolean {
  return !!(api() && typeof api().boot === 'function');
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / privacy mode */
  }
}

export const storage = {
  /** 应用启动时从磁盘拉取初始快照（仅 Electron 有效） */
  async boot(): Promise<BootSnapshot | null> {
    if (!hasFS()) return null;
    try {
      return (await api().boot()) as BootSnapshot;
    } catch {
      return null;
    }
  },

  /** 是否已接入原生文件系统（桌面版） */
  isNative(): boolean {
    return hasFS();
  },

  saveWorldsData(data: unknown): void {
    const payload = JSON.stringify(data);
    if (hasFS()) {
      try {
        api().writeFile('fl-worlds-data.json', payload);
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS.worldsData, payload);
    }
  },

  saveWorldview(worlds: unknown): void {
    const payload = JSON.stringify(worlds);
    if (hasFS()) {
      try {
        api().writeFile('fl-worlds.json', payload);
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS.worlds, payload);
    }
  },

  saveCurrent(name: string): void {
    if (hasFS()) {
      try {
        api().writeFile('fl-current-world.json', JSON.stringify(name));
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS.current, name);
    }
  },

  saveAI(models: unknown, currentId: string): void {
    const payload = JSON.stringify({ models, currentId });
    if (hasFS()) {
      try {
        api().writeFile('fl-ai-store-v2.json', payload);
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS.ai, payload);
    }
  },

  /** 保存共享嵌入模型（语义检索用）；传 null 表示清空 */
  saveEmbedding(model: unknown): void {
    const payload = JSON.stringify({ embedding: model });
    if (hasFS()) {
      try {
        api().writeFile('fl-embedding.json', payload);
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS.embedding, payload);
    }
  },

  saveTabs(tabs: TabItem[], activeTabId: string | null): void {
    const payload = JSON.stringify({ tabs, activeTabId });
    if (hasFS()) {
      try {
        api().writeFile('fl-ui-tabs.json', payload);
      } catch {
        /* ignore */
      }
    } else {
      lsSet('fl-ui-tabs', payload);
    }
  },

  readTabs(): { tabs: TabItem[]; activeTabId: string | null } | null {
    if (hasFS()) {
      // 桌面版由 boot 快照一次性读取，渲染进程不直接读文件
      return null;
    }
    const raw = lsGet('fl-ui-tabs');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { tabs: TabItem[]; activeTabId: string | null };
      if (parsed && Array.isArray(parsed.tabs)) return parsed;
      return null;
    } catch {
      return null;
    }
  },

  /** 通用写入：把任意内容写到存储目录下的文件（桌面版）；浏览器回退 localStorage（以文件名去 .json 作为 key） */
  writeFile(name: string, content: string): void {
    if (hasFS()) {
      try {
        api().writeFile(name, content);
      } catch {
        /* ignore */
      }
    } else {
      try {
        localStorage.setItem(name.replace(/\.json$/, ''), content);
      } catch {
        /* ignore */
      }
    }
  },

  /** 通用读取：读取存储目录下的文件（桌面版）；浏览器回退 localStorage。不存在返回 null。 */
  readFile(name: string): string | null {
    if (hasFS()) {
      try {
        return api().readFile(name) ?? null;
      } catch {
        return null;
      }
    }
    try {
      return localStorage.getItem(name.replace(/\.json$/, ''));
    } catch {
      return null;
    }
  },

  /** 获取当前存储目录（桌面版有用） */
  async getSaveDir(): Promise<string | null> {
    if (!hasFS()) return null;
    try {
      return (await api().getSaveDir()) as string;
    } catch {
      return null;
    }
  },

  /** 打开存储目录（桌面版） */
  async openSaveDir(): Promise<string | null> {
    if (!hasFS()) return null;
    try {
      return (await api().openSaveDir()) as string;
    } catch {
      return null;
    }
  },

  /** 修改存储目录并落盘（桌面版） */
  async setSaveDir(dir: string): Promise<string | null> {
    if (!hasFS()) return null;
    try {
      return (await api().setSaveDir(dir)) as string;
    } catch {
      return null;
    }
  },

  /** 调起系统文件选择器读取导入文件（桌面版）；返回 {name, content} 或 null */
  async pickImport(): Promise<{ name: string; content: string } | null> {
    if (!hasFS()) return null;
    try {
      return (await api().pickImport()) as { name: string; content: string } | null;
    } catch {
      return null;
    }
  },

  /** 调起系统保存对话框写文件（桌面版）；返回是否成功 */
  async exportFile(defaultName: string, content: string): Promise<boolean> {
    if (!hasFS()) return false;
    try {
      return (await api().exportFile(defaultName, content)) as boolean;
    } catch {
      return false;
    }
  },

  /** localStorage 兜底读取（仅供启动期合并使用） */
  lsGetWorldsData(): Record<string, unknown> | null {
    const raw = lsGet(LS.worldsData);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  lsGetWorlds(): { worlds: unknown[]; current: string } | null {
    const raw = lsGet(LS.worlds);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  lsGetCurrent(): string | null {
    return lsGet(LS.current);
  },
  lsGetAI(): { models: unknown[]; currentId: string } | null {
    const raw = lsGet(LS.ai);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  lsGetEmbedding(): unknown | null {
    const raw = lsGet(LS.embedding);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.embedding ?? null;
    } catch {
      return null;
    }
  },
};

export type { BootSnapshot };
