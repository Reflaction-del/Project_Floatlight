// ============================================================
// Workspace 预设：按创作场景切换的布局配方
// ============================================================
import type { Workspace } from './types';

const dock = (
  panels: Workspace['docks']['left']['panels'],
  active: string | null,
  size: number,
): Workspace['docks']['left'] => ({ panels, active, size });

export const WORKSPACE_PRESETS: Workspace[] = [
  {
    id: 'writing',
    name: '写作模式',
    icon: 'doc',
    docks: {
      left: dock([{ id: 'filetree', kind: 'filetree', title: '文件', icon: 'folder' }], 'filetree', 240),
      center: dock([{ id: 'main', kind: 'module', title: '编辑器', icon: 'doc', ref: '__main__' }], 'main', 0),
      right: dock([{ id: 'copilot', kind: 'copilot', title: 'AI 协作者', icon: 'copilot' }], 'copilot', 360),
      bottom: dock([], null, 180),
    },
  },
  {
    id: 'worldbuilding',
    name: '设定模式',
    icon: 'entities',
    docks: {
      left: dock([
        { id: 'entities', kind: 'module', title: '实体库', icon: 'entities', ref: 'entities' },
        { id: 'timeline', kind: 'module', title: '时间线', icon: 'timeline', ref: 'timeline' },
      ], 'entities', 320),
      center: dock([{ id: 'main', kind: 'module', title: '编辑器', icon: 'doc', ref: '__main__' }], 'main', 0),
      right: dock([
        { id: 'consistency', kind: 'module', title: '一致性检查', icon: 'consistency', ref: 'consistency' },
      ], 'consistency', 360),
      bottom: dock([], null, 180),
    },
  },
  {
    id: 'outline',
    name: '大纲模式',
    icon: 'outline',
    docks: {
      left: dock([{ id: 'outline', kind: 'module', title: '全局大纲', icon: 'outline', ref: 'outline' }], 'outline', 300),
      center: dock([{ id: 'main', kind: 'module', title: '编辑器', icon: 'doc', ref: '__main__' }], 'main', 0),
      right: dock([{ id: 'copilot', kind: 'copilot', title: 'AI 协作者', icon: 'copilot' }], 'copilot', 340),
      bottom: dock([], null, 200),
    },
  },
  {
    id: 'material',
    name: '物料模式',
    icon: 'materials',
    docks: {
      left: dock([
        { id: 'entities', kind: 'module', title: '实体库', icon: 'entities', ref: 'entities' },
      ], 'entities', 300),
      center: dock([{ id: 'main', kind: 'module', title: '可视化编辑器', icon: 'materials', ref: '__main__' }], 'main', 0),
      right: dock([
        { id: 'copilot', kind: 'copilot', title: 'AI 协作者', icon: 'copilot' },
      ], 'copilot', 380),
      bottom: dock([], null, 180),
    },
  },
  {
    id: 'ttrpg',
    name: '跑团模式',
    icon: 'dice',
    docks: {
      left: dock([
        { id: 'entities', kind: 'module', title: '角色卡', icon: 'entities', ref: 'entities' },
      ], 'entities', 300),
      center: dock([{ id: 'main', kind: 'module', title: '跑团', icon: 'dice', ref: '__main__' }], 'main', 0),
      right: dock([
        { id: 'copilot', kind: 'copilot', title: 'AI 协作者', icon: 'copilot' },
        { id: 'consistency', kind: 'module', title: '规则检定', icon: 'consistency', ref: 'consistency' },
      ], 'copilot', 340),
      bottom: dock([], null, 180),
    },
  },
];

/** 默认工作区（写作模式） */
export const DEFAULT_WORKSPACE = WORKSPACE_PRESETS[0];

/** 生成一个空自定义工作区模板 */
export function createCustomWorkspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    icon: 'settings',
    docks: {
      left: dock([{ id: 'filetree', kind: 'filetree', title: '文件', icon: 'folder' }], 'filetree', 240),
      center: dock([{ id: 'main', kind: 'module', title: '编辑器', icon: 'doc', ref: '__main__' }], 'main', 0),
      right: dock([{ id: 'copilot', kind: 'copilot', title: 'AI 协作者', icon: 'copilot' }], 'copilot', 360),
      bottom: dock([], null, 180),
    },
  };
}
