import { useState, useEffect } from 'react';
import { useWorldStore } from '../store/worldStore';
import { useUIStore } from '../store/uiStore';
import { usePromptStore } from '../store/promptStore';
import type { DocFile, TreeSelection } from '../types';
import { IconDoc, IconFolder, IconTimeline } from './icons';

interface MenuState { x: number; y: number; target: 'folder' | 'file' | 'empty' }

export function FileTree() {
  const docs = useWorldStore((s) => s.worldsData[s.current]?.docs ?? []);
  const folders = useWorldStore((s) => s.worldsData[s.current]?.folders ?? []);
  const timelines = useWorldStore((s) => s.worldsData[s.current]?.timelines ?? []);
  const activeDocId = useWorldStore((s) => s.worldsData[s.current]?.activeDocId ?? '');
  const selectedTree = useWorldStore((s) => s.selectedTree);
  const setSelectedTree = useWorldStore((s) => s.setSelectedTree);
  const addDoc = useWorldStore((s) => s.addDoc);
  const addFolder = useWorldStore((s) => s.addFolder);
  const moveDocToFolder = useWorldStore((s) => s.moveDocToFolder);
  const deleteDoc = useWorldStore((s) => s.deleteDoc);
  const deleteFolder = useWorldStore((s) => s.deleteFolder);
  const deleteTimeline = useWorldStore((s) => s.deleteTimeline);
  const addTimeline = useWorldStore((s) => s.addTimeline);
  const renameDoc = useWorldStore((s) => s.renameDoc);
  const renameTimeline = useWorldStore((s) => s.renameTimeline);

  const openTab = useUIStore((s) => s.openTab);
  const renameTab = useUIStore((s) => s.renameTab);
  const prompt = usePromptStore((s) => s.open);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); const t = setTimeout(() => document.addEventListener('mousedown', close), 0); return () => { clearTimeout(t); document.removeEventListener('mousedown', close); }; }, [menu]);

  // 自动编号文件夹名（保证每个文件夹名唯一）
  const uniqFolder = (base: string) => {
    let n = 1;
    let name = `${base}（${n}）`;
    while (folders.includes(name)) { n++; name = `${base}（${n}）`; }
    folders.push(name); // 让下一次自增跳过
    folders.pop();
    return name;
  };

  const groups: { name: string; docs: DocFile[] }[] = folders.map((name) => ({
    name,
    docs: docs.filter((d) => d.folder === name),
  }));

  const openDoc = (id: string, title: string, icon: string) => openTab({ title, icon, kind: 'doc', ref: id });
  const closeMenu = () => setMenu(null);

  const doNewDoc = async () => {
    closeMenu();
    const preFolder = selectedTree?.kind === 'folder' ? selectedTree.id : (folders[0] ?? '未分组');
    const v = await prompt({
      title: '新建文章',
      fields: [
        { name: 'title', label: '文章标题', placeholder: '如：第二章 · 觉醒', default: '未命名' },
        { name: 'folder', label: '所属文件夹', type: 'select', options: folders.map((f) => ({ value: f, label: f })), default: preFolder },
      ],
    });
    if (!v) return; if (!v.title || !v.title.trim()) { alert('名称不能为空'); return; }
    addDoc(v.title.trim(), v.folder || preFolder);
    const created = (useWorldStore.getState().worldsData[useWorldStore.getState().current]?.docs ?? []).slice(-1)[0];
    if (created) {
      openDoc(created.id, created.title, '');
    }
  };

  const doNewFolder = async () => {
    closeMenu();
    const v = await prompt({ title: '新建文件夹', fields: [{ name: 'name', label: '文件夹名称', placeholder: '如：势力', default: '未命名' }] });
    if (!v) return; if (!v.name || !v.name.trim()) { alert('名称不能为空'); return; }
    const name = folders.includes(v.name.trim()) ? uniqFolder(v.name.trim()) : v.name.trim();
    addFolder(name);
  };

  const doNewTimeline = async () => {
    closeMenu();
    const v = await prompt({ title: '新建时间轴', fields: [{ name: 'name', label: '时间轴名称' }] });
    if (v?.name) {
      addTimeline(v.name.trim());
      const ids = useWorldStore.getState().worldsData[useWorldStore.getState().current]?.timelines ?? [];
      const latest = ids[ids.length - 1];
      if (latest) openTab({ title: latest.name, icon: '', kind: 'timeline', ref: latest.id });
    }
  };

  const doDelete = () => {
    closeMenu();
    const sel: TreeSelection | null = selectedTree;
    if (!sel) return;
    if (sel.kind === 'doc') deleteDoc(sel.id);
    else if (sel.kind === 'folder') deleteFolder(sel.id);
    else if (sel.kind === 'timeline') deleteTimeline(sel.id);
  };

  const doRename = async () => {
    closeMenu();
    const sel = selectedTree;
    if (!sel) return;
    let cur = '';
    if (sel.kind === 'doc') cur = docs.find((d) => d.id === sel.id)?.title ?? '';
    else if (sel.kind === 'timeline') cur = timelines.find((t) => t.id === sel.id)?.name ?? '';
    const v = await prompt({ title: '重命名', fields: [{ name: 'title', label: '新名称', default: cur }] });
    if (!v?.title) return;
    const trimmed = v.title.trim();
    if (sel.kind === 'doc') {
      renameDoc(sel.id, trimmed);
      renameTab('doc', sel.id, trimmed);
    } else if (sel.kind === 'timeline') {
      renameTimeline(sel.id, trimmed);
      renameTab('timeline', sel.id, trimmed);
    }
  };

  const select = (sel: TreeSelection) => setSelectedTree(sel);
  const toggleFolder = (name: string) => setCollapsed((c) => ({ ...c, [name]: !c[name] }));
  const onCtx = (e: React.MouseEvent, sel?: TreeSelection) => {
    e.preventDefault();
    if (sel) select(sel);
    let target: 'folder' | 'file' | 'empty' = 'empty';
    if (sel?.kind === 'folder') target = 'folder';
    else if (sel) target = 'file';
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  return (
    <div className="filetree" onContextMenu={(e) => onCtx(e)}>
      <div className="ft-head">
          <span className="ft-head-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconFolder size={16} /> 文件</span>
          <div className="ft-head-tools">
            <button className="ft-tool" title="新建文章" onClick={() => doNewDoc()}><IconDoc size={16} /></button>
            <button className="ft-tool" title="新建文件夹" onClick={() => doNewFolder()}><IconFolder size={16} /></button>
            <button className="ft-tool" title="新建时间轴" onClick={() => doNewTimeline()}><IconTimeline size={16} /></button>
          </div>
        </div>
      <div className="ft-body">
      {groups.map((g) => {
        const isCollapsed = collapsed[g.name];
        return (
          <div key={g.name} className="ft-group">
            <div
              className={'ft-item ft-folder' + (selectedTree?.kind === 'folder' && selectedTree.id === g.name ? ' sel' : '')}
              onClick={() => { toggleFolder(g.name); select({ kind: 'folder', id: g.name }); }}
              onContextMenu={(e) => onCtx(e, { kind: 'folder', id: g.name })}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-fl-doc')) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const docId = e.dataTransfer.getData('application/x-fl-doc');
                if (docId) moveDocToFolder(docId, g.name);
              }}
            >
              <span className="ft-caret">{isCollapsed ? '▸' : '▾'}</span>
              <span>{g.name}</span>
              <span className="ft-count">{g.docs.length}</span>
            </div>
            {!isCollapsed && (
              <>
                {g.docs.map((d) => (
                  <div key={d.id}
                    className={'ft-item ft-doc' + (d.id === activeDocId ? ' active' : '') + (selectedTree?.kind === 'doc' && selectedTree.id === d.id ? ' sel' : '')}
                    onClick={() => { openDoc(d.id, d.title, ''); select({ kind: 'doc', id: d.id }); }}
                    onContextMenu={(e) => onCtx(e, { kind: 'doc', id: d.id })}
                    onDragStart={(e) => e.dataTransfer.setData('application/x-fl-doc', d.id)}
                    draggable
                    title={d.title}
                  >
                    <span className="ft-doc-title">{d.title}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}

      {timelines.length > 0 && (
        <div className="ft-group">
          <div className="ft-item ft-folder"><span className="ft-caret">▾</span><span>时间轴</span><span className="ft-count">{timelines.length}</span></div>
          {timelines.map((t) => (
            <div key={t.id} className={'ft-item ft-doc' + (selectedTree?.kind === 'timeline' && selectedTree.id === t.id ? ' sel' : '')}
              onClick={() => { select({ kind: 'timeline', id: t.id }); openTab({ title: t.name, icon: '', kind: 'timeline', ref: t.id }); }}
              onContextMenu={(e) => onCtx(e, { kind: 'timeline', id: t.id })} title={t.name}
            ><span className="ft-doc-title">{t.name}</span></div>
          ))}
        </div>
      )}
      </div>{/* /ft-body */}

      {menu && (
        <div className="ctx-menu" style={{ top: menu.y, left: menu.x }} onMouseDown={(e) => e.stopPropagation()}>
          {menu.target !== 'file' && (<>
            <button className="ctx-item" onClick={doNewDoc}>＋ 新建文章</button>
            <button className="ctx-item" onClick={doNewFolder}>＋ 新建文件夹</button>
            <button className="ctx-item" onClick={doNewTimeline}>＋ 新建时间轴</button>
          </>)}
          {selectedTree && (<>
            {(menu.target !== 'file') && <div className="ctx-sep" />}
            <button className="ctx-item" onClick={doRename}>重命名</button>
            <button className="ctx-item danger" onClick={doDelete}>删除选中项</button>
          </>)}
        </div>
      )}

      <div className="ft-bottom">
        <button onClick={() => openTab({ title: '草稿箱', icon: '', kind: 'drafts', ref: 'drafts' })}>草稿箱</button>
      </div>
    </div>
  );
}
