// ============================================================
// DockShell：四 Dock 布局（类 Photoshop 工作区）
// ------------------------------------------------------------
// left / center / right / bottom 四个 Dock 承载面板；
// 面板头可拖拽到任意 Dock（HTML5 DnD，支持插入位置排序）；
// left/right 与 center 之间、bottom 顶部可拖拽调整尺寸；
// center 永远渲染 Main（TabBar + 标签页）。
// ============================================================
import { Suspense, useRef } from 'react';
import type { DockId, DockPanel } from '../features/workspace/types';
import { useWorkspaceStore } from '../store/workspaceStore';
import { FileTree } from './FileTree';
import { CopilotSidebar } from './CopilotSidebar';
import { AILogPanel } from './AILogPanel';
import { TracePanel } from '../features/agent/TracePanel';
import { TabContent, Main } from '../App';

/** 渲染面板内容（复用现有组件；module 类经 TabContent 渲染） */
export function PanelView({ panel }: { panel: DockPanel }) {
  if (panel.kind === 'filetree') return <FileTree />;
  if (panel.kind === 'copilot') return <CopilotSidebar />;
  if (panel.kind === 'ailog') return <AILogPanel docked />;
  if (panel.kind === 'trace') return <TracePanel docked />;
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

/** 计算 drop 插入位置：同一 dock 内按鼠标位置排序 */
function dropIndex(dockEl: HTMLElement, clientX: number, clientY: number, vertical: boolean): number {
  const tabsEl = dockEl.querySelector('.dock-tabs') as HTMLElement | null;
  if (!tabsEl) return 0;
  const children = Array.from(tabsEl.querySelectorAll('.dock-tab'));
  let idx = children.length;
  for (let i = 0; i < children.length; i++) {
    const r = children[i].getBoundingClientRect();
    const pos = vertical ? r.left + r.width / 2 : r.top + r.height / 2;
    const coord = vertical ? clientX : clientY;
    if (coord < pos) { idx = i; break; }
  }
  return idx;
}

/** 单个 Dock 容器：面板 tab 栏 + 激活面板内容 + 拖拽放置 + resize 把手 */
function Dock({ col }: { col: DockId }) {
  const state = useWorkspaceStore((s) => s.docks[col]);
  const draggingPanelId = useWorkspaceStore((s) => s.draggingPanelId);
  const hoverDock = useWorkspaceStore((s) => s.hoverDock);
  const movePanel = useWorkspaceStore((s) => s.movePanel);
  const closePanel = useWorkspaceStore((s) => s.closePanel);
  const setDragging = useWorkspaceStore((s) => s.setDragging);
  const setDockSize = useWorkspaceStore((s) => s.setDockSize);
  const dockRef = useRef<HTMLDivElement>(null);

  const panels = state.panels;
  const active = state.active ?? panels[0]?.id ?? null;
  const activePanel = panels.find((p) => p.id === active) ?? panels[0] ?? null;

  if (panels.length === 0) return null;

  const isVertical = col === 'left' || col === 'right';
  const style = isVertical ? { width: state.size } : { height: state.size };

  // resize 拖拽：记录初始位置与尺寸，移动时增量
  const resizeStart = useRef<{ startCoord: number; startSize: number; dir: 1 | -1 } | null>(null);
  const onResizeStart = (dir: 1 | -1) => (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStart.current = { startCoord: isVertical ? e.clientX : e.clientY, startSize: state.size, dir };
    const move = (ev: MouseEvent) => {
      if (!resizeStart.current) return;
      const delta = (isVertical ? ev.clientX : ev.clientY) - resizeStart.current.startCoord;
      const next = Math.max(140, Math.min(800, resizeStart.current.startSize + resizeStart.current.dir * delta));
      setDockSize(col, next);
    };
    const up = () => { resizeStart.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const pid = e.dataTransfer.getData('text/plain') || draggingPanelId;
    if (pid) {
      const idx = dockRef.current ? dropIndex(dockRef.current, e.clientX, e.clientY, isVertical) : undefined;
      movePanel(pid, col, idx);
    }
    setDragging(null, null);
  };

  return (
    <div className={'dock-shell-col'}>
      <div
        ref={dockRef}
        className={'dock dock-' + col + (hoverDock === col && draggingPanelId ? ' dock-hover' : '')}
        style={style}
        onDragOver={(e) => {
          if (!draggingPanelId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (hoverDock !== col) setDragging(draggingPanelId, col);
        }}
        onDragLeave={() => { if (hoverDock === col) setDragging(draggingPanelId, null); }}
        onDrop={handleDrop}
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
              <span className="dock-panel-drag-tip" title="按住拖动到任意停靠区">⠿</span>
              <button className="dock-panel-close" onClick={() => closePanel(activePanel.id)} title="关闭面板">×</button>
            </div>
            <div className="dock-panel-body">
              <PanelView panel={activePanel} />
            </div>
          </div>
        )}
      </div>
      {/* resize 拖把手：left/right dock 右侧边缘 */}
      {col === 'left' && <div className="dock-resize-h" onMouseDown={onResizeStart(1)} />}
      {col === 'right' && <div className="dock-resize-h" onMouseDown={onResizeStart(-1)} />}
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
      {docks.bottom.panels.length > 0 && (
        <div className="dock-bottom-row">
          <div className="dock-resize-v" onMouseDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startSize = docks.bottom.size;
            const move = (ev: MouseEvent) => {
              const next = Math.max(100, Math.min(500, startSize + (startY - ev.clientY)));
              useWorkspaceStore.getState().setDockSize('bottom', next);
            };
            const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }} />
          <Dock col="bottom" />
        </div>
      )}
    </div>
  );
}
