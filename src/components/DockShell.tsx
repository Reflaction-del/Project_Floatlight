// ============================================================
// DockShell：四 Dock 布局（类 Photoshop 工作区）
// ------------------------------------------------------------
// left / center / right / bottom 四个 Dock 承载面板；
// 面板头可拖拽到任意 Dock（HTML5 DnD）；dock 间可调宽度；
// center 永远渲染 Main（TabBar + 标签页）。
// ============================================================
import { Suspense } from 'react';
import type { DockId, DockPanel } from '../features/workspace/types';
import { DOCK_ORDER } from '../features/workspace/types';
import { useWorkspaceStore } from '../store/workspaceStore';
import { FileTree } from './FileTree';
import { CopilotSidebar } from './CopilotSidebar';
import { TabContent } from '../App';
import { Main } from '../App';

/** 渲染面板内容（复用现有组件；module 类经 TabContent 渲染） */
export function PanelView({ panel }: { panel: DockPanel }) {
  if (panel.kind === 'filetree') return <FileTree />;
  if (panel.kind === 'copilot') return <CopilotSidebar />;
  if (panel.kind === 'module') {
    if (panel.ref === '__main__') return <Main />;
    return (
      <Suspense fallback={<div className="loading-view">模块加载中…</div>}>
        <TabContent
          tab={{ id: 'p-' + (panel.ref ?? panel.id), title: panel.title, icon: panel.icon, kind: 'module', ref: (panel.ref as any) }}
          mode="preview"
        />
      </Suspense>
    );
  }
  return <div className="dock-panel-empty">面板待实现：{panel.title}</div>;
}

/** 单个 Dock 容器：面板 tab 栏 + 激活面板内容 + 拖拽放置 */
function Dock({ col }: { col: DockId }) {
  const state = useWorkspaceStore((s) => s.docks[col]);
  const draggingPanelId = useWorkspaceStore((s) => s.draggingPanelId);
  const hoverDock = useWorkspaceStore((s) => s.hoverDock);
  const movePanel = useWorkspaceStore((s) => s.movePanel);
  const closePanel = useWorkspaceStore((s) => s.closePanel);
  const setDragging = useWorkspaceStore((s) => s.setDragging);

  const panels = state.panels;
  const active = state.active ?? panels[0]?.id ?? null;
  const activePanel = panels.find((p) => p.id === active) ?? panels[0] ?? null;

  if (panels.length === 0) return null;

  const isVertical = col === 'left' || col === 'right';
  const style = isVertical ? { width: state.size } : { height: state.size };

  return (
    <div
      className={'dock dock-' + col + (hoverDock === col && draggingPanelId ? ' dock-hover' : '')}
      style={style}
      onDragOver={(e) => {
        if (!draggingPanelId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (hoverDock !== col) setDragging(draggingPanelId, col);
      }}
      onDragLeave={() => {
        if (hoverDock === col) setDragging(draggingPanelId, null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const pid = e.dataTransfer.getData('text/plain') || draggingPanelId;
        if (pid) movePanel(pid, col);
        setDragging(null, null);
      }}
    >
      {panels.length > 1 && (
        <div className="dock-tabs">
          {panels.map((p) => (
            <span
              key={p.id}
              className={'dock-tab' + (p.id === active ? ' active' : '')}
              onClick={() => useWorkspaceStore.setState((st) => ({ docks: { ...st.docks, [col]: { ...st.docks[col], active: p.id } } }))}
            >
              {p.title}
              <span className="dock-tab-close" onClick={(e) => { e.stopPropagation(); closePanel(p.id); }}>×</span>
            </span>
          ))}
        </div>
      )}
      {activePanel && (
        <div className="dock-panel" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', activePanel.id); e.dataTransfer.effectAllowed = 'move'; setDragging(activePanel.id, null); }}>
          <div className="dock-panel-head">
            <span className="dock-panel-title">{activePanel.title}</span>
            <span className="dock-panel-drag-tip" title="拖动到任意停靠区">⠿</span>
            <button className="dock-panel-close" onClick={() => closePanel(activePanel.id)} title="关闭面板">×</button>
          </div>
          <div className="dock-panel-body">
            <PanelView panel={activePanel} />
          </div>
        </div>
      )}
    </div>
  );
}

export function DockShell() {
  const docks = useWorkspaceStore((s) => s.docks);
  return (
    <div className="dock-shell">
      <div className="dock-main-row">
        {docks.left.panels.length > 0 && <Dock col="left" />}
        <Dock col="center" />
        {docks.right.panels.length > 0 && <Dock col="right" />}
      </div>
      {docks.bottom.panels.length > 0 && <Dock col="bottom" />}
    </div>
  );
}
