import { create } from 'zustand';
import { storage } from '../storage';

/** 所有可被快捷键触发的动作 */
export type KeymapAction =
  | 'save'
  | 'newEntity'
  | 'newDoc'
  | 'focusSearch'
  | 'toggleTheme'
  | 'toggleFileTree'
  | 'toggleCopilot'
  | 'closeTab'
  | 'openSettings'
  | 'openClueBoard'
  | 'openEntities'
  | 'undo'
  | 'redo';

/** 动作展示元信息（设置页用） */
export const ACTION_META: { action: KeymapAction; label: string; desc: string }[] = [
  { action: 'save', label: '保存世界', desc: '把当前世界写入本地文件' },
  { action: 'newEntity', label: '新建实体', desc: '在实体库创建一个新实体' },
  { action: 'newDoc', label: '新建文档', desc: '新建一篇文章并打开' },
  { action: 'focusSearch', label: '聚焦搜索', desc: '聚焦顶部全局搜索框' },
  { action: 'toggleTheme', label: '切换主题', desc: '在浅色/深色/护眼/蓝调间循环' },
  { action: 'toggleFileTree', label: '开/关文件树', desc: '展开或收起左侧文件树' },
  { action: 'toggleCopilot', label: '开/关 AI 侧栏', desc: '展开或收起右侧 AI 助手' },
  { action: 'closeTab', label: '关闭当前标签', desc: '关闭当前活动标签页' },
  { action: 'openSettings', label: '打开设置', desc: '切换到设置页面' },
  { action: 'openClueBoard', label: '打开线索板', desc: '切换到线索板' },
  { action: 'openEntities', label: '打开实体库', desc: '切换到实体库' },
  { action: 'undo', label: '撤销', desc: '在输入框/文档编辑器内生效' },
  { action: 'redo', label: '重做', desc: '在输入框/文档编辑器内生效' },
];

/** 默认快捷键（尽量避开系统保留组合） */
export const DEFAULT_KEYMAP: Record<KeymapAction, string> = {
  save: 'Ctrl+S',
  newEntity: 'Ctrl+Shift+N',
  newDoc: 'Ctrl+Shift+D',
  focusSearch: 'Ctrl+K',
  toggleTheme: 'Ctrl+Shift+L',
  toggleFileTree: 'Ctrl+\\',
  toggleCopilot: 'Ctrl+Shift+C',
  closeTab: 'Ctrl+F4',
  openSettings: 'Ctrl+,',
  openClueBoard: 'Ctrl+Shift+B',
  openEntities: 'Ctrl+Shift+E',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
};

const LS_KEY = 'fl-keymap';

function loadKeymap(): Record<KeymapAction, string> {
  // 桌面版 keymap 由 main.tsx 启动期从 boot 快照注入，这里不读取 localStorage
  if (storage.isNative()) return { ...DEFAULT_KEYMAP };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_KEYMAP, ...(JSON.parse(raw) as Record<KeymapAction, string>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_KEYMAP };
}

function persist(km: Record<KeymapAction, string>) {
  try {
    if (storage.isNative()) {
      storage.writeFile('fl-keymap.json', JSON.stringify(km));
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify(km));
    }
  } catch {
    /* ignore */
  }
}

interface KeymapState {
  keymap: Record<KeymapAction, string>;
  setAction: (action: KeymapAction, combo: string) => void;
  resetAll: () => void;
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  keymap: loadKeymap(),
  setAction: (action, combo) => {
    const km = { ...get().keymap, [action]: combo };
    persist(km);
    set({ keymap: km });
  },
  resetAll: () => {
    persist({ ...DEFAULT_KEYMAP });
    set({ keymap: { ...DEFAULT_KEYMAP } });
  },
}));

/** 把键盘事件解析成组合字符串，例如 "Ctrl+Shift+N"。仅修饰键返回 null。 */
export function eventToCombo(e: KeyboardEvent): string | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const alt = e.altKey;
  const shift = e.shiftKey;
  let key = e.key;
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null;
  const map: Record<string, string> = {
    ' ': 'Space',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Escape': 'Esc',
    'Enter': 'Enter',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'Tab': 'Tab',
  };
  if (map[key]) key = map[key];
  else if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if (ctrl) parts.push('Ctrl');
  if (alt) parts.push('Alt');
  if (shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** 友好显示组合，例如 "Ctrl+Shift+N" → "Ctrl + Shift + N" */
export function formatCombo(combo: string): string {
  return combo.replace(/\+/g, ' + ');
}
