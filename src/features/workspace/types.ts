// ============================================================
// Workspace 布局系统（类 Photoshop/Figma 范式）
// ------------------------------------------------------------
// 四个 Dock（left / center / right / bottom）承载面板；
// 面板可跨 dock 拖拽；预设按创作场景切换；支持保存自定义。
// center 永远承载 TabBar + 标签页（Main），是唯一不可拖出容器，
// 其余 dock 面板可拖到任意 dock。
// ============================================================

export type DockId = 'left' | 'center' | 'right' | 'bottom';

/** 面板种类（决定渲染哪个组件） */
export type PanelKind =
  | 'filetree'      // 文件树
  | 'copilot'       // AI 侧栏
  | 'module'        // 通用模块视图（经 ref 指定：entities/outline/materials/...）
  | 'ailog'         // AI 调用日志
  | 'trace';        // 执行轨迹

export interface DockPanel {
  id: string;        // 唯一：'filetree' | 'copilot' | 'entities' | 'outline' | ...
  kind: PanelKind;
  title: string;
  icon: string;
  /** module 类的目标 ref（entities/outline/materials/consistency/simulation/ttrpg/relations/share） */
  ref?: string;
}

export interface DockState {
  panels: DockPanel[];
  active: string | null;      // 当前激活面板 id（同一 dock 多面板时 tab 切换）
  /** 主尺寸（像素）：left/right = 宽度，bottom = 高度 */
  size: number;
}

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  docks: Record<DockId, DockState>;
}

export const DOCK_ORDER: DockId[] = ['left', 'center', 'right', 'bottom'];

/** 面板 id → 图标（Toolbar 一致的 icon 名） */
export function panelIcon(id: string): string {
  switch (id) {
    case 'filetree': return 'folder';
    case 'copilot': return 'copilot';
    case 'entities': return 'entities';
    case 'outline': return 'outline';
    case 'timeline': return 'timeline';
    case 'materials': return 'materials';
    case 'consistency': return 'consistency';
    case 'simulation': return 'simulation';
    case 'ttrpg': return 'dice';
    case 'relations': return 'relations';
    case 'share': return 'share';
    case 'drafts': return 'drafts';
    case 'ailog': return 'log';
    case 'trace': return 'trace';
    default: return 'module';
  }
}
