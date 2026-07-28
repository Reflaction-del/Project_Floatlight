import { useRef, useState, useEffect, useMemo } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { usePromptStore } from '../../store/promptStore';
import { useUIStore } from '../../store/uiStore';
import type { TimelineUnit, TimelineEvent } from '../../types';

const fmtYear = (y: number) => (y >= 0 ? `纪元 ${y}` : `前 ${-y}`);

const UNIT_LABEL: Record<TimelineUnit, string> = {
  year: '年份', month: '月份', day: '日期', custom: '自定义',
};

export function TimelineView({ timelineId }: { timelineId?: string }) {
  const timelines = useWorldStore((s) => s.worldsData[s.current]?.timelines ?? []);
  const activeTimelineId = useWorldStore((s) => s.worldsData[s.current]?.activeTimelineId ?? '');
  const setActiveTimeline = useWorldStore((s) => s.setActiveTimeline);
  const addTimeline = useWorldStore((s) => s.addTimeline);
  const addTimelineEvent = useWorldStore((s) => s.addTimelineEvent);
  const updateTimelineEvent = useWorldStore((s) => s.updateTimelineEvent);
  const deleteTimelineEvent = useWorldStore((s) => s.deleteTimelineEvent);
  const setTimelineUnit = useWorldStore((s) => s.setTimelineUnit);
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const openTab = useUIStore((s) => s.openTab);
  const prompt = usePromptStore((s) => s.open);

  const tid = timelineId ?? activeTimelineId;
  const tl = timelines.find((t) => t.id === tid) ?? timelines[0];
  if (!tl) return null;
  const unit = tl.unit ?? 'year';

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); const t = setTimeout(() => document.addEventListener('mousedown', close), 0); return () => { clearTimeout(t); document.removeEventListener('mousedown', close); }; }, [menu]);
  const [zoom, setZoom] = useState(1);
  const axisRef = useRef<HTMLDivElement>(null);

  // 可见年份范围（Ctrl+滚轮调整 lo/hi 实现缩放）
  const baseYears = tl.events.map((e) => e.year);
  const baseMin = baseYears.length ? Math.min(...baseYears) : 0;
  const baseMax = baseYears.length ? Math.max(...baseYears) : 50;
  const pad = Math.max(2, Math.round((baseMax - baseMin) * 0.1));
  const dataLo = baseMin - pad;
  const dataHi = baseMax + pad;
  const [view, setView] = useState<{ lo: number; hi: number }>({ lo: dataLo, hi: dataHi });

  // 首次加载/切换时间轴时重置 view
  useEffect(() => { setView({ lo: dataLo, hi: dataHi }); setZoom(1); }, [tl.id]);

  const lo = view.lo;
  const hi = view.hi;
  const pos = (y: number) => ((y - lo) / (hi - lo)) * 100;

  // —— 左键拖动平移 ——
  const pan = useRef<{ sx: number; oxLo: number; oxHi: number } | null>(null);
  const onPanDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.classList.contains('tl-dot') || t.closest('.tl-marker')) return;
    pan.current = { sx: e.clientX, oxLo: lo, oxHi: hi };
    e.preventDefault();
  };
  const onPanMove = (e: React.MouseEvent) => {
    if (!pan.current) return;
    const dx = e.clientX - pan.current.sx;
    const rect = axisRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = dx / rect.width;
    const span = pan.current.oxHi - pan.current.oxLo;
    const shift = pct * span;
    setView({ lo: pan.current.oxLo - shift, hi: pan.current.oxHi - shift });
  };
  const onPanUp = () => { pan.current = null; };

  // —— Ctrl+滚轮以光标为中心缩放视图范围 ——
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = axisRef.current?.getBoundingClientRect();
    if (!rect) return;
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const cursorYear = lo + f * (hi - lo);
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    const span = (hi - lo) * factor;
    let nlo = cursorYear - f * span;
    let nhi = cursorYear + (1 - f) * span;
    if (nlo < dataLo - 5) nlo = dataLo - 5;
    if (nhi > dataHi + 5) nhi = dataHi + 5;
    setView({ lo: nlo, hi: nhi });
    setZoom((z) => Math.max(0.3, Math.min(4, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  };

  const onAddTimeline = async () => {
    setMenu(null);
    const v = await prompt({ title: '新增时间轴', fields: [{ name: 'name', label: '时间轴名称' }] });
    if (v?.name) addTimeline(v.name.trim());
  };
  const onAddNode = async () => {
    setMenu(null);
    const entityOptions = [{ value: '', label: '（无关联实体）' }, ...entities.map((e) => ({ value: e.id, label: `${e.name}` }))];
    const v = await prompt({
      title: '新增时间节点',
      fields: [
        { name: 'label', label: '事件名称' },
        { name: 'year', label: '发生年份', type: 'number', default: '0' },
        { name: 'impact', label: '影响力 (0-100)', type: 'number', default: '50' },
        { name: 'note', label: '备注（可选）' },
        { name: 'entityId', label: '关联实体', type: 'select', options: entityOptions },
      ],
    });
    if (!v?.label) return;
    const year = Number(v.year);
    if (!Number.isFinite(year)) return;
    addTimelineEvent(tl.id, {
      label: v.label.trim(),
      year,
      impact: Math.max(0, Math.min(100, Number(v.impact) || 50)),
      note: v.note || undefined,
      color: '#8b5cf6',
      entityId: v.entityId || undefined,
    });
    setSelected(null);
  };
  const onUnitChange = async (u: TimelineUnit) => {
    if (u === 'custom') {
      const v = await prompt({
        title: '自定义时间单位',
        fields: [
          { name: 'label', label: '单位名称' },
          { name: 'scale', label: '1 单位 = 多少年份', default: '1' },
          { name: 'levels', label: '各级换算（逗号分隔）', placeholder: '1轮回=12纪元,1纪元=100年' },
        ],
      });
      setTimelineUnit(tl.id, 'custom', v?.label || '自定义');
    } else setTimelineUnit(tl.id, u);
  };

  const resetView = () => { setView({ lo: dataLo, hi: dataHi }); setZoom(1); };

  const sel = tl.events.find((e) => e.id === selected);
  const linkedEntity = sel ? entities.find((e) => e.id === sel.entityId) : undefined;

  const eventMeta = useMemo(() => {
    const byYear = new Map<number, number>();
    return [...tl.events]
      .sort((a, b) => a.year - b.year || a.id.localeCompare(b.id))
      .map((e) => {
        const idx = byYear.get(e.year) || 0;
        byYear.set(e.year, idx + 1);
        return { ...e, stackIndex: idx };
      });
  }, [tl.events]);

  const openLinkedEntity = () => {
    setMenu(null);
    if (!sel?.entityId || !linkedEntity) return;
    openTab({ title: linkedEntity.name, icon: linkedEntity.type, kind: 'entity', ref: sel.entityId });
  };

  const linkEntityToNode = async () => {
    setMenu(null);
    if (!sel) return;
    const entityOptions = [{ value: '', label: '（取消关联）' }, ...entities.map((e) => ({ value: e.id, label: e.name }))];
    const v = await prompt({
      title: '关联到实体',
      fields: [{ name: 'entityId', label: '选择实体', type: 'select', options: entityOptions, default: sel.entityId || '' }],
    });
    if (!v) return;
    updateTimelineEvent(tl.id, sel.id, { entityId: v.entityId || undefined });
  };

  const editNode = async () => {
    setMenu(null);
    if (!sel) return;
    const v = await prompt({
      title: '编辑时间节点',
      fields: [
        { name: 'label', label: '事件名称', default: sel.label },
        { name: 'year', label: '发生年份', type: 'number', default: String(sel.year) },
        { name: 'impact', label: '影响力 (0-100)', type: 'number', default: String(sel.impact ?? 50) },
        { name: 'note', label: '备注（可选）', default: sel.note || '' },
      ],
    });
    if (!v?.label) return;
    const year = Number(v.year);
    if (!Number.isFinite(year)) return;
    updateTimelineEvent(tl.id, sel.id, {
      label: v.label.trim(),
      year,
      impact: Math.max(0, Math.min(100, Number(v.impact) || 50)),
      note: v.note || undefined,
    });
  };

  const deleteNode = () => {
    setMenu(null);
    if (!sel) return;
    if (window.confirm(`删除时间节点「${sel.label}」？`)) {
      deleteTimelineEvent(tl.id, sel.id);
      setSelected(null);
    }
  };

  return (
    <div className="editor-scroll" onContextMenu={(e) => e.preventDefault()} style={{ padding: 0 }}>
      <div className="editor-wrap timeline-page tl-full">
        <div className="tl-bar">
          <span className="title">{tl.name}</span>
          <button className="tl-add-node" onClick={onAddNode}>＋ 节点</button>
          <span className="spacer" />
          <button className="tl-reset" onClick={resetView} title="恢复默认视图">⟲ 重置视图</button>
          <select className="mode-btn" value={unit} title="事件单位" onChange={(e) => onUnitChange(e.target.value as TimelineUnit)}>
            <option value="year">年份</option>
            <option value="month">月份</option>
            <option value="day">日期</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <p className="tip">
          按住 <b>Ctrl+滚轮</b> 整体缩放轴线；<b>左键拖空白处</b> 平移；右键添加节点。当前缩放 <b>{Math.round(zoom * 100)}%</b>
        </p>
        <div
          className="tl-axis"
          ref={axisRef}
          onWheel={onWheel}
          onMouseDown={onPanDown}
          onMouseMove={onPanMove}
          onMouseUp={onPanUp}
          onMouseLeave={onPanUp}
          onContextMenu={(e) => {
            e.preventDefault();
            const marker = (e.target as HTMLElement).closest('.tl-marker') as HTMLElement | null;
            const id = marker?.getAttribute('data-event-id');
            if (id) setSelected(id);
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {/* 缩放刻度（主+次），伴随 view.lo/hi 变化 */}
          {(() => {
            const span = hi - lo;
            if (span <= 0) return null;
            // 计算合适的主刻度间隔：选 1/2/5 × 10^n 使每档 ≈ span/8
            const target = span / 8;
            const pow = Math.pow(10, Math.floor(Math.log10(target)));
            const norm = target / pow;
            const majorStep = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * pow;
            const minorStep = majorStep / 5;
            const first = Math.ceil(lo / minorStep) * minorStep;
            const out: JSX.Element[] = [];
            for (let v = first; v <= hi; v += minorStep) {
              const isMajor = Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-9;
              const left = pos(v);
              out.push(
                <div key={`tk-${v}`} className={isMajor ? 'tl-tick-major-wrap' : 'tl-tick-minor'} style={{ left: `${left}%` }} title={`${fmtYear(Math.round(v))}`}>
                  {isMajor && <span className="tl-tick-label">{fmtYear(Math.round(v))}</span>}
                </div>
              );
            }
            return out;
          })()}
          <div className="tl-line" />
          {tl.events.length === 0 && <div className="tl-empty">暂无节点，点击右上角「＋ 节点」或右键添加</div>}
          {eventMeta.map((e) => {
            const isUp = e.stackIndex % 2 === 0;
            const lane = Math.floor(e.stackIndex / 2);
            const offset = isUp ? -34 - lane * 34 : 34 + lane * 34;
            return (
              <div key={e.id}
                data-event-id={e.id}
                className={'tl-marker ' + (isUp ? 'tl-up' : 'tl-down') + (e.id === selected ? ' sel' : '')}
                style={{ left: `${pos(e.year)}%`, transform: `translate(-50%, calc(-50% + ${offset}px))` }}
                onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }}
                onMouseEnter={() => setHovered(e.id)}
                onMouseLeave={() => setHovered(null)}
                title={e.note || e.label}
              >
                <span className="tl-dot" style={{ background: e.color ?? '#8b5cf6', width: Math.max(8, Math.min(24, (e.impact ?? 50) / 100 * 24)), height: Math.max(8, Math.min(24, (e.impact ?? 50) / 100 * 24)) }} />
                <span className="tl-label">
                  {e.label}
                  <em>{fmtYear(e.year)}</em>
                </span>
              </div>
            );
          })}
          {hovered && (() => { const he = tl.events.find(e=>e.id===hovered); if(!he) return null; return <div className="tl-hover" style={{ left: `${pos(he.year)}%` }}>{he.label}{he.note ? ` — ${he.note}` : ''}</div>; })()}
        </div>
        {sel && (
          <div className="tl-detail" style={{ flexShrink: 0 }}>
            <b style={{ color: sel.color ?? 'var(--accent)' }}>{sel.label}</b>
            <span className="tl-year"> · {fmtYear(sel.year)}</span>
            <p>{sel.note || '（暂无备注）'}</p>
          </div>
        )}
      </div>
      {menu && (
        <div className="ctx-menu" style={{ top: menu.y, left: menu.x }} onMouseDown={(e) => e.stopPropagation()}>
          {sel && linkedEntity && (
            <button className="ctx-item" onClick={openLinkedEntity}>打开关联实体：{linkedEntity.name}</button>
          )}
          {sel && (
            <button className="ctx-item" onClick={linkEntityToNode}>{sel.entityId ? '更换关联实体' : '关联到实体'}</button>
          )}
          {sel && <div className="ctx-sep" />}
          {sel && (
            <button className="ctx-item" onClick={editNode}>编辑节点</button>
          )}
          {sel && (
            <button className="ctx-item danger" onClick={deleteNode}>删除节点</button>
          )}
          {sel && <div className="ctx-sep" />}
          <button className="ctx-item" onClick={onAddTimeline}>＋ 添加时间轴</button>
          <button className="ctx-item" onClick={onAddNode}>＋ 添加节点</button>
        </div>
      )}
    </div>
  );
}
