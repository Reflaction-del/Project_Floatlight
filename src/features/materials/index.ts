// 视觉物料生成器 · 桶文件（统一导出，供 P0-2+ 各阶段引用）
export * from './types';
export { useMaterialStore } from './store';
export type { MaterialUIState } from './store';
export { MaterialForgeView } from './MaterialForgeView';
export { TemplateEditor } from './TemplateEditor';
export { MarketPanel } from './MarketPanel';
export * from './market';
export { StyleEditor } from './StyleEditor';
export { BatchPanel } from './Batch/BatchPanel';
export { ConsistencyPanel } from './Consistency/ConsistencyPanel';
export { SeriesPanel } from './Series/SeriesPanel';
export { GalleryModal } from './Series/GalleryModal';
export { useGalleryStore, addGalleryItem } from './Series/galleryStore';
export { renderMaterialSvg } from './SvgRenderer';
export { scanMaterialConsistency } from './Consistency/visualConsistency';
