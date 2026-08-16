// ============================================================
// 全局大纲视图（Phase 1 认知基础）
// ------------------------------------------------------------
// 树形递归渲染任意深度大纲：新增子节点（kind 递进）、行内编辑标题、
// 状态循环切换、上移/下移排序、删除（级联）、关联文档（跳转）/时间线、
// 伏笔标记。数据操作全部走 worldStore 的 outline CRUD。
// ============================================================

import { useMemo, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useUIStore } from '../../store/uiStore';
import { treeify, type OutlineTreeNode } from './outlineOps';
import { scanForeshadow } from './foreshadowLedger';
import {
  OUTLINE_KIND_LABEL,
  OUTLINE_STATUS_LABEL,
  OUTLINE_KIND_ORDER,
  type OutlineNode,
  type OutlineKind,
  type OutlineStatus,
} from './types';

const STATUS_CYCLE: OutlineStatus[] = ['todo', 'drafting', 'done', 'paused'];

/** 子节点默认类型：弧→卷→章→场景→笔记 */
function childKind(kind: OutlineKind): OutlineKind {
  const i = OUTLINE_KIND_ORDER.indexOf(kind);
  return OUTLINE_KIND_ORDER[Math.min(i + 1, OUTLINE_KIND_ORDER.length - 1)];
}

function OutlineNodeItem({ node, depth }: { node: OutlineTreeNode; depth: number }) {
  const update = useWorldStore((s) => s.updateOutlineNode);
  const del = useWorldStore((s) => s.deleteOutlineNode);
  const move = useWorldStore((s) => s.moveOutlineNode);
  const add = useWorldStore((s) => s.addOutlineNode);
  const openTab = useUIStore((s) => s.openTab);
  const [showLedger, setShowLedger] = useState(false);
  const docs = useWorldStore((s) => (s.worldsData[s.current]?.docs ?? []));

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title);

  const isFirst = node.order === 0;

  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== node.title) update(node.id, { title: t });
    setEditing(false);
  };

  const moveUp = () => { if (!isFirst) move(node.id, node.parentId, node.order - 1); };
  const moveDown = () => { move(node.id, node.parentId, node.order + 1); };

  const cycleStatus = () => {
    const i = STATUS_CYCLE.indexOf(node.status);
    update(node.id, { status: STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length] });
  };

  const onDelete = () => {
    if (window.confirm(`删除「${node.title}」及其全部子节点？`)) del(node.id);
  };

  const cycleForeshadow = () => {
    const f = node.foreshadow;
    if (!f) update(node.id, { foreshadow: { setup: true, payoff: false } });
    else if (f.setup && !f.payoff) update(node.id, { foreshadow: { setup: true, payoff: true } });
    else if (f.setup && f.payoff) update(node.id, { foreshadow: undefined as any });
    else update(node.id, { foreshadow: { setup: true, payoff: false } });
  };

  return (
    <div className="ol-node">
      <div className={'ol-row' + (node.status === 'done' ? ' done' : '')} style={{ paddingLeft: 8 + depth * 18 }}>
        {editing ? (
          <input
            className="ol-title-input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitle(node.title); setEditing(false); } }}
          />
        ) : (
          <span className="ol-kind">{OUTLINE_KIND_LABEL[node.kind]}</span>
        )}
        {!editing && (
          <span className="ol-title" onDoubleClick={() => { setTitle(node.title); setEditing(true); }}>
            {node.title}
          </span>
        )}
        <span className={'ol-status st-' + node.status} onClick={cycleStatus} title="点击切换状态">
          {OUTLINE_STATUS_LABEL[node.status]}
        </span>
        <span className="ol-ops">
          <button className="ol-btn" title="新增子节点" onClick={() => add({ title: '新' + OUTLINE_KIND_LABEL[childKind(node.kind)], kind: childKind(node.kind), parentId: node.id })}>+</button>
          <button className="ol-btn" title="编辑标题" onClick={() => { setTitle(node.title); setEditing(true); }}>✎</button>
          <button
            className={'ol-btn fs-' + (node.foreshadow ? (node.foreshadow.setup && node.foreshadow.payoff ? 'paid' : 'open') : 'none')}
            title={node.foreshadow ? (node.foreshadow.setup && node.foreshadow.payoff ? '已回收伏笔（点击取消标记）' : '已埋设伏笔（点击标记回收）') : '伏笔标记：点击埋设'}
            onClick={cycleForeshadow}
          >
            {!node.foreshadow ? '🔘' : node.foreshadow.setup && node.foreshadow.payoff ? '✅' : '🔒'}
          </button>
          <button className="ol-btn" title="上移" disabled={isFirst} onClick={moveUp}>↑</button>
          <button className="ol-btn" title="下移" onClick={moveDown}>↓</button>
          <button className="ol-btn danger" title="删除（含子节点）" onClick={onDelete}>×</button>
        </span>
        {!editing && (
          <span className="ol-links">
            {node.docId && (
              <button
                className="ol-link"
                title="打开关联文档"
                onClick={() => {
                  const d = docs.find((x) => x.id === node.docId);
                  openTab({ title: d?.title ?? '文档', icon: 'doc', kind: 'doc', ref: node.docId! });
                }}
              >
                文
              </button>
            )}
            {node.summary && <span className="ol-summary" title={node.summary}>{node.summary}</span>}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="ol-children">
          {node.children.map((c) => <OutlineNodeItem key={c.id} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

export function OutlineView() {
  const outline = useWorldStore((s) => (s.worldsData[s.current]?.outline ?? []));
  const docs = useWorldStore((s) => (s.worldsData[s.current]?.docs ?? []));
  const add = useWorldStore((s) => s.addOutlineNode);
  const update = useWorldStore((s) => s.updateOutlineNode);
  const openTab = useUIStore((s) => s.openTab);
  const [showLedger, setShowLedger] = useState(false);

  const tree = useMemo(() => treeify(outline), [outline]);
  const ledger = useMemo(() => scanForeshadow(outline), [outline]);

  return (
    <div className="outline-view">
      <div className="outline-head">
        <h3>全局大纲</h3>
        <span className="tip">卷 → 章 → 场景，任意嵌套；双击标题编辑；点状态切换待写/进行中/已完成/暂停</span>
        <button className="mode-btn active" onClick={() => add({ title: '新卷', kind: 'volume', parentId: null })}>
          + 新建顶层节点
        </button>
        <button className="mode-btn" onClick={() => setShowLedger((v) => !v)} title="伏笔账本：已埋设未回收的伏笔">
          伏笔{ledger.counts.open > 0 ? `（${ledger.counts.open}）` : ''}
        </button>
      </div>

      {showLedger && (
        <div className="ol-ledger">
          {ledger.counts.open === 0 && ledger.counts.orphan === 0 ? (
            <div className="tip">账本干净：大纲中没有未回收的伏笔。</div>
          ) : (
            <>
              {ledger.counts.open > 0 && (
                <>
                  <div className="ol-ledger-title">🔒 未回收伏笔（{ledger.counts.open}）</div>
                  {ledger.open.map((n) => (
                    <div key={n.id} className="ol-ledger-item">
                      <span className="ol-ledger-node">{n.title}</span>
                      <span className="tip">{OUTLINE_STATUS_LABEL[n.status]}</span>
                      {n.entityIds && n.entityIds.length > 0 && <span className="tip">关联实体 {n.entityIds.length}</span>}
                      <button className="ol-btn" onClick={() => update(n.id, { foreshadow: { setup: true, payoff: true } })} title="标记已回收">✅ 回收</button>
                    </div>
                  ))}
                </>
              )}
              {ledger.counts.orphan > 0 && (
                <>
                  <div className="ol-ledger-title warn">⚠️ 孤儿回收标记（{ledger.counts.orphan}）</div>
                  {ledger.orphan.map((n) => (
                    <div key={n.id} className="ol-ledger-item">
                      <span className="ol-ledger-node">{n.title}</span>
                      <span className="tip">标记了回收但未埋设</span>
                      <button className="ol-btn" onClick={() => update(n.id, { foreshadow: { setup: true, payoff: true } })} title="补为已埋设已回收">✅ 补埋设</button>
                      <button className="ol-btn" onClick={() => update(n.id, { foreshadow: undefined as any })} title="清除标记">清除</button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
      <div className="outline-tree">
        {tree.length === 0 ? (
          <div className="outline-empty">
            <p>还没有大纲。点上方「新建顶层节点」开始搭建章节结构，Agent 将能理解并辅助推进。</p>
            <div className="tip">示例：先建「卷」再在卷下建「章」，章下建「场景」；每个节点可关联一篇正文文档或一条时间线。</div>
          </div>
        ) : (
          tree.map((n) => <OutlineNodeItem key={n.id} node={n} depth={0} />)
        )}
      </div>
      {docs.length > 0 && (
        <div className="outline-assoc">
          <span className="tip">关联文档（在节点操作后选）：</span>
          <select
            className="ol-select"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              // 关联到第一个根节点（简化入口）；更精确的关联在节点行内
              if (tree[0]) update(tree[0].id, { docId: id });
              e.target.value = '';
            }}
          >
            <option value="">关联到首个顶层节点…</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
