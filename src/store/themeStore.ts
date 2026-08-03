import { create } from 'zustand';
import type { ThemeMode } from '../types';

const LS_ACCENT = 'fl-custom-accent';
const LS_MODE = 'fl-theme-mode';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'warm', 'blue', 'system'];

interface ThemeState {
  mode: ThemeMode;
  customAccent: string | null;
  setMode: (m: ThemeMode) => void;
  setCustomAccent: (c: string | null) => void;
  apply: () => void;
}

const THEME_BG: Record<string, string> = {
  light: '#FAF9F8', dark: '#1F1F1F', blue: '#0E1B2A', warm: '#F7F2E9',
};
const THEME_FG: Record<string, string> = {
  light: '#242424', dark: '#FFFFFF', blue: '#E6EEF6', warm: '#3A2E1F',
};

const syncWinTheme = (mode: ThemeMode) => {
  try {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const bg = (mode === 'system'
      ? (systemDark ? '#1F1F1F' : '#FAF9F8')
      : THEME_BG[mode]) ?? '#202020';
    const fg = (mode === 'system'
      ? (systemDark ? '#FFFFFF' : '#242424')
      : THEME_FG[mode]) ?? '#FFFFFF';
    const api = (window as any).api;
    if (api?.setWinTheme) {
      api.setWinTheme({ mode, bg, fg });
    } else if (api?.setWinBg) {
      // 兼容旧 preload
      api.setWinBg(bg);
    }
  } catch { /* 非 Electron 环境静默忽略 */ }
};

const applyTheme = (mode: ThemeMode) => {
  const root = document.documentElement;
  if (mode === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', mode);
  }
  syncWinTheme(mode);
};

const applyAccent = (c: string | null) => {
  const root = document.documentElement;
  if (c) {
    root.style.setProperty('--accent', c);
    root.style.setProperty('--accent-soft', c + '26');
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-soft');
  }
};

const loadAccent = (): string | null => {
  try { return localStorage.getItem(LS_ACCENT); } catch { return null; }
};
const saveAccent = (c: string | null) => {
  try { if (c) localStorage.setItem(LS_ACCENT, c); else localStorage.removeItem(LS_ACCENT); } catch {}
};

/** 读取持久化的外观模式；非法/缺失回退 'light' */
const loadMode = (): ThemeMode => {
  try {
    const raw = localStorage.getItem(LS_MODE);
    if (raw && (THEME_MODES as string[]).includes(raw)) return raw as ThemeMode;
  } catch { /* ignore */ }
  return 'light';
};
const saveMode = (m: ThemeMode) => {
  try { localStorage.setItem(LS_MODE, m); } catch { /* ignore */ }
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: typeof window !== 'undefined' ? loadMode() : 'light',
  customAccent: typeof window !== 'undefined' ? loadAccent() : null,
  setMode: (m) => {
    set({ mode: m });
    saveMode(m);
    applyTheme(m);
  },
  setCustomAccent: (c) => {
    set({ customAccent: c });
    saveAccent(c);
    applyAccent(c);
  },
  apply: () => { applyTheme(get().mode); applyAccent(get().customAccent); },
}));

// 初始化时立刻应用（含持久化的外观模式：data-theme 属性 + 原生窗口主题）
if (typeof window !== 'undefined') {
  const initMode = loadMode();
  useThemeStore.setState({ mode: initMode });
  applyTheme(initMode);
  applyAccent(loadAccent());
  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useThemeStore.getState().mode === 'system') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      syncWinTheme('system');
    }
  });
}
