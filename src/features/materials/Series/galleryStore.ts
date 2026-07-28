// ============================================================
// 视觉物料生成器 · 会话画廊状态（P3-B）
// ------------------------------------------------------------
// 轻量内存画廊：批量 / 套系 / 单张导出时把结果 PNG 推入，
// 在「物料画廊」弹窗中统一展示缩略图，可单独下载或清空。
// 仅会话内有效（不持久化），持久化属 P3-D 市场范畴。
// ============================================================

import { create } from 'zustand';

export interface GalleryItem {
  id: string;
  dataUrl: string;
  label: string;
  createdAt: number;
}

interface GalleryState {
  items: GalleryItem[];
  add: (item: { dataUrl: string; label: string }) => void;
  addMany: (list: { dataUrl: string; label: string }[]) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useGalleryStore = create<GalleryState>((set) => ({
  items: [],
  add: (item) =>
    set((s) => ({
      items: [
        { id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now(), ...item },
        ...s.items,
      ].slice(0, 300),
    })),
  addMany: (list) =>
    set((s) => ({
      items: [
        ...list.map((it, i) => ({
          id: `g-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 5)}`,
          createdAt: Date.now(),
          ...it,
        })),
        ...s.items,
      ].slice(0, 300),
    })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
}));

/** 命令式推送（非 hook 场景，如 renderOne 内部） */
export function addGalleryItem(item: { dataUrl: string; label: string }) {
  useGalleryStore.getState().add(item);
}
