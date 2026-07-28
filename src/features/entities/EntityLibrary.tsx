import { useState, useMemo, useEffect, useRef } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useUIStore } from '../../store/uiStore';
import type { EntityType } from '../../types';
import { ENTITY_TEMPLATES, ENTITY_LABEL } from '../../types';
import { ArticleImportModal } from '../../components/ArticleImportModal';
import { LinkerModal } from '../../components/LinkerModal';

export function EntityLibrary() {
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const relations = useWorldStore((s) => s.worldsData[s.current]?.relations ?? []);
  const addEntity = useWorldStore((s) => s.addEntity);
  const openTab = useUIStore((s) => s.openTab);

  const [filter, setFilter] = useState<EntityType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showLinker, setShowLinker] = useState(false);
  const [newType, setNewType] = useState<EntityType>('character');
  const [newName, setNewName] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);
  // 新建实体表单出现时，autoFocus 在 Electron 焦点竞态下偶发失效，用 ref + 延迟强制聚焦兜底
  useEffect(() => {
    if (!adding) return;
    const t = window.setTimeout(() => addInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [adding]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entities.length };
    for (const t of ENTITY_TEMPLATES) c[t.type] = 0;
    for (const e of entities) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [entities]);

  const degree = useMemo(() => {
    const d: Record<string, number> = {};
    for (const r of relations) {
      d[r.source] = (d[r.source] ?? 0) + 1;
      d[r.target] = (d[r.target] ?? 0) + 1;
    }
    return d;
  }, [relations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities.filter((e) => {
      if (filter !== 'all' && e.type !== filter) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.tags.some((t) => t.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [entities, filter, search]);

  const doAdd = () => {
    const name = newName.trim() || `${ENTITY_LABEL[newType]}·未命名`;
    const id = addEntity({ type: newType, name, fields: ENTITY_TEMPLATES.find((t) => t.type === newType)!.fields.map((f) => ({ label: f.label, value: '', kind: f.kind, entityType: f.entityType })) });
    setNewName('');
    setAdding(false);
    openTab({ title: name, icon: newType, kind: 'entity', ref: id });
  };

  const openEntity = (id: string, name: string, type: EntityType) =>
    openTab({ title: name, icon: type, kind: 'entity', ref: id });

  return (
    <div className="editor-scroll">
      <div className="editor-wrap entity-library">
        <div className="el-head">
          <h2>实体库</h2>
          <div className="el-head-tools">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名称或标签"
              className="el-search"
            />
            <button className="mode-btn" onClick={() => setShowImport(true)}>导入文章并抽取</button>
            <button className="mode-btn" onClick={() => setShowLinker(true)}>实体关联</button>
            <button className="mode-btn active" onClick={() => setAdding((v) => !v)}>＋ 新建实体</button>
          </div>
        </div>
        <p className="tip">共 {entities.length} 个实体 · 关系连线 {relations.length} 条 · 点击任一实体打开编辑器（M1 六类结构化录入）</p>

        {adding && (
          <div className="el-add">
            <div className="el-add-row">
              <select value={newType} onChange={(e) => setNewType(e.target.value as EntityType)} className="el-add-select">
                {ENTITY_TEMPLATES.map((t) => (
                  <option key={t.type} value={t.type}>{t.label}</option>
                ))}
              </select>
              <input
                ref={addInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={`${ENTITY_LABEL[newType]}名称（可留空）`}
                className="el-add-input"
                onKeyDown={(e) => e.key === 'Enter' && doAdd()}
              />
              <button className="mode-btn active" onClick={doAdd}>创建</button>
              <button className="mode-btn" onClick={() => setAdding(false)}>取消</button>
            </div>
          </div>
        )}

        <div className="el-filters">
          <button className={'el-filter' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>
            全部 <span className="el-filter-count">{counts.all}</span>
          </button>
          {ENTITY_TEMPLATES.map((t) => (
            <button key={t.type} className={'el-filter' + (filter === t.type ? ' active' : '')} onClick={() => setFilter(t.type)}>
              {t.label} <span className="el-filter-count">{counts[t.type] ?? 0}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="placeholder-view" style={{ minHeight: 240 }}>
            <div className="big">实体</div>
            <div>{search || filter !== 'all' ? '没有匹配的实体' : '还没有实体，点「＋ 新建实体」或「导入文章并抽取」开始搭建你的世界观'}</div>
          </div>
        ) : (
          <div className="el-grid">
            {filtered.map((e) => {
              const cover = e.images?.find((i) => i.id === e.coverImageId) ?? e.images?.[0];
              return (
                <div
                  key={e.id}
                  className="el-card"
                  style={cover ? { backgroundImage: `url(${cover.dataUrl})` } : undefined}
                  onClick={() => openEntity(e.id, e.name, e.type)}
                >
                  <div className="el-card-overlay" />
                  <div className="el-card-head">
                    <span className="el-card-type">{ENTITY_LABEL[e.type]}</span>
                    <span className="el-card-name">{e.name}</span>
                  </div>
                  <div className="el-card-fields">
                  {e.fields.filter((f) => f.value).slice(0, 3).map((f, i) => {
                    const displayValue = f.kind === 'entity' ? (entities.find((ent) => ent.id === f.value)?.name ?? f.value) : f.value;
                    return (
                      <div key={i} className="el-card-field"><b>{f.label}</b> {displayValue}</div>
                    );
                  })}
                  {e.fields.filter((f) => f.value).length === 0 && (
                    <div className="el-card-field muted">尚未填写结构化字段</div>
                  )}
                </div>
                <div className="el-card-foot">
                  {e.tags.slice(0, 3).map((t, i) => (
                    <span key={i} className="entity-tag">{t}</span>
                  ))}
                  <span className="el-card-degree" title="关系数量">{degree[e.id] ?? 0}</span>
                </div>
              </div>
            );
          })}
          </div>
        )}
      </div>
      {showImport && <ArticleImportModal onClose={() => setShowImport(false)} />}
      {showLinker && <LinkerModal onClose={() => setShowLinker(false)} />}
    </div>
  );
}
