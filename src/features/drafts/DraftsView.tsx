import { useState, useMemo, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useWorldStore } from '../../store/worldStore';
import { chatOnce } from '../../utils/ai';
import { useAIStore } from '../../store/aiStore';

function hasText(html: string) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  
  const doAIAnalyze = async (d: any) => {
    if (!d) return;
    const cfg = useAIStore.getState().getCurrent();
    if (!cfg) { alert('请先在设置中配置 AI API'); return; }
    try {
      const r = await chatOnce(cfg, [{ role: 'user', content: `请分析以下草稿内容，提取关键信息（摘要、角色、地点、时间点）：\n\n${(d.content || '').replace(/<[^>]+>/g, '')}` }], { feature: 'draft-analyze' });
      alert('AI 分析结果：\n' + r);
    } catch (e: any) { alert('AI 分析失败：' + (e.message || e)); }
  };
  const doAIConvert = async (d: any, type: 'doc' | 'timeline') => {
    if (!d) return;
    const cfg = useAIStore.getState().getCurrent();
    if (!cfg) { alert('请先在设置中配置 AI API'); return; }
    const text = (d.content || '').replace(/<[^>]+>/g, '');
    if (type === 'doc') {
      useWorldStore.getState().addDoc(d.title || '来自草稿', useWorldStore.getState().worldsData[useWorldStore.getState().current]?.folders[0] || '未分组');
      alert('已转化为文档！');
    } else {
      try {
        const r = await chatOnce(cfg, [{ role: 'user', content: `从以下内容中提取一个时间点（年份数字）和事件名称，只输出"年份|事件名"格式，不要其他文字：\n\n${text}` }], { feature: 'draft-analyze' });
        const parts = r.split('|');
        const year = parseInt(parts[0]);
        if (isNaN(year)) { alert('AI 无法提取年份信息'); return; }
        useWorldStore.getState().addTimelineEvent(useWorldStore.getState().worldsData[useWorldStore.getState().current]?.timelines[0]?.id || '', { label: parts[1] || d.title, year, color: '#8b5cf6' });
        alert('已创建时间轴事件！');
      } catch (e: any) { alert('转化失败：' + (e.message || e)); }
    }
  };

  return (div.textContent || '').trim().length > 0;
}

export function DraftsView() {
  const drafts = useWorldStore((s) => s.worldsData[s.current]?.drafts ?? []);
  const addDraft = useWorldStore((s) => s.addDraft);
  const updateDraft = useWorldStore((s) => s.updateDraft);
  const deleteDraft = useWorldStore((s) => s.deleteDraft);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter((d) => d.title.toLowerCase().includes(q) || (d.content || '').toLowerCase().includes(q));
  }, [drafts, search]);

  const selected = filtered.find((d) => d.id === selectedId) ?? filtered[0];

  // 新建草稿：默认 title="新草稿 N"，空 content
  const onAdd = () => {
    const name = `新草稿 ${drafts.length + 1}`;
    addDraft(name, '');
    // 选中新加的（通常在末尾）
    setTimeout(() => setSelectedId(null), 0);
  };

  
  const doAIAnalyze = async (d: any) => {
    if (!d) return;
    const cfg = useAIStore.getState().getCurrent();
    if (!cfg) { alert('请先在设置中配置 AI API'); return; }
    try {
      const r = await chatOnce(cfg, [{ role: 'user', content: `请分析以下草稿内容，提取关键信息（摘要、角色、地点、时间点）：\n\n${(d.content || '').replace(/<[^>]+>/g, '')}` }], { feature: 'draft-analyze' });
      alert('AI 分析结果：\n' + r);
    } catch (e: any) { alert('AI 分析失败：' + (e.message || e)); }
  };
  const doAIConvert = async (d: any, type: 'doc' | 'timeline') => {
    if (!d) return;
    const cfg = useAIStore.getState().getCurrent();
    if (!cfg) { alert('请先在设置中配置 AI API'); return; }
    const text = (d.content || '').replace(/<[^>]+>/g, '');
    if (type === 'doc') {
      useWorldStore.getState().addDoc(d.title || '来自草稿', useWorldStore.getState().worldsData[useWorldStore.getState().current]?.folders[0] || '未分组');
      alert('已转化为文档！');
    } else {
      try {
        const r = await chatOnce(cfg, [{ role: 'user', content: `从以下内容中提取一个时间点（年份数字）和事件名称，只输出"年份|事件名"格式，不要其他文字：\n\n${text}` }], { feature: 'draft-analyze' });
        const parts = r.split('|');
        const year = parseInt(parts[0]);
        if (isNaN(year)) { alert('AI 无法提取年份信息'); return; }
        useWorldStore.getState().addTimelineEvent(useWorldStore.getState().worldsData[useWorldStore.getState().current]?.timelines[0]?.id || '', { label: parts[1] || d.title, year, color: '#8b5cf6' });
        alert('已创建时间轴事件！');
      } catch (e: any) { alert('转化失败：' + (e.message || e)); }
    }
  };

  return (
    <div className="editor-scroll">
      <div className="editor-wrap drafts-page">
        <div className="drafts-page-head">
          <h2>草稿箱</h2>
          <div className="drafts-page-tools">
            <input
              type="text"
              placeholder="搜索草稿标题或内容"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="drafts-search"
            />
            <button className="mode-btn active" onClick={onAdd}>＋ 新建草稿</button>
          </div>
        </div>
        <p className="tip">共 {drafts.length} 条，当前过滤后 {filtered.length} 条 · 修改自动保存（标题非"未命名"或内容非空时）</p>

        <div className="drafts-grid">
          <div className="drafts-cards">
            {filtered.length === 0 ? (
              <div className="placeholder-view" style={{ flex: 1, minHeight: 300 }}>
                <div className="big">草稿</div>
                <div>{search ? '没有匹配此搜索的草稿' : '暂无草稿，点「＋ 新建草稿」快速记录想法'}</div>
              </div>
            ) : filtered.map((d) => (
              <div
                key={d.id}
                className={'draft-card' + (selected?.id === d.id ? ' active' : '')}
                onClick={() => setSelectedId(d.id)}
              >
                <div className="draft-card-title">{d.title}</div>
                <div className="draft-card-preview">{(d.content || '').replace(/<[^>]+>/g, '').slice(0, 80) || '(无内容)'}</div>
                <div className="draft-card-meta">{new Date(d.createdAt).toLocaleString('zh-CN')}</div>
              </div>
            ))}
          </div>
          <div className="draft-detail">
            {selected ? (
              <DraftEditor
                key={selected.id}
                id={selected.id}
                title={selected.title}
                content={selected.content}
                onAIAnalyze={() => doAIAnalyze(selected)}
                onAIConvert={(type) => () => doAIConvert(selected, type)}
                onChangeTitle={(t) => updateDraft(selected.id, t, selected.content)}
                onChangeContent={(c) => updateDraft(selected.id, selected.title, c)}
                onDelete={() => { if (window.confirm('删除该草稿？')) { deleteDraft(selected.id); setSelectedId(null); } }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function DraftEditor({
  id, title, content, onChangeTitle, onChangeContent, onDelete, onAIConvert, onAIAnalyze,
}: {
  id: string; title: string; content: string;
  onChangeTitle: (t: string) => void;
  onChangeContent: (c: string) => void;
  onDelete: () => void;
  onAIAnalyze: () => void;
  onAIConvert: (type: 'doc' | 'timeline') => () => void;
}) {
  const debounceRef = useRef<number | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: '在这里输入内容…（富文本：可加粗、斜体、列表、引用、代码等）' }),
    ],
    content: content || '',
    onUpdate: ({ editor }) => {
      // 防抖 600ms 自动保存
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const html = editor.getHTML();
        // 仅在"标题非未命名"或"内容非空"时保存
        const t = (document.getElementById(`draft-title-${id}`) as HTMLInputElement | null)?.value ?? title;
        if (t.trim() !== '未命名' || hasText(html)) {
          onChangeContent(html === '<p></p>' ? '' : html);
        }
      }, 600);
    },
  }, [id]);

  // 标题自动保存：失焦 / 输入后 600ms
  const onTitleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      if (v.trim() !== '未命名' || hasText(editor?.getHTML() || '')) {
        onChangeTitle(v);
      }
    }, 600);
  };

  
  const doAIAnalyze = async (d: any) => {
    if (!d) return;
    const cfg = useAIStore.getState().getCurrent();
    if (!cfg) { alert('请先在设置中配置 AI API'); return; }
    try {
      const r = await chatOnce(cfg, [{ role: 'user', content: `请分析以下草稿内容，提取关键信息（摘要、角色、地点、时间点）：\n\n${(d.content || '').replace(/<[^>]+>/g, '')}` }], { feature: 'draft-analyze' });
      alert('AI 分析结果：\n' + r);
    } catch (e: any) { alert('AI 分析失败：' + (e.message || e)); }
  };
  const doAIConvert = async (d: any, type: 'doc' | 'timeline') => {
    if (!d) return;
    const cfg = useAIStore.getState().getCurrent();
    if (!cfg) { alert('请先在设置中配置 AI API'); return; }
    const text = (d.content || '').replace(/<[^>]+>/g, '');
    if (type === 'doc') {
      useWorldStore.getState().addDoc(d.title || '来自草稿', useWorldStore.getState().worldsData[useWorldStore.getState().current]?.folders[0] || '未分组');
      alert('已转化为文档！');
    } else {
      try {
        const r = await chatOnce(cfg, [{ role: 'user', content: `从以下内容中提取一个时间点（年份数字）和事件名称，只输出"年份|事件名"格式，不要其他文字：\n\n${text}` }], { feature: 'draft-analyze' });
        const parts = r.split('|');
        const year = parseInt(parts[0]);
        if (isNaN(year)) { alert('AI 无法提取年份信息'); return; }
        useWorldStore.getState().addTimelineEvent(useWorldStore.getState().worldsData[useWorldStore.getState().current]?.timelines[0]?.id || '', { label: parts[1] || d.title, year, color: '#8b5cf6' });
        alert('已创建时间轴事件！');
      } catch (e: any) { alert('转化失败：' + (e.message || e)); }
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <input
          id={`draft-title-${id}`}
          defaultValue={title}
          onChange={onTitleInput}
          placeholder="草稿标题"
          className="draft-title-input"
        />
        <button className="mode-btn" onClick={onAIConvert('timeline')} title="用 AI 从内容中提取关键时间点，创建时间轴事件">转事件</button>
          <button className="mode-btn" onClick={onAIConvert('doc')} title="用 AI 从内容中提取要点，创建新文档">转文档</button>
          <button className="mode-btn" onClick={onAIAnalyze} title="用 AI 分析内容结构，提取摘要">分析</button>
          <button className="mode-btn danger" onClick={onDelete} style={{ marginLeft: 'auto' }}>删除</button>
      </div>
      <div className="draft-detail-meta">{new Date().toLocaleString('zh-CN')} · 自动保存中</div>
      <div className="draft-richtext">
        {editor && (
          <>
            <div className="rt-toolbar">
              <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'active' : ''} title="加粗"><b>B</b></button>
              <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'active' : ''} title="斜体"><i>I</i></button>
              <button onClick={() => editor.chain().focus().toggleStrike().run()} className={editor.isActive('strike') ? 'active' : ''} title="删除线"><s>S</s></button>
              <span className="rt-sep" />
              <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? 'active' : ''} title="标题1">H1</button>
              <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? 'active' : ''} title="标题2">H2</button>
              <span className="rt-sep" />
              <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'active' : ''} title="列表">•</button>
              <button onClick={() => editor.chain().focus().toggleBlockquote().run()} className={editor.isActive('blockquote') ? 'active' : ''} title="引用">❝</button>
              <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive('codeBlock') ? 'active' : ''} title="代码块">{'</>'}</button>
            </div>
            <EditorContent editor={editor} className="rt-content" />
          </>
        )}
      </div>
    </>
  );
}
