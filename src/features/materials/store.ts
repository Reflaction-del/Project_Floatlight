// ============================================================
// 视觉物料生成器 · UI 工作态（P0-1b）
// ------------------------------------------------------------
// 仅承载「会话内 / 不持久化到 WorldData」的工作态：
// 当前选中的风格 / 模板 / 预览实体、AI 开关、头像三模式、预览缩放。
// 持久化数据（styles / materials）走 worldStore，本 store 只管编辑现场。
// ============================================================

import { create } from 'zustand';
import type { PortraitMode } from './types';

export interface MaterialUIState {
  /** 当前编辑中的风格 id（来自 worldStore.styles） */
  activeStyleId: string | null;
  /** 当前编辑 / 预览的模板 id（来自内置模板注册表） */
  activeTemplateId: string | null;
  /** 预览绑定的主体实体 id（来自 worldStore.entities） */
  previewEntityId: string | null;
  /** 物料级 AI 增强开关（用户决策 #1：每张物料可单独开关） */
  useAI: boolean;
  /** 头像来源三模式（用户决策 #2） */
  portraitMode: PortraitMode;
  /** 预览缩放 0.2 - 2 */
  previewScale: number;

  setActiveStyle: (id: string | null) => void;
  setActiveTemplate: (id: string | null) => void;
  setPreviewEntity: (id: string | null) => void;
  setUseAI: (v: boolean) => void;
  setPortraitMode: (m: PortraitMode) => void;
  setPreviewScale: (n: number) => void;
  /** 一次性复位现场（切换世界时调用） */
  reset: () => void;
}

const INITIAL: Omit<MaterialUIState, 'setActiveStyle' | 'setActiveTemplate' | 'setPreviewEntity' | 'setUseAI' | 'setPortraitMode' | 'setPreviewScale' | 'reset'> = {
  activeStyleId: null,
  activeTemplateId: null,
  previewEntityId: null,
  useAI: false,
  portraitMode: 'entity',
  previewScale: 1,
};

export const useMaterialStore = create<MaterialUIState>((set) => ({
  ...INITIAL,
  setActiveStyle: (id) => set({ activeStyleId: id }),
  setActiveTemplate: (id) => set({ activeTemplateId: id }),
  setPreviewEntity: (id) => set({ previewEntityId: id }),
  setUseAI: (v) => set({ useAI: v }),
  setPortraitMode: (m) => set({ portraitMode: m }),
  setPreviewScale: (n) => set({ previewScale: Math.min(2, Math.max(0.2, n)) }),
  reset: () => set({ ...INITIAL }),
}));
