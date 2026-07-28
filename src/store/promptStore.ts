import { create } from 'zustand';

export interface PromptField {
  name: string;
  label: string;
  placeholder?: string;
  default?: string;
  type?: 'text' | 'number' | 'select' | 'color';
  options?: { value: string; label: string }[];
}

export interface PromptConfig {
  title: string;
  fields: PromptField[];
  resolve: (values: Record<string, string> | null) => void;
}

interface PromptState {
  config: PromptConfig | null;
  /** 打开弹窗，返回用户填写的字段值（取消为 null） */
  open: (cfg: Omit<PromptConfig, 'resolve'>) => Promise<Record<string, string> | null>;
  close: (values: Record<string, string> | null) => void;
}

export const usePromptStore = create<PromptState>((set, get) => ({
  config: null,
  open: (cfg) =>
    new Promise((resolve) => {
      set({ config: { ...cfg, resolve } });
    }),
  close: (values) => {
    const cfg = get().config;
    cfg?.resolve(values);
    set({ config: null });
  },
}));
