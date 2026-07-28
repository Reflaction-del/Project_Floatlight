import { useRef, useState, useEffect, useMemo } from 'react';
import { useUIStore } from '../store/uiStore';
import { useWorldStore } from '../store/worldStore';
import type { TabItem } from '../types';
import { TabIcon } from './icons';

export function TabBar() {
  const tabs = useUIStore((s) => s.tabs);
  const activeTabId = useUIStore((s) => s.activeTabId);
  const splitTabId = useUIStore((s) => s.splitTabId);
  const closeTab = useUIStore((s) => s.closeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setSplitTab = useUIStore((s) => s.setSplitTab);
  const openTab = useUIStore((s) => s.openTab);
  const moveTab = useUIStore((s) => s.moveTab);
  // 当标签栏有且只有一个启动页时，启动页不可被关闭
  const isOnlyStart = (tab: TabItem) => tab.kind === 'start' && tabs.length === 1;
  const [overSplit, setOverSplit] = useState(false);
  const dragRef = useRef<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [searchQ, setSearchQ] = useState('');
  const [searchIdx, setSearchIdx] = useState(-1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const onDropSplit = () => { setOverSplit(false); const id = dragRef.current; if (id) setSplitTab(id); dragRef.current = null; };

  // 鼠标靠近标签栏左右边缘时自动滚动
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    let dir = 0;
    let speed = 0;
    let raf = 0;
    const edge = 40;
    const maxSpeed = 8;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < edge) {
        dir = -1;
        speed = maxSpeed * (1 - x / edge);
      } else if (x > rect.width - edge) {
        dir = 1;
        speed = maxSpeed * ((x - (rect.width - edge)) / edge);
      } else {
        dir = 0;
        speed = 0;
      }
    };
    const onLeave = () => { dir = 0; speed = 0; };
    const loop = () => {
      if (dir !== 0) el.scrollLeft += dir * speed;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [];
    const wd = useWorldStore.getState().worldsData[useWorldStore.getState().current];
    if (!wd) return [];
    const out: { label: string; icon: string; kind: 'doc' | 'timeline' | 'drafts'; ref: string; desc?: string }[] = [];
    wd.docs.forEach((d) => { if (d.title.toLowerCase().includes(q)) out.push({ label: d.title, icon: d.icon, kind: 'doc', ref: d.id, desc: d.folder }); });
    wd.drafts.forEach((d) => { if (d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q)) out.push({ label: d.title, icon: 'drafts', kind: 'drafts', ref: d.id, desc: '草稿' }); });
    wd.timelines.forEach((t) => {
      if (t.name.toLowerCase().includes(q)) out.push({ label: t.name, icon: 'timeline', kind: 'timeline', ref: t.id, desc: '时间轴' });
      t.events.forEach((e) => { if (e.label.toLowerCase().includes(q) || (e.note || '').toLowerCase().includes(q)) out.push({ label: e.label, icon: '•', kind: 'timeline', ref: t.id, desc: `${t.name} 事件` }); });
    });
    return out.slice(0, 20);
  }, [searchQ]);

  const onSearchResultClick = (r: typeof searchResults[number]) => {
    setSearchOpen(false); setSearchQ('');
    if (r.kind === 'doc') openTab({ title: r.label, icon: r.icon, kind: 'doc', ref: r.ref });
    else if (r.kind === 'timeline') openTab({ title: r.label, icon: 'timeline', kind: 'timeline', ref: r.ref });
    else if (r.kind === 'drafts') openTab({ title: '草稿箱', icon: 'drafts', kind: 'drafts', ref: 'drafts' });
  };

  return (
    <>
      <div className="tabbar">
        <div className="tabs" ref={tabsRef}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={
                'tab' +
                (tab.id === activeTabId ? ' active' : '') +
                (tab.id === splitTabId ? ' split' : '') +
                (dragOverId && dragOverId === tab.id && dragRef.current && dragRef.current !== tab.id ? ' drag-over' : '')
              }
              onClick={() => setActiveTab(tab.id)}
              onContextMenu={(e) => { e.preventDefault(); if (!isOnlyStart(tab)) closeTab(tab.id); }}
              draggable
              onDragStart={(e) => { dragRef.current = tab.id; setDragOverId(null); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => {
                e.preventDefault();
                const from = dragRef.current;
                if (from && from !== tab.id) setDragOverId(tab.id);
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => {
                e.stopPropagation();
                const from = dragRef.current;
                if (from && from !== tab.id) {
                  const toIndex = tabs.findIndex((t) => t.id === tab.id);
                  if (toIndex !== -1) moveTab(from, toIndex);
                }
                dragRef.current = null;
                setDragOverId(null);
              }}
              onDragEnd={() => { dragRef.current = null; setDragOverId(null); }}
              title={tab.title}
            >
              <TabIcon icon={tab.icon} />
              <span className="tab-title">{tab.title}</span>
              {isOnlyStart(tab) ? (
                <span className="tab-close tab-close-locked" title="开始页不可关闭" aria-disabled="true">×</span>
              ) : (
                <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>×</span>
              )}
            </div>
          ))}
        </div>

        <div className="search-wrap">
        <input
          id="global-search-input"
          type="text"
          className="global-search"
          placeholder="搜索 文档 / 草稿 / 时间轴 / 可视化"
          value={searchQ}
          onChange={(e) => { setSearchQ(e.target.value); setSearchIdx(-1); setSearchOpen(true); }}
          onFocus={() => searchQ && setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setSearchOpen(false); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setSearchIdx((i) => Math.min(searchResults.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSearchIdx((i) => Math.max(-1, i - 1)); }
            if (e.key === 'Enter') {
              if (searchIdx >= 0 && searchResults[searchIdx]) onSearchResultClick(searchResults[searchIdx]);
              else if (searchResults[0]) onSearchResultClick(searchResults[0]);
            }
          }}
          style={{ width: '100%', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--fg)', fontSize: 12, fontFamily: 'inherit' }}
        />
        {searchOpen && searchResults.length > 0 && (
          <div className="search-overlay">
            {searchResults.map((r, i) => (
              <div key={r.kind + r.ref} className={'search-item' + (i === searchIdx ? ' active' : '')}
                onMouseDown={() => onSearchResultClick(r)}
                onMouseEnter={() => setSearchIdx(i)}
              >
                <TabIcon icon={r.icon} />
                <span className="search-item-title">{r.label}</span>
                <span className="search-item-desc">{r.desc}</span>
              </div>
            ))}
          </div>
        )}
        </div>

        <div
          className={'split-zone' + (overSplit ? ' over' : '') + (splitTabId ? ' on' : '')}
          onDragOver={(e) => { e.preventDefault(); if (dragRef.current && dragRef.current !== activeTabId) setOverSplit(true); }}
          onDragLeave={() => setOverSplit(false)}
          onDrop={onDropSplit}
        >
          {splitTabId ? '⊟ 退出分屏' : '⊞ 拖拽分屏'}
        </div>
      </div>
      {splitTabId && (
        <div className="tabbar tabbar-split">
          {tabs.filter((t) => t.id !== activeTabId).map((tab) => (
            <div key={tab.id} className={'tab' + (tab.id === splitTabId ? ' active' : '')} onClick={() => setSplitTab(tab.id)} title={tab.title}>
              <TabIcon icon={tab.icon} />
              <span className="tab-title">{tab.title}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
