// 全局应用偏好（跨世界、跨会话持久化，存于 localStorage）
// 承载「窗口效果」：none / aero / acrylic / mica
// 承载「渐变配色 / 模糊强度 / 标题栏模式」
import { useSyncExternalStore } from 'react';

export type WindowEffect = 'none' | 'aero' | 'acrylic' | 'mica';
export type GradientPreset = 'default' | 'deep-sea' | 'aurora' | 'twilight' | 'ember' | 'frost' | 'custom';
export type TitleBarMode = 'system' | 'custom';

const KEY = 'fl-app-prefs';
const VALID: WindowEffect[] = ['none', 'aero', 'acrylic', 'mica'];
const VALID_GRADIENT: GradientPreset[] = ['default', 'deep-sea', 'aurora', 'twilight', 'ember', 'frost', 'custom'];
const VALID_TITLEBAR: TitleBarMode[] = ['system', 'custom'];

export interface AppPrefsState {
  windowEffect: WindowEffect;
  gradientPreset: GradientPreset;
  customGradient: [string, string, string];
  blurIntensity: number;
  titleBar: TitleBarMode;
}

const DEFAULT_EFFECT_GRADIENT: Record<WindowEffect, string> = {
  none: '', // none 模式使用主题默认背景，不覆盖 body
  aero: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 40%, #06b6d4 100%)',
  acrylic: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #475569 100%)',
  mica: 'linear-gradient(135deg, #0B0F19 0%, #1e293b 60%, #334155 100%)',
};

const PRESET_GRADIENT: Record<Exclude<GradientPreset, 'default' | 'custom'>, string> = {
  'deep-sea': 'linear-gradient(135deg, #020617 0%, #0f4c81 45%, #22d3ee 100%)',
  aurora: 'linear-gradient(135deg, #020617 0%, #047857 45%, #c084fc 100%)',
  twilight: 'linear-gradient(135deg, #1e1b4b 0%, #a21caf 45%, #fbbf24 100%)',
  ember: 'linear-gradient(135deg, #2a0505 0%, #b91c1c 45%, #fde047 100%)',
  frost: 'linear-gradient(135deg, #0f172a 0%, #2563eb 45%, #bfdbfe 100%)',
};

/** 每个配色方案对应的“超级调色盘”主色（用于染全局 accent / border / hover） */
const PRESET_PALETTE: Record<Exclude<GradientPreset, 'default' | 'custom'>, string> = {
  'deep-sea': '#0EA5E9',
  aurora: '#10B981',
  twilight: '#F59E0B',
  ember: '#EF4444',
  frost: '#3B82F6',
};

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 获取当前配色方案的全局染色主色；none / default 返回 null */
export function paletteAccentFor(s?: AppPrefsState): string | null {
  const st = s ?? state;
  if (st.windowEffect === 'none') return null;
  if (st.gradientPreset === 'custom') {
    // 自定义配色取中间色作为主色
    return st.customGradient[1];
  }
  if (st.gradientPreset !== 'default') {
    return PRESET_PALETTE[st.gradientPreset];
  }
  return null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function load(): AppPrefsState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AppPrefsState>;
      if (p) {
        return {
          windowEffect: VALID.includes(p.windowEffect as WindowEffect) ? (p.windowEffect as WindowEffect) : 'none',
          gradientPreset: VALID_GRADIENT.includes(p.gradientPreset as GradientPreset) ? (p.gradientPreset as GradientPreset) : 'default',
          customGradient: Array.isArray(p.customGradient) && p.customGradient.length === 3
            ? (p.customGradient as [string, string, string])
            : ['#0B1220', '#1E3A5F', '#0EA5E9'],
          blurIntensity: typeof p.blurIntensity === 'number' ? clamp(p.blurIntensity, 0, 100) : 70,
          titleBar: VALID_TITLEBAR.includes(p.titleBar as TitleBarMode) ? (p.titleBar as TitleBarMode) : 'system',
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    windowEffect: 'none',
    gradientPreset: 'default',
    customGradient: ['#0B1220', '#1E3A5F', '#0EA5E9'],
    blurIntensity: 70,
    titleBar: 'system',
  };
}

let state: AppPrefsState = load();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function gradientFor(s: AppPrefsState): string {
  if (s.windowEffect === 'none') return '';
  if (s.gradientPreset === 'custom') {
    const [a, b, c] = s.customGradient;
    return `linear-gradient(135deg, ${a} 0%, ${b} 50%, ${c} 100%)`;
  }
  if (s.gradientPreset !== 'default') {
    return PRESET_GRADIENT[s.gradientPreset];
  }
  return DEFAULT_EFFECT_GRADIENT[s.windowEffect];
}

/** 将当前（或指定）窗口效果应用到 DOM（纯 CSS 方案，不影响布局/系统窗口） */
export function applyWindowEffect(effect?: WindowEffect) {
  const eff = effect ?? state.windowEffect;
  const body = document.body;
  body.classList.remove('effect-none', 'effect-aero', 'effect-acrylic', 'effect-mica');
  body.classList.add('effect-' + eff);

  // 背景渐变
  const grad = gradientFor(state.windowEffect === eff ? state : { ...state, windowEffect: eff });
  body.style.background = grad || '';

  // 模糊/饱和度强度
  const intensity = clamp(state.blurIntensity, 0, 100);
  const blurPx = Math.round(intensity * 0.4 * 10) / 10; // 0 ~ 40px
  const saturatePct = Math.round(100 + intensity * 0.8); // 100% ~ 180%
  document.documentElement.style.setProperty('--win-blur', `${blurPx}px`);
  document.documentElement.style.setProperty('--win-saturate', `${saturatePct}%`);

  // 超级调色盘：将配色方案主色注入 CSS 变量，供 index.css 染全局 accent / border / hover
  const palette = paletteAccentFor(state.windowEffect === eff ? state : { ...state, windowEffect: eff });
  const root = document.documentElement;
  if (palette) {
    root.style.setProperty('--palette-accent', palette);
    root.style.setProperty('--palette-soft', hexToRgba(palette, 0.15));
    root.style.setProperty('--palette-faint', hexToRgba(palette, 0.08));
    root.style.setProperty('--palette-border', hexToRgba(palette, 0.28));
    root.setAttribute('data-palette', state.gradientPreset === 'custom' ? 'custom' : state.gradientPreset);
  } else {
    root.style.removeProperty('--palette-accent');
    root.style.removeProperty('--palette-soft');
    root.style.removeProperty('--palette-faint');
    root.style.removeProperty('--palette-border');
    root.removeAttribute('data-palette');
  }
}

function syncTitleBarFile() {
  // 把标题栏模式同步给主进程持久化（切换需重启，主进程启动时读取）
  try {
    (window as any).api?.winSetPrefs?.({ titleBar: state.titleBar });
  } catch {
    /* 非 Electron 环境静默忽略 */
  }
}

export const appPrefs = {
  get windowEffect(): WindowEffect {
    return state.windowEffect;
  },
  get gradientPreset(): GradientPreset {
    return state.gradientPreset;
  },
  get customGradient(): [string, string, string] {
    return state.customGradient;
  },
  get blurIntensity(): number {
    return state.blurIntensity;
  },
  get titleBar(): TitleBarMode {
    return state.titleBar;
  },
  setWindowEffect(effect: WindowEffect) {
    state = { ...state, windowEffect: effect };
    persist();
    emit();
    applyWindowEffect(effect);
  },
  setGradientPreset(preset: GradientPreset) {
    state = { ...state, gradientPreset: preset };
    persist();
    emit();
    applyWindowEffect();
  },
  setCustomGradient(colors: [string, string, string]) {
    state = { ...state, customGradient: colors, gradientPreset: 'custom' };
    persist();
    emit();
    applyWindowEffect();
  },
  setBlurIntensity(intensity: number) {
    state = { ...state, blurIntensity: clamp(intensity, 0, 100) };
    persist();
    emit();
    applyWindowEffect();
  },
  setTitleBar(mode: TitleBarMode) {
    state = { ...state, titleBar: mode };
    persist();
    syncTitleBarFile();
    emit();
  },
  // 由 App.tsx 在启动时根据主进程实际窗口模式校准
  syncTitleBar(mode: TitleBarMode) {
    if (state.titleBar !== mode) {
      state = { ...state, titleBar: mode };
      persist();
      emit();
    }
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** React 订阅钩子（设置页选中态用） */
export function useAppPrefs(): AppPrefsState {
  return useSyncExternalStore(
    (cb) => appPrefs.subscribe(cb),
    () => state,
    () => state,
  );
}
