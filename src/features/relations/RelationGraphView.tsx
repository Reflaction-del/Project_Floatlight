import { useState, useMemo, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { useWorldStore } from '../../store/worldStore';
import type { ClueBoardSettings } from '../../store/worldStore';
import { useUIStore } from '../../store/uiStore';
import { useWorldviewStore } from '../../store/worldviewStore';
import {
  EntityType, WikiEntity, RelationType, RELATION_LABEL, ENTITY_LABEL,
} from '../../types';
import type { WikiRelation, TabItem } from '../../types';

/** 五类实体 → 颜色（与线索板 TYPE_COLORS 风格一致） */
const ENTITY_COLORS: Record<EntityType, string> = {
  character: '#8b5cf6',
  faction: '#ef4444',
  location: '#3b82f6',
  event: '#f59e0b',
  rule: '#10b981',
};

const DEFAULT_NODE_SIZE = 56;

const CANVAS_W = 2000;
const CANVAS_H = 1000;
const CENTER = { x: CANVAS_W / 2, y: CANVAS_H / 2 };

const RELATION_COLORS: Record<RelationType, string> = {
  belongs: '#64748b',
  enemy: '#ef4444',
  occurs: '#f59e0b',
  causal: '#8b5cf6',
  kin: '#10b981',
  custom: '#06b6d4',
};

function luminance(hex: string) {
  const rgb = hex.replace('#', '').match(/.{2}/g)?.map((x) => parseInt(x, 16) / 255) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function readableTextColor(bg?: string, fallbackDark = '#1f2937') {
  if (!bg || bg.startsWith('var(')) return '#fff';
  return luminance(bg) > 0.55 ? fallbackDark : '#fff';
}

interface GNode {
  id: string;
  label: string;
  type: EntityType;
  x: number; y: number; vx: number; vy: number;
  color?: string; size?: number; shape?: 'circle' | 'square' | 'diamond'; fixed?: boolean;
}

/** 根据实体 id 生成稳定的初始坐标（避免每次加载都随机抖动） */
function seedPos(id: string, i: number): { x: number; y: number } {
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) % 997;
  const r = 260 + (i % 7) * 34;
  const angle = ((h % 360) / 360) * Math.PI * 2;
  return { x: CENTER.x + Math.cos(angle) * r, y: CENTER.y + Math.sin(angle) * r };
}

interface RelationGraphCanvasRef {
  resetZoom: () => void;
  undo: () => boolean;
  canUndo: boolean;
}

interface RelationGraphCanvasProps {
  entities: WikiEntity[];
  relations: WikiRelation[];
  visibleIds: Set<string>;
  keyNodeIds: Set<string>;
  activeRels: RelationType[];
  connectMode: boolean;
  relType: RelationType;
  firstNode: string | null;
  setFirstNode: (id: string | null) => void;
  addRelation: (source: string, target: string, type: RelationType) => void;
  removeRelation: (id: string) => void;
  openTab: (tab: Omit<TabItem, 'id'>) => void;
  selectedNode: string | null;
  setSelectedNode: (id: string | null) => void;
  onDeleteEntity: (id: string) => void;
  clueBoard: ClueBoardSettings;
  onHistoryChange?: (canUndo: boolean) => void;
}

/** SVG 画布 + 力导向物理模拟。
 * 单独拆成子组件，避免 requestAnimationFrame 每帧 setState 导致父组件（工具栏/输入框）高频重渲染。 */
const RelationGraphCanvas = forwardRef<RelationGraphCanvasRef, RelationGraphCanvasProps>(function RelationGraphCanvas({
  entities, relations, visibleIds, keyNodeIds, activeRels, connectMode, relType, firstNode, setFirstNode,
  addRelation, removeRelation, openTab, selectedNode, setSelectedNode, onDeleteEntity, clueBoard, onHistoryChange,
}, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [tick, setTick] = useState(0);
  const [vb, setVb] = useState({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  const [dragNode, setDragNode] = useState<string | null>(null);
  const dragMoved = useRef(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [nodeHistory, setNodeHistory] = useState<GNode[][]>([]);

  useImperativeHandle(ref, () => ({
    resetZoom: () => setVb({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }),
    undo: () => {
      if (nodeHistory.length === 0) return false;
      const prev = nodeHistory[nodeHistory.length - 1];
      setNodes(prev);
      setNodeHistory((h) => h.slice(0, -1));
      onHistoryChange?.(nodeHistory.length - 1 > 0);
      return true;
    },
    canUndo: nodeHistory.length > 0,
  }), [nodeHistory]);

  // 初始化 / 增量同步节点（实体增删时保留已有坐标）
  useEffect(() => {
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const next: GNode[] = entities.map((e, i) => {
        const old = prevMap.get(e.id);
        if (old) return old;
        const p = seedPos(e.id, i);
        return {
          id: e.id, label: e.name || '未命名', type: e.type,
          x: p.x, y: p.y, vx: 0, vy: 0,
        };
      });
      return next;
    });
  }, [entities]);

  const edgeKeys = useMemo(() => relations.map((r) => `${r.source}::${r.target}::${r.type}`), [relations]);

  // 物理模拟（力导向）
  useEffect(() => {
    let raf = 0;
    const step = () => {
      setNodes((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.map((n) => ({ ...n }));
        const center = { x: CENTER.x, y: CENTER.y };
        const centerPull = 0.0015;
        for (const n of next) {
          if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
          n.vx += (center.x - n.x) * centerPull;
          n.vy += (center.y - n.y) * centerPull;
        }
        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const a = next[i], b = next[j];
            if (a.fixed && b.fixed) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist2 = Math.max(dx * dx + dy * dy, 100);
            const force = 9000 / dist2;
            const dist = Math.sqrt(dist2);
            const fx = (dx / dist) * force, fy = (dy / dist) * force;
            if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
            if (!b.fixed) { b.vx += fx; b.vy += fy; }
          }
        }
        for (const e of edgeKeys) {
          const [a, b] = e.split('::');
          const na = next.find((n) => n.id === a);
          const nb = next.find((n) => n.id === b);
          if (!na || !nb) continue;
          const dx = nb.x - na.x, dy = nb.y - na.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const target = 200;
          const force = (dist - target) * 0.006;
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          if (!na.fixed) { na.vx += fx; na.vy += fy; }
          if (!nb.fixed) { nb.vx -= fx; nb.vy -= fy; }
        }
        for (const n of next) {
          if (n.x < 20) n.vx += (20 - n.x) * 0.05;
          if (n.x > CANVAS_W - 20) n.vx += (CANVAS_W - 20 - n.x) * 0.05;
          if (n.y < 20) n.vy += (20 - n.y) * 0.05;
          if (n.y > CANVAS_H - 20) n.vy += (CANVAS_H - 20 - n.y) * 0.05;
          n.vx *= 0.85; n.vy *= 0.85;
          n.x += n.vx * 0.5; n.y += n.vy * 0.5;
        }
        return next;
      });
      setTick((t) => t + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [edgeKeys.length, entities.length]);

  // 缩放 / 平移
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * vb.w + vb.x;
    const cy = ((e.clientY - rect.top) / rect.height) * vb.h + vb.y;
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    const newW = Math.max(CANVAS_W * 0.25, Math.min(CANVAS_W * 4, vb.w * factor));
    const newH = Math.max(CANVAS_H * 0.25, Math.min(CANVAS_H * 4, vb.h * factor));
    setVb({ x: cx - (cx - vb.x) * (newW / vb.w), y: cy - (cy - vb.y) * (newH / vb.h), w: newW, h: newH });
  };
  const panRef = useRef<{ x: number; y: number; vb: typeof vb } | null>(null);
  const onPanDown = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    panRef.current = { x: e.clientX, y: e.clientY, vb: { ...vb } };
  };
  const onPanMove = (e: React.MouseEvent) => {
    if (!panRef.current) return;
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = (e.clientX - panRef.current.x) * (panRef.current.vb.w / rect.width);
    const dy = (e.clientY - panRef.current.y) * (panRef.current.vb.h / rect.height);
    setVb({ ...panRef.current.vb, x: panRef.current.vb.x - dx, y: panRef.current.vb.y - dy });
  };
  const onPanUp = () => { panRef.current = null; };

  const pushNodeHistory = useCallback(() => {
    setNodeHistory((prev) => {
      const snap = nodes.map((n) => ({ ...n }));
      const next = [...prev, snap];
      if (next.length > 20) next.shift();
      return next;
    });
    onHistoryChange?.(true);
  }, [nodes, onHistoryChange]);

  const onNodeMouseDown = (e: React.MouseEvent, id: string) => {
    if (connectMode) {
      if (!firstNode) { setFirstNode(id); return; }
      if (firstNode !== id) {
        addRelation(firstNode, id, relType);
        setFirstNode(null);
      }
      return;
    }
    e.preventDefault();
    setSelectedNode(id);
    setDragNode(id);
    dragMoved.current = false;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    setNodes((p) => p.map((n) => n.id === id ? { ...n, fixed: true } : n));
    const onMove = (m: MouseEvent) => {
      const start = dragStartPos.current;
      if (start && !dragMoved.current) {
        const d = Math.hypot(m.clientX - start.x, m.clientY - start.y);
        if (d > 3) dragMoved.current = true;
      }
      const rect = svgRef.current!.getBoundingClientRect();
      const v = svgRef.current!.viewBox.baseVal;
      const x = ((m.clientX - rect.left) / rect.width) * v.width + vb.x;
      const y = ((m.clientY - rect.top) / rect.height) * v.height + vb.y;
      setNodes((p) => p.map((n) => n.id === id ? { ...n, x, y, vx: 0, vy: 0 } : n));
    };
    const onUp = () => {
      setDragNode(null);
      setNodes((p) => p.map((n) => n.id === id ? { ...n, fixed: false } : n));
      if (dragMoved.current) pushNodeHistory();
      dragMoved.current = false;
      dragStartPos.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onNodeClick = (n: GNode) => {
    if (connectMode) return;
    if (dragMoved.current) { dragMoved.current = false; return; }
    openTab({ title: n.label, icon: n.type, kind: 'entity', ref: n.id });
  };

  const onNodeContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    // 钳制到视口内，避免菜单溢出被裁剪或漂移
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 340);
    setContextMenu({ x: Math.max(4, x), y: Math.max(4, y), nodeId: id });
  };

  const setNodeColor = (id: string, color: string) => { pushNodeHistory(); setNodes((p) => p.map((n) => n.id === id ? { ...n, color } : n)); };
  const setNodeSize = (id: string, size: number) => { pushNodeHistory(); setNodes((p) => p.map((n) => n.id === id ? { ...n, size: Math.max(24, Math.min(96, size)) } : n)); };
  const setNodeShape = (id: string, shape: 'circle' | 'square' | 'diamond') => { pushNodeHistory(); setNodes((p) => p.map((n) => n.id === id ? { ...n, shape } : n)); };
  const removeNode = (id: string) => {
    onDeleteEntity(id);
    setContextMenu(null);
  };

  const renderNodeShape = (n: GNode, fill: string, isKeyNode: boolean) => {
    const size = n.size ?? DEFAULT_NODE_SIZE;
    const half = size / 2;
    let stroke = 'var(--border)';
    let strokeWidth = 1.5;
    if (selectedNode === n.id) {
      stroke = 'var(--accent)';
      strokeWidth = 3;
    } else if (isKeyNode) {
      stroke = '#f59e0b';
      strokeWidth = 3;
    }
    if (n.shape === 'square') {
      return <rect x={-half} y={-half} width={size} height={size} rx="6" fill={fill} opacity="0.9" stroke={stroke} strokeWidth={strokeWidth} />;
    } else if (n.shape === 'diamond') {
      return <polygon points={`0,${-half} ${half},0 0,${half} ${-half},0`} fill={fill} opacity="0.9" stroke={stroke} strokeWidth={strokeWidth} />;
    }
    return <circle r={half} fill={fill} opacity="0.9" stroke={stroke} strokeWidth={strokeWidth} />;
  };

  const bgImageStyle = useMemo(() => {
    if (!clueBoard.backgroundImage?.dataUrl) return undefined;
    const fit = clueBoard.backgroundFit ?? 'cover';
    const scale = (clueBoard.backgroundScale ?? 100) / 100;
    let backgroundSize: string = 'cover';
    if (fit === 'contain') backgroundSize = 'contain';
    else if (fit === 'stretch') backgroundSize = '100% 100%';
    else if (fit === 'tile') backgroundSize = 'auto';
    else if (fit === 'center') backgroundSize = 'auto';
    return {
      backgroundImage: `url(${clueBoard.backgroundImage.dataUrl})`,
      backgroundSize,
      backgroundPosition: 'center',
      backgroundRepeat: fit === 'tile' ? 'repeat' : 'no-repeat',
      inset: 0,
      position: 'absolute' as const,
      opacity: 0.35,
      pointerEvents: 'none' as const,
      transform: `scale(${scale})`,
    };
  }, [clueBoard.backgroundImage, clueBoard.backgroundFit, clueBoard.backgroundScale]);

  const filtered = useMemo(() => nodes.filter((n) => visibleIds.has(n.id)), [nodes, visibleIds, tick]);

  const currentMenuNode = contextMenu ? nodes.find((n) => n.id === contextMenu.nodeId) : null;

  return (
    <>
      <div className="cb-svg-wrap" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {bgImageStyle && <div style={bgImageStyle} />}
        {entities.length === 0 ? (
          <div className="placeholder-view" style={{ flex: 1 }}>
            <div className="big">关系</div>
            <div>当前世界还没有任何实体，前往「实体库」创建后这里会自动成图</div>
          </div>
        ) : (
          <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" onWheel={onWheel} onMouseDown={onPanDown} onMouseMove={onPanMove} onMouseUp={onPanUp} onMouseLeave={onPanUp}>
            {edgeKeys.map((c, i) => {
              const [a, b, t] = c.split('::');
              if (!activeRels.includes(t as RelationType)) return null;
              const na = nodes.find((n) => n.id === a);
              const nb = nodes.find((n) => n.id === b);
              if (!na || !nb || !visibleIds.has(na.id) || !visibleIds.has(nb.id)) return null;
              const mx = (na.x + nb.x) / 2, my = (na.y + nb.y) / 2;
              const color = RELATION_COLORS[t as RelationType] ?? 'var(--border)';
              const relId = relations.find((r) => r.source === a && r.target === b && r.type === t)?.id;
              return (
                <g key={i}>
                  <line x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke={color} strokeWidth="2" opacity="0.75" />
                  <g
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); if (relId && confirm(`删除关系「${RELATION_LABEL[t as RelationType]}」？`)) removeRelation(relId); }}
                  >
                    <rect x={mx - 30} y={my - 11} width={60} height={22} rx="11" fill="var(--bg-sunken)" stroke="var(--border)" />
                    <text x={mx} y={my + 4} textAnchor="middle" fontSize="11" fill="var(--fg-muted)" style={{ pointerEvents: 'none' }}>{RELATION_LABEL[t as RelationType]}</text>
                  </g>
                </g>
              );
            })}
            {filtered.map((n) => {
              const color = (n.color ?? ENTITY_COLORS[n.type]) ?? 'var(--fg-muted)';
              const textColor = readableTextColor(color);
              const size = n.size ?? DEFAULT_NODE_SIZE;
              const isKeyNode = keyNodeIds.has(n.id);
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: 'grab' }} onMouseDown={(e) => onNodeMouseDown(e, n.id)} onClick={() => onNodeClick(n)} onContextMenu={(e) => onNodeContextMenu(e, n.id)}>
                  {renderNodeShape(n, color, isKeyNode)}
                  <text y={size / 2 + 18} textAnchor="middle" fontSize="13" fontWeight="700" fill={textColor} style={{ pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.45)' }}>{n.label.slice(0, 12)}</text>
                </g>
              );
            })}
            {firstNode && <text x={20} y={620} fontSize="13" fill="var(--accent)">已选源实体，请点选目标实体（{RELATION_LABEL[relType]}）</text>}
          </svg>
        )}
      </div>
      {contextMenu && createPortal(
        <>
          <div className="ctx-backdrop" onMouseDown={() => setContextMenu(null)} />
          <div className="ctx-menu" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="ctx-section">颜色</div>
            <div style={{ display: 'flex', gap: 4, padding: 4, flexWrap: 'wrap' }}>
              {['#3b82f6', '#8b5cf6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#6b7280'].map((c) => (
                <button key={c} onClick={() => { setNodeColor(contextMenu.nodeId, c); setContextMenu(null); }} style={{ background: c, width: 20, height: 20, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
              ))}
              <input type="color" defaultValue={currentMenuNode?.color ?? '#3b82f6'} onChange={(e) => setNodeColor(contextMenu.nodeId, e.target.value)} style={{ width: 28, height: 24, border: 'none', background: 'none', cursor: 'pointer' }} />
            </div>
            <div className="ctx-sep" />
            <div className="ctx-section">大小（{currentMenuNode?.size ?? DEFAULT_NODE_SIZE}px）</div>
            <div style={{ display: 'flex', gap: 4, padding: 4 }}>
              <button className="ctx-item" onClick={() => { setNodeSize(contextMenu.nodeId, 40); setContextMenu(null); }}>小 40</button>
              <button className="ctx-item" onClick={() => { setNodeSize(contextMenu.nodeId, DEFAULT_NODE_SIZE); setContextMenu(null); }}>中 {DEFAULT_NODE_SIZE}</button>
              <button className="ctx-item" onClick={() => { setNodeSize(contextMenu.nodeId, 76); setContextMenu(null); }}>大 76</button>
            </div>
            <div className="ctx-sep" />
            <div className="ctx-section">形状</div>
            <div style={{ display: 'flex', gap: 4, padding: 4 }}>
              {(['circle', 'square', 'diamond'] as const).map((sh) => (
                <button key={sh} className="ctx-item" onClick={() => { setNodeShape(contextMenu.nodeId, sh); setContextMenu(null); }}>{sh === 'circle' ? '圆形' : sh === 'square' ? '方形' : '菱形'}</button>
              ))}
            </div>
            <div className="ctx-sep" />
            <button className="ctx-item danger" onClick={() => removeNode(contextMenu.nodeId)}>删除实体</button>
          </div>
        </>,
        document.body
      )}
    </>
  );
});

export function RelationGraphView() {
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const relations = useWorldStore((s) => s.worldsData[s.current]?.relations ?? []);
  const addRelation = useWorldStore((s) => s.addRelation);
  const removeRelation = useWorldStore((s) => s.removeRelation);
  const clearRelations = useWorldStore((s) => s.clearRelations);
  const deleteEntity = useWorldStore((s) => s.deleteEntity);
  const openTab = useUIStore((s) => s.openTab);
  const worldview = useWorldviewStore();
  const clueBoard = useWorldStore((s) => s.worldsData[s.current]?.clueBoard ?? {});
  const setClueBoardBackground = useWorldStore((s) => s.setClueBoardBackground);
  const removeClueBoardBackground = useWorldStore((s) => s.removeClueBoardBackground);
  const setClueBoardBackgroundFit = useWorldStore((s) => s.setClueBoardBackgroundFit);
  const setClueBoardBackgroundScale = useWorldStore((s) => s.setClueBoardBackgroundScale);
  const canvasRef = useRef<RelationGraphCanvasRef>(null);
  const [canUndo, setCanUndo] = useState(false);

  const [filter, setFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterTypes, setFilterTypes] = useState<Record<EntityType, boolean>>({
    character: true, faction: true, location: true, event: true, rule: true,
  });
  const [filterRels, setFilterRels] = useState<Record<RelationType, boolean>>({
    belongs: true, enemy: true, occurs: true, causal: true, kin: true, custom: true,
  });
  const [filterRegex, setFilterRegex] = useState('');
  const [filterRegexError, setFilterRegexError] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [relType, setRelType] = useState<RelationType>('belongs');
  const [firstNode, setFirstNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showBgPanel, setShowBgPanel] = useState(false);
  const [bgFit, setBgFit] = useState<NonNullable<ClueBoardSettings['backgroundFit']>>(clueBoard.backgroundFit ?? 'cover');
  const [bgScale, setBgScale] = useState<number>(clueBoard.backgroundScale ?? 100);
  const [showRelList, setShowRelList] = useState(true);

  const activeTypes = useMemo(() => (Object.keys(filterTypes) as EntityType[]).filter((t) => filterTypes[t]), [filterTypes]);
  const activeRels = useMemo(() => (Object.keys(filterRels) as RelationType[]).filter((r) => filterRels[r]), [filterRels]);

  const filteredResult = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let re: RegExp | null = null;
    if (filterRegex.trim()) {
      try { re = new RegExp(filterRegex.trim(), 'i'); setFilterRegexError(''); } catch (e) { setFilterRegexError('正则表达式无效'); }
    } else { setFilterRegexError(''); }

    // 关键节点：匹配搜索或正则的节点（用于高亮）
    const keyNodeIds = new Set<string>();
    // 类型匹配节点：显示选中类型的全部节点
    const typeMatchedIds = new Set<string>();
    entities.forEach((e) => {
      const label = e.name || '未命名';
      const matchesSearch = !q || label.toLowerCase().includes(q) || e.type.toLowerCase().includes(q);
      const matchesRegex = !re || re.test(label)  || re.test(e.type);
      if (matchesSearch || matchesRegex) keyNodeIds.add(e.id);
      if (activeTypes.length === 0 || activeTypes.includes(e.type)) typeMatchedIds.add(e.id);
    });

    // 关系匹配节点：只显示参与选中关系的节点
    const activeRelsLimited = activeRels.length > 0 && activeRels.length < (Object.keys(RELATION_LABEL) as RelationType[]).length;
    const relMatchedIds = new Set<string>();
    if (activeRelsLimited) {
      relations.forEach((r) => {
        if (activeRels.includes(r.type)) {
          relMatchedIds.add(r.source);
          relMatchedIds.add(r.target);
        }
      });
    } else {
      entities.forEach((e) => relMatchedIds.add(e.id));
    }

    // 可见节点 = 类型匹配 ∩ 关系匹配
    const visibleNodes = new Set<string>();
    entities.forEach((e) => {
      if (typeMatchedIds.has(e.id) && relMatchedIds.has(e.id)) {
        visibleNodes.add(e.id);
      }
    });

    return { visibleNodes, keyNodeIds };
  }, [entities, filter, activeTypes, activeRels, filterRegex, relations]);

  const filteredIds = filteredResult.visibleNodes;
  const keyNodeIds = filteredResult.keyNodeIds;
  const filteredCount = filteredIds.size;

  const resetZoom = useCallback(() => canvasRef.current?.resetZoom(), []);

  const onSelectBgImage = async () => {
    const dataUrl = await window.api?.openImage?.();
    if (!dataUrl) return;
    const id = `cbg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setClueBoardBackground({ id, dataUrl });
  };

  const onApplyBgFit = (fit: NonNullable<ClueBoardSettings['backgroundFit']>) => {
    setBgFit(fit);
    setClueBoardBackgroundFit(fit);
  };

  const onApplyBgScale = (scale: number) => {
    setBgScale(scale);
    setClueBoardBackgroundScale(scale);
  };

  const entityName = (id: string) => entities.find((e) => e.id === id)?.name || '未知实体';

  return (
    <div className="editor-scroll">
      <div className="editor-wrap relation-graph-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="cb-search-row">
          <h2 style={{ margin: 0 }}>线索板 · {worldview.current}</h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤实体（名称/类型）"
            className="drafts-search"
            style={{ maxWidth: 280 }}
          />
          <button className={'mode-btn ' + (connectMode ? 'active' : '')} onClick={() => { setConnectMode((c) => !c); setFirstNode(null); }}>
            {connectMode ? '退出连线' : '连线模式'}
          </button>
          {connectMode && (
            <select className="mode-btn" value={relType} onChange={(e) => setRelType(e.target.value as RelationType)} title="连线关系类型">
              {(Object.keys(RELATION_LABEL) as RelationType[]).map((t) => (
                <option key={t} value={t}>{RELATION_LABEL[t]}</option>
              ))}
            </select>
          )}
          <button className="mode-btn" onClick={() => setShowFilters((v) => !v)}>{showFilters ? '收起筛选' : '筛选'}</button>
          <button className="mode-btn" onClick={() => setShowRelList((v) => !v)}>{showRelList ? '隐藏关系列表' : '显示关系列表'}</button>
          {relations.length > 0 && <button className="mode-btn" onClick={() => { if (confirm('确认清空全部实体关系？')) clearRelations(); }}>清空关系</button>}
          <button className="mode-btn" onClick={() => setShowBgPanel((v) => !v)}>{showBgPanel ? '收起背景' : '背景'}</button>
          <button className="mode-btn" onClick={resetZoom} title="重置视图到 100%">⟲ 重置视图</button>
          <button className="mode-btn" onClick={() => canvasRef.current?.undo()} disabled={!canUndo} title="撤销上一步（节点移动 / 外观调整）">↶ 撤销</button>
          <span className="tip" title="Ctrl+滚轮缩放画布，按住中键拖动平移">Ctrl+滚轮 · 中键平移</span>
          <span className="tip">共 {entities.length} 实体 · {relations.length} 关系</span>
        </div>
        <p className="tip">
          {entities.length === 0
            ? '还没有实体，请从 实体库 新建六类实体。'
            : '连线模式：先点选源实体，再点选目标实体，即用上方类型建立关系。点击节点打开实体详情；右键自定义外观或删除实体。'}
        </p>
        {showFilters && (
          <div className="cb-filter-panel">
            <div className="cb-filter-group">
              <span className="cb-filter-label">节点类型</span>
              <div className="cb-filter-chips">
                {(Object.keys(ENTITY_COLORS) as EntityType[]).map((t) => (
                  <label key={t} className="cb-filter-chip" title={ENTITY_LABEL[t]}>
                    <input
                      type="checkbox"
                      checked={filterTypes[t]}
                      onChange={(e) => setFilterTypes((prev) => ({ ...prev, [t]: e.target.checked }))}
                    />
                    <span style={{ background: ENTITY_COLORS[t] }} />
                    {ENTITY_LABEL[t]}
                  </label>
                ))}
              </div>
            </div>
            <div className="cb-filter-group">
              <span className="cb-filter-label">关系类型</span>
              <div className="cb-filter-chips">
                {(Object.keys(RELATION_COLORS) as RelationType[]).map((r) => (
                  <label key={r} className="cb-filter-chip" title={RELATION_LABEL[r]}>
                    <input
                      type="checkbox"
                      checked={filterRels[r]}
                      onChange={(e) => setFilterRels((prev) => ({ ...prev, [r]: e.target.checked }))}
                    />
                    <span style={{ background: RELATION_COLORS[r] }} />
                    {RELATION_LABEL[r]}
                  </label>
                ))}
              </div>
            </div>
            <div className="cb-filter-group">
              <span className="cb-filter-label">名称正则</span>
              <input
                value={filterRegex}
                onChange={(e) => setFilterRegex(e.target.value)}
                placeholder="如：^林 或 守.*人"
                className="cb-filter-regex"
              />
              {filterRegexError && <span className="cb-filter-error">{filterRegexError}</span>}
            </div>
            <div className="cb-filter-row">
              <span className="tip">已筛选 {filteredCount} / {entities.length} 节点</span>
              <button className="mode-btn" onClick={() => { setFilterTypes({ character: true, faction: true, location: true, event: true, rule: true }); setFilterRels({ belongs: true, enemy: true, occurs: true, causal: true, kin: true, custom: true }); setFilterRegex(''); setFilter(''); }}>重置筛选</button>
            </div>
          </div>
        )}
        <div className="rg-layout" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <RelationGraphCanvas
            ref={canvasRef}
            entities={entities}
            relations={relations}
            visibleIds={filteredIds}
            keyNodeIds={keyNodeIds}
            activeRels={activeRels}
            connectMode={connectMode}
            relType={relType}
            firstNode={firstNode}
            setFirstNode={setFirstNode}
            addRelation={addRelation}
            removeRelation={removeRelation}
            openTab={openTab}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            onDeleteEntity={deleteEntity}
            clueBoard={clueBoard}
            onHistoryChange={setCanUndo}
          />
          {showRelList && (
            <div className="rg-rel-list" style={{ width: 220, flex: '0 0 220px' }}>
              <div className="rg-rel-head">关系列表（{relations.length}）</div>
              {relations.length === 0 ? (
                <div className="tip" style={{ padding: 12 }}>暂无关系。开启连线模式建立实体间关系。</div>
              ) : (
                relations.map((r) => (
                  <div key={r.id} className="rg-rel-item" onDoubleClick={() => openTab({ title: entityName(r.source), icon: '', kind: 'entity', ref: r.source })}>
                    <div className="rg-rel-text">
                      <span>{entityName(r.source)}</span>
                      <span className="rg-rel-type" style={{ color: RELATION_COLORS[r.type] }}>{RELATION_LABEL[r.type]}</span>
                      <span>{entityName(r.target)}</span>
                    </div>
                    <button className="rg-rel-del" title="删除关系" onClick={() => removeRelation(r.id)}>×</button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        {showBgPanel && (
          <div className="cb-bg-panel">
            <div className="cb-bg-head">线索板背景</div>
            <div className="cb-bg-row">
              <span className="cb-filter-label">图片</span>
              {clueBoard.backgroundImage ? (
                <div className="cb-bg-preview">
                  <img src={clueBoard.backgroundImage.dataUrl} alt="背景预览" />
                  <button className="mode-btn danger" onClick={() => removeClueBoardBackground()}>移除</button>
                </div>
              ) : (
                <button className="mode-btn active" onClick={onSelectBgImage}>选择本地图片</button>
              )}
            </div>
            <div className="cb-bg-row">
              <span className="cb-filter-label">填充方式</span>
              <select className="mode-btn" value={bgFit} onChange={(e) => onApplyBgFit(e.target.value as NonNullable<ClueBoardSettings['backgroundFit']>)}>
                <option value="cover">覆盖（cover）</option>
                <option value="contain">适应（contain）</option>
                <option value="stretch">拉伸（stretch）</option>
                <option value="tile">平铺（tile）</option>
                <option value="center">居中（center）</option>
              </select>
            </div>
            <div className="cb-bg-row">
              <span className="cb-filter-label">缩放比例</span>
              <input
                type="range"
                min={25}
                max={200}
                value={bgScale}
                onChange={(e) => onApplyBgScale(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span className="tip" style={{ width: 50, textAlign: 'right' }}>{bgScale}%</span>
            </div>
            <button className="mode-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowBgPanel(false)}>关闭</button>
          </div>
        )}
        {connectMode && (
          <div className="cb-connect-intro" style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)' }}>
            连线模式开启：先点源实体，再点目标实体（关系类型：{RELATION_LABEL[relType]}）
            <button className="mode-btn" style={{ margin: '0 0 0 8px' }} onClick={() => { setConnectMode(false); setFirstNode(null); }}>取消</button>
          </div>
        )}
      </div>
    </div>
  );
}
