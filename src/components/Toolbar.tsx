import { useState, useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WORKSPACE_PRESETS } from '../features/workspace/presets';
import { usePromptStore } from '../store/promptStore';
import { useWorldStore } from '../store/worldStore';
import { useWorldviewStore, displayWorldName } from '../store/worldviewStore';
import { IconEntities, IconRelations, IconConsistency, IconShare, IconSettings, IconPanel, IconCopilot, IconSave, IconMaterials, IconGlobe, IconProposals, IconOutline, IconTrace, IconSimulation, IconDice } from './icons';


const TEMPLATES = [
  { key: 'empty', label: '空白', desc: '零文件、零时间轴，纯空白' },
  { key: 'novel', label: '小说', desc: '角色/场景/章节三文件夹 + 3 示例文档 + 主线时间' },
  { key: 'script', label: '剧本', desc: '角色/场次两文件夹 + 2 示例文档 + 剧本时间' },
];

export function Toolbar() {
  const openTab = useUIStore((s) => s.openTab);
  /** 模块打开：若该模块已在某个 dock 面板则激活面板，否则开新 tab */
  const openModule = (ref: string, title: string, icon: string) => {
    const ws = useWorkspaceStore.getState();
    const dockKey = (Object.keys(ws.docks) as Array<keyof typeof ws.docks>).find((d) => ws.docks[d].panels.some((p) => p.id === ref));
    if (dockKey) {
      useWorkspaceStore.setState((st) => ({ docks: { ...st.docks, [dockKey]: { ...st.docks[dockKey], active: ref } } }));
      return;
    }
    openTab({ title, icon, kind: 'module', ref });
  };
  const closeAllTabs = useUIStore((s) => s.closeTab);
  const switchWorld = useWorldStore((s) => s.switchWorld);
  const addWorldData = useWorldStore((s) => s.addWorld);
  const saveNow = useWorldStore((s) => s.saveNow);
  const tabs = useUIStore((s) => s.tabs);
  const setSplitTab = useUIStore((s) => s.setSplitTab);
  const wsDocks = useWorkspaceStore((s) => s.docks);
  const fileTreeOpen = wsDocks.left.panels.some((p) => p.id === 'filetree');
  const copilotOpen = wsDocks.right.panels.some((p) => p.id === 'copilot');
  const toggleFileTree = () => {
    const ws = useWorkspaceStore.getState();
    if (ws.docks.left.panels.some((p) => p.id === 'filetree')) ws.closePanel('filetree');
    else ws.addPanel('filetree', 'left');
  };
  const toggleCopilot = () => {
    const ws = useWorkspaceStore.getState();
    if (ws.docks.right.panels.some((p) => p.id === 'copilot')) ws.closePanel('copilot');
    else ws.addPanel('copilot', 'right');
  };
  const showProposals = useUIStore((s) => s.showProposals);
  const toggleProposals = useUIStore((s) => s.toggleProposals);
  const showTrace = useUIStore((s) => s.showTrace);
  const toggleTrace = useUIStore((s) => s.toggleTrace);
  const pendingCount = useWorldStore((s) => (s.worldsData[s.current]?.proposals ?? []).filter((p) => p.status === 'pending').length);
  const worldview = useWorldviewStore();
  const [wmOpen, setWmOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const activeModule = useUIStore((s) => s.module);

  const [wsOpen, setWsOpen] = useState(false);
  const wsCurrentId = useWorkspaceStore((s) => s.currentId);
  const wsCustoms = useWorkspaceStore((s) => s.customs);
  const prompt = usePromptStore((s) => s.open);
  const switchWs = (id: string) => { useWorkspaceStore.getState().switchWorkspace(id); setWsOpen(false); };
  const saveWs = async () => {
    const v = await prompt({ title: '保存当前布局', fields: [{ name: 'name', label: '布局名称', placeholder: '如：我的物料布局', default: '自定义布局' }] });
    if (!v?.name) return;
    useWorkspaceStore.getState().saveAsCustom(v.name);
    setWsOpen(false);
  };
  const [lastSaved, setLastSaved] = useState<number>(Date.now());
  const onSave = () => {
    saveNow();
    setSavedFlash(true);
    setLastSaved(Date.now());
    setTimeout(() => setSavedFlash(false), 1800);
  };
  const lastSavedLabel = new Date(lastSaved).toLocaleTimeString('zh-CN', { hour12: false });


  const doSwitch = async (name: string) => {
    if (name === worldview.current) return;
    if (!window.confirm(`切换到「${name}」？\n当前工作区会被关闭（数据已自动保存）。`)) return;
    // 先关闭旧世界标签页，避免切换后 Editor / TimelineView 用旧 ref 在新世界中找不到数据而崩溃
    const ids = tabs.map((t) => t.id);
    for (const id of ids) closeAllTabs(id);
    setSplitTab(null);
    await switchWorld(name);
    worldview.setCurrent(name);
  };

  return (
    <div className="toolbar">
      <button
        className={'tool-btn' + (wmOpen ? ' active' : '')}
        title="世界观管理（切换 / 新建 / 选择世界观项目）"
        onClick={() => setWmOpen(true)}
      >
        <IconGlobe />
      </button>
      <button className={'tool-btn' + (activeModule === 'entities' ? ' mod-active' : '')} title="实体库" onClick={() => openTab({ title: '实体库', icon: 'entities', kind: 'module', ref: 'entities' })}><IconEntities /></button>
      <button className="tool-btn" title="全局大纲（章节结构，Agent 可读写）" onClick={() => openTab({ title: '全局大纲', icon: 'outline', kind: 'outline', ref: 'outline' })}><IconOutline /></button>
      <button className="tool-btn" title="角色模拟（多子代理推演故事）" onClick={() => openTab({ title: '角色模拟', icon: 'simulation', kind: 'simulation', ref: 'simulation' })}><IconSimulation /></button>
      <button className="tool-btn" title="跑团（AI 主持 / 规则检定）" onClick={() => openTab({ title: '跑团', icon: 'dice', kind: 'ttrpg', ref: 'ttrpg' })}><IconDice /></button>
      <button className={'tool-btn' + (activeModule === 'relations' ? ' mod-active' : '')} title="线索板" onClick={() => openTab({ title: '线索板', icon: 'relations', kind: 'module', ref: 'relations' })}><IconRelations /></button>
      <button className={'tool-btn' + (activeModule === 'consistency' ? ' mod-active' : '')} title="一致性检查" onClick={() => openTab({ title: '一致性检查', icon: 'consistency', kind: 'module', ref: 'consistency' })}><IconConsistency /></button>
      <button className={'tool-btn' + (activeModule === 'share' ? ' mod-active' : '')} title="协作与分享" onClick={() => openTab({ title: '协作与分享', icon: 'share', kind: 'module', ref: 'share' })}><IconShare /></button>
      <button className={'tool-btn' + (activeModule === 'materials' ? ' mod-active' : '')} title="可视化编辑器（视觉物料生成：角色卡 / 插图 / 批量导出 PNG·PDF）" onClick={() => openTab({ title: '可视化编辑器', icon: 'materials', kind: 'module', ref: 'materials' })}><IconMaterials /></button>
      <span className="spacer" style={{ flex: 1 }} />
      <button
        className={'tool-btn' + (wsOpen ? ' active' : '')}
        title="工作区（按创作场景切换布局，可拖拽面板到任意停靠区）"
        onClick={() => setWsOpen((v) => !v)}
      >
        <IconGlobe />
      </button>
      {wsOpen && (
        <div className="ws-menu" onMouseDown={(e) => e.stopPropagation()}>
          <div className="ws-menu-title">工作区布局</div>
          {WORKSPACE_PRESETS.map((w) => (
            <button key={w.id} className={'ws-item' + (w.id === wsCurrentId ? ' active' : '')} onClick={() => switchWs(w.id)}>
              {w.name}
            </button>
          ))}
          {wsCustoms.length > 0 && (
            <>
              <div className="ws-menu-sep" />
              {wsCustoms.map((c) => (
                <button key={c.id} className={'ws-item' + (c.id === wsCurrentId ? ' active' : '')} onClick={() => switchWs(c.id)}>
                  {c.name}
                  <span className="ws-del" onClick={(e) => { e.stopPropagation(); useWorkspaceStore.getState().deleteCustom(c.id); }} title="删除">×</span>
                </button>
              ))}
            </>
          )}
          <div className="ws-menu-sep" />
          <button className="ws-item" onClick={saveWs}>＋ 保存当前布局为…</button>
          <button className="ws-item" onClick={() => { useWorkspaceStore.getState().resetToDefault(); setWsOpen(false); }}>↺ 重置为默认</button>
        </div>
      )}
      <button
        className={'tool-btn' + (fileTreeOpen ? ' active' : '')}
        title={fileTreeOpen ? '收起文件树' : '展开文件树'}
        onClick={toggleFileTree}
      >
        <IconPanel />
      </button>
      <button
        className={'tool-btn' + (copilotOpen ? ' active' : '')}
        title={copilotOpen ? '收起 AI 侧栏' : '展开 AI 侧栏'}
        onClick={toggleCopilot}
      >
        <IconCopilot />
      </button>
      <button
        className={'tool-btn' + (showProposals ? ' active' : '')}
        title="提案中心（查看 / 采纳 AI 生成的修改）"
        onClick={toggleProposals}
      >
        <IconProposals />
        {pendingCount > 0 && <span className="prop-badge">{pendingCount}</span>}
      </button>
      <button
        className={'tool-btn' + (showTrace ? ' active' : '')}
        title="执行轨迹（对话与工具调用记录，可分叉/回放）"
        onClick={toggleTrace}
      >
        <IconTrace />
      </button>
      <div className="save-group">
        <button className={'tool-btn save-btn' + (savedFlash ? ' flash' : '')} onClick={onSave} title={`保存当前世界（数据已自动保存 · ${lastSavedLabel}）`}>{savedFlash ? '✓' : <IconSave />}</button>
      </div>
      <button className={'tool-btn' + (activeModule === 'settings' ? ' mod-active' : '')} title="设置" onClick={() => openTab({ title: '设置', icon: 'settings', kind: 'module', ref: 'settings' })}><IconSettings /></button>
      {wmOpen && <WorldviewModal onClose={() => setWmOpen(false)} onSwitch={doSwitch} />}
    </div>
  );
}

function WorldviewModal({ onClose, onSwitch }: { onClose: () => void; onSwitch: (name: string) => Promise<void>; }) {
  const worldview = useWorldviewStore();
  const addWorldData = useWorldStore((s) => s.addWorld);
  const renameWorldData = useWorldStore((s) => s.renameWorld);
  const worldStoreCurrent = useWorldStore((s) => s.current);
  const [newName, setNewName] = useState('');
  const [template, setTemplate] = useState<'empty' | 'novel' | 'script'>('empty');
  const [editName, setEditName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const current = worldview.worlds.find((w) => w.name === worldview.current);

  useEffect(() => {
    if (current) {
      setEditName(current.name);
      setNameError(null);
    }
  }, [current?.name]);

  const applyName = () => {
    if (!current) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setNameError('世界名称不能为空');
      setEditName(current.name);
      return;
    }
    if (trimmed === current.name) {
      setNameError(null);
      return;
    }
    if (worldview.worlds.some((w) => w.name === trimmed && w.name !== current.name)) {
      setNameError('已存在同名世界');
      setEditName(current.name);
      return;
    }
    setNameError(null);
    // 同步世界观列表与世界数据 key；改名后当前指向也要切到新名
    worldview.updateWorld(current.name, { name: trimmed });
    renameWorldData(current.name, trimmed);
    if (worldview.current === current.name) {
      worldview.setCurrent(trimmed);
    }
  };

  const doNew = () => {
    const name = newName.trim();
    if (!name) return;
    if (worldview.worlds.find((w) => w.name === name)) { alert('已存在同名世界'); return; }
    addWorldData(name, template);
    worldview.addWorld(name);
    setNewName('');
    onSwitch(name);
  };

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal wm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>世界观管理</h3>
        <div className="wm-layout">
          <div className="wm-list-col">
            <div className="wm-section-title">所有世界观</div>
            <div className="wm-list">
              {worldview.worlds.map((w) => (
                <div key={w.name}
                  className={'wm-item' + (w.name === worldview.current ? ' active' : '')}
                  onClick={() => onSwitch(w.name)}
                >
                  <span className="wm-item-icon">{w.icon}</span>
                  <span className="wm-item-name">{displayWorldName(w)}</span>
                  {w.themeColor && <span className="wm-item-dot" style={{ background: w.themeColor }} />}
                </div>
              ))}
            </div>
            <div className="wm-new">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新建世界观名称" onKeyDown={(e) => e.key === 'Enter' && doNew()} />
              <div className="wm-new-row">
                <select className="mode-btn wm-tpl" value={template} onChange={(e) => setTemplate(e.target.value as any)} title="选择模板">
                  {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <button className="mode-btn active wm-new-btn" onClick={doNew}>＋ 新建</button>
              </div>
            </div>
            <div className="wm-tip">{(TEMPLATES.find((t) => t.key === template)?.desc ?? '') + ' · 点「＋ 新建」'}</div>
          </div>
          <div className="wm-detail-col">
            {current ? (
              <>
                <div className="wm-section-title">当前 · {displayWorldName(current)}</div>
                <div className="wm-form">
                  <label>
                    <span>名称</span>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={applyName}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                    />
                    {nameError && <span className="wm-name-error">{nameError}</span>}
                  </label>
                  <label>
                    <span>主题色</span>
                    <div className="wm-colors">
                      {['#3b82f6','#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#22c55e','#10b981','#06b6d4','#0ea5e9','#a855f7','#f43f5e','#1e293b','#475569','#7c3aed','#0891b2','#84cc16','#f97316'].map((c) => (
                        <button key={c} className={'wm-color' + (current.themeColor === c ? ' active' : '')} style={{ background: c }} onClick={() => worldview.updateWorld(current.name, { themeColor: c })} title={c} type="button" />
                      ))}
                      <button className={'wm-color' + (!current.themeColor ? ' active' : '')} style={{ background: 'transparent', border: '1px dashed var(--border)' }} onClick={() => worldview.updateWorld(current.name, { themeColor: undefined as any })} title="恢复默认" type="button">∅</button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <input type="color" value={current.themeColor ?? '#3b82f6'} onChange={(e) => worldview.updateWorld(current.name, { themeColor: e.target.value })} style={{ width: 28, height: 24, border: '1px solid var(--border)', borderRadius: 4, padding: 0 }} />
                      <input type="text" value={current.themeColor ?? ''} onChange={(e) => worldview.updateWorld(current.name, { themeColor: e.target.value })} placeholder="#3b82f6" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', background: 'var(--bg)', color: 'var(--fg)', fontSize: 12 }} />
                    </div>
                  </label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="mode-btn" onClick={() => worldview.updateWorld(current.name, { themeColor: undefined as any })}>恢复默认主题</button>
                    {worldview.worlds.length > 1 && (
                      <button className="mode-btn danger" onClick={() => {
                        if (window.confirm(`确定删除"${displayWorldName(current)}"？\n对应数据文件也将被删除，不可恢复。`)) {
                          // 先清理旧标签页，再删除/切换世界，避免白屏
                          const ids = useUIStore.getState().tabs.map((t) => t.id);
                          ids.forEach((id) => useUIStore.getState().closeTab(id));
                          useUIStore.getState().setSplitTab(null);
                          // 使用 worldStore 中的实际数据 key（可能与显示名不一致，尤其是历史损坏数据）
                          const dataKey = worldStoreCurrent;
                          const next = worldview.removeWorld(current.name);
                          useWorldStore.getState().removeWorld(dataKey, next);
                        }
                      }}>删除该世界</button>
                    )}
                  </div>
                </div>
              </>
            ) : <div className="wm-tip">暂无世界，请新建一个。</div>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="mode-btn active" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
