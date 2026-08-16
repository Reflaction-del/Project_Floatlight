import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';
import { WORKSPACE_PRESETS, DEFAULT_WORKSPACE } from '../features/workspace/presets';

beforeEach(() => {
  // 重置到默认写作工作区，避免用例间状态污染
  useWorkspaceStore.getState().resetToDefault();
});

describe('workspaceStore Dock 布局', () => {
  it('默认工作区：左=文件树 中=main 右=copilot', () => {
    const d = useWorkspaceStore.getState().docks;
    expect(d.left.panels.map((p) => p.id)).toContain('filetree');
    expect(d.center.panels.some((p) => p.id === 'main')).toBe(true);
    expect(d.right.panels.map((p) => p.id)).toContain('copilot');
  });

  it('预设列表完整（5 个）且 id 唯一', () => {
    expect(WORKSPACE_PRESETS).toHaveLength(5);
    const ids = WORKSPACE_PRESETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_WORKSPACE.id).toBe('writing');
  });

  it('switchWorkspace 切换布局', () => {
    const st = useWorkspaceStore.getState();
    st.switchWorkspace('material');
    const d = useWorkspaceStore.getState().docks;
    // 物料模式：左=实体库
    expect(d.left.panels.map((p) => p.id)).toContain('entities');
    expect(d.left.size).toBe(300);
    st.switchWorkspace('writing');
    expect(useWorkspaceStore.getState().docks.left.panels.map((p) => p.id)).toContain('filetree');
  });

  it('movePanel 跨 dock 拖拽（文件树 → 右 dock）', () => {
    const st = useWorkspaceStore.getState();
    st.movePanel('filetree', 'right');
    const d = useWorkspaceStore.getState().docks;
    expect(d.left.panels.find((p) => p.id === 'filetree')).toBeUndefined();
    expect(d.right.panels.map((p) => p.id)).toContain('filetree');
  });

  it('movePanel 不允许重复面板（拖到已有同名面板的 dock 被忽略）', () => {
    const st = useWorkspaceStore.getState();
    // filetree 已存在于左 dock；拖到左 dock（重复）→ 忽略
    const before = st.docks.left.panels.length;
    st.movePanel('filetree', 'left');
    expect(useWorkspaceStore.getState().docks.left.panels.length).toBe(before);
  });

  it('addPanel 新增面板 / closePanel 关闭面板', () => {
    const st = useWorkspaceStore.getState();
    st.addPanel('entities', 'right');
    expect(useWorkspaceStore.getState().docks.right.panels.map((p) => p.id)).toContain('entities');
    st.closePanel('entities');
    expect(useWorkspaceStore.getState().docks.right.panels.map((p) => p.id)).not.toContain('entities');
    // 关闭后再 add → 回到 right
    st.addPanel('entities', 'right');
    expect(useWorkspaceStore.getState().docks.right.panels.map((p) => p.id)).toContain('entities');
  });

  it('setDockSize 调整宽度', () => {
    const st = useWorkspaceStore.getState();
    st.setDockSize('right', 420);
    expect(useWorkspaceStore.getState().docks.right.size).toBe(420);
  });

  it('movePanel 支持插入位置（targetIndex 排序）', () => {
    const st = useWorkspaceStore.getState();
    st.addPanel('entities', 'right');   // right: copilot, entities
    st.addPanel('outline', 'right');    // right: copilot, entities, outline
    // 把 filetree 插到 right 的第 1 位（copilot 前）
    st.movePanel('filetree', 'right', 0);
    const ids = useWorkspaceStore.getState().docks.right.panels.map((p) => p.id);
    expect(ids[0]).toBe('filetree');
    expect(ids).toContain('outline');
  });

  it('预设 bottom 面板（writing=ailog, outline=trace）', () => {
    const st = useWorkspaceStore.getState();
    st.switchWorkspace('writing');
    expect(useWorkspaceStore.getState().docks.bottom.panels.map((p) => p.id)).toContain('ailog');
    st.switchWorkspace('outline');
    expect(useWorkspaceStore.getState().docks.bottom.panels.map((p) => p.id)).toContain('trace');
  });

  it('saveAsCustom 保存当前布局为新工作区', () => {
    const st = useWorkspaceStore.getState();
    st.movePanel('filetree', 'bottom');
    const id = st.saveAsCustom('我的布局');
    const st2 = useWorkspaceStore.getState();
    expect(st2.customs.some((c) => c.id === id)).toBe(true);
    expect(st2.currentId).toBe(id);
    // 恢复默认后文件树回到左
    st2.switchWorkspace('writing');
    expect(useWorkspaceStore.getState().docks.left.panels.map((p) => p.id)).toContain('filetree');
  });
});
