import { useEffect, useState, useRef } from 'react';
import { useEditor, EditorContent, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Underline from '@tiptap/extension-underline';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ImageWrap } from './extensions/imageWrap';
import { FontSize } from './extensions/fontSize';
import { WikiLink, KeywordMention, EntityAutocomplete, BracketTrigger } from './extensions/wikiLink';
import { Highlight } from './extensions/highlight';
import { InlineMath, MathBlock } from './extensions/math';
import { Callout } from './extensions/callout';
import { Footnote, resetFootnoteSeq } from './extensions/footnote';
import { Comment } from './extensions/comment';
import { TrailingNode } from './extensions/trailingNode';
import { EditorContextMenu } from './EditorContextMenu';
import { useWorldStore } from '../../store/worldStore';
import type { EditorMode } from '../../store/uiStore';
import { docToMarkdown } from '../../utils/markdown';

const lsKey = (id: string) => `fl-doc-${id}`;

function initialContent(id: string, fallback: unknown) {
  try {
    const s = localStorage.getItem(lsKey(id));
    if (s) return JSON.parse(s);
  } catch {
    /* ignore */
  }
  return fallback;
}

function collectFootnotes(editor: TiptapEditor | null): { id: string; content: string }[] {
  const list: { id: string; content: string }[] = [];
  if (!editor) return list;
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'footnote' && n.attrs.id) {
      list.push({ id: String(n.attrs.id), content: String(n.attrs.content || '') });
    }
  });
  return list;
}

const FONT_FAMILIES = [
  { value: '', label: '默认字体' },
  { value: 'inherit', label: '系统默认' },
  { value: '"PingFang SC", "Microsoft YaHei", sans-serif', label: '苹方 / 雅黑' },
  { value: '"Songti SC", "SimSun", serif', label: '宋体' },
  { value: '"Heiti SC", "SimHei", sans-serif', label: '黑体' },
  { value: '"Kaiti SC", "KaiTi", serif', label: '楷体' },
  { value: 'serif', label: '衬线 Serif' },
  { value: 'monospace', label: '等宽 Mono' },
];

const FONT_SIZES = [
  { value: '', label: '默认' },
  { value: '12px', label: '12' },
  { value: '14px', label: '14' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '20px', label: '20' },
  { value: '24px', label: '24' },
  { value: '28px', label: '28' },
  { value: '32px', label: '32' },
];

function Toolbar({ editor, docId, docTitle }: { editor: TiptapEditor | null; docId: string; docTitle: string }) {
  if (!editor) return null;
  const [showExportMenu, setShowExportMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const btn = (label: string, onClick: () => void, active = false, tip?: string, inlineStyle?: React.CSSProperties) => (
    <button
      className={'mode-btn' + (active ? ' active' : '')}
      style={{ marginRight: 4, ...(inlineStyle || {}) }}
      title={tip || label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );

  // 点击外部关闭菜单
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const onInsertImage = async () => {
    const dataUrl = await window.api?.openImage?.();
    if (dataUrl)
      (editor.chain().focus() as any).setImage({ src: dataUrl, align: 'center' }).run();
  };

  /** 导出为 Markdown */
  const onExportMarkdown = async () => {
    setShowExportMenu(false);
    const json = editor.getJSON();
    const md = docToMarkdown(json);
    if (!md) return;
    const ok = await window.api?.exportFile?.((docTitle || '文档') + '.md', md);
    void ok; // 用户取消时 ok=false，无需处理
  };

  /** 导出为 PDF（通过 Electron 主进程 printToPDF）*/
  const onExportPdf = async () => {
    setShowExportMenu(false);
    const html = editor.getHTML();
    if (!html) return;
    const ok = await window.api?.exportPdf?.(html, docTitle || '文档');
    void ok; // 用户取消或失败时 ok=false，无需处理
  };

  return (
    <div className="main-head" style={{ height: 'auto', flexWrap: 'wrap', padding: '8px 12px', gap: 6 }}>
      {btn('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), '加粗 (Ctrl+B)', { fontWeight: 700 })}
      {btn('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), '斜体 (Ctrl+I)', { fontStyle: 'italic' })}
      {btn('U', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), '下划线 (Ctrl+U)', { textDecoration: 'underline' })}
      {btn('S', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'), '删除线', { textDecoration: 'line-through' })}
      <span className="divider" style={{ width: 1, height: 22, margin: '0 4px' }} />
      {btn('H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }), '一级标题', { fontSize: 18, fontWeight: 700, lineHeight: 1.2 })}
      {btn('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }), '二级标题', { fontSize: 16, fontWeight: 700, lineHeight: 1.2 })}
      {btn('• 列表', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), '无序列表')}
      {btn('❝', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'), '引用块', { fontStyle: 'italic', color: 'var(--fg-muted)' })}
      <span className="divider" style={{ width: 1, height: 22, margin: '0 4px' }} />
      {/* 字体 */}
      <input
        className="mode-btn"
        list="font-families-list"
        placeholder="字体"
        title="字体名称"
        onChange={(e) => {
          const v = e.target.value;
          if (!v) (editor.chain().focus() as any).unsetFontFamily().run();
          else (editor.chain().focus() as any).setFontFamily(v).run();
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        style={{ width: 80, fontSize: 12 }}
      />
      <datalist id="font-families-list">
        {FONT_FAMILIES.map((f) => f.value && <option key={f.value} value={f.value}>{f.label}</option>)}
      </datalist>
      <select
        className="mode-btn"
        defaultValue=""
        title="字号"
        onChange={(e) => {
          const v = e.target.value;
          if (!v) (editor.chain().focus() as any).unsetFontSize().run();
          else (editor.chain().focus() as any).setFontSize(v).run();
        }}
      >
        {FONT_SIZES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <label className="mode-btn font-color" title="文字颜色">
        <span style={{ fontSize: 12 }}>A</span>
        <input
          type="color"
          style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}
          onChange={(e) => (editor.chain().focus() as any).setColor(e.target.value).run()}
        />
      </label>
      {btn('默认色', () => (editor.chain().focus() as any).unsetColor().run())}
      <span className="divider" style={{ width: 1, height: 22, margin: '0 4px' }} />
      <button className="mode-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="插入表格" style={{ fontSize: 13 }}>⊞ 表格</button>
      {editor.isActive('table') && (<>
        <button className="mode-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => (editor.chain().focus() as any).addRowAfter().run()} title="下方加行" style={{ fontSize: 13 }}>＋行</button>
        <button className="mode-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => (editor.chain().focus() as any).deleteRow().run()} title="删除当前行" style={{ fontSize: 13 }}>－行</button>
        <button className="mode-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => (editor.chain().focus() as any).addColumnAfter().run()} title="右侧加列" style={{ fontSize: 13 }}>＋列</button>
        <button className="mode-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => (editor.chain().focus() as any).deleteColumn().run()} title="删除当前列" style={{ fontSize: 13 }}>－列</button>
        <button className="mode-btn danger" onMouseDown={(e) => e.preventDefault()} onClick={() => (editor.chain().focus() as any).deleteTable().run()} title="删除整个表格" style={{ fontSize: 13 }}>删表</button>
      </>)}
      <span className="divider" style={{ width: 1, height: 22, margin: '0 4px' }} />
      <button className="mode-btn" onMouseDown={(e) => e.preventDefault()} onClick={onInsertImage}>
        插图
      </button>
      {/* 导出按钮：PDF / Markdown */}
      <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button
          className={'mode-btn' + (showExportMenu ? ' active' : '')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowExportMenu((v) => !v)}
          title="导出文档"
        >
          ⤵ 导出
        </button>
        {showExportMenu && (
          <div className="export-menu" style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #e0e0e0)',
            borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 999,
            minWidth: 140, overflow: 'hidden', padding: 4,
          }}>
            <button className="export-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={onExportPdf}>
              导出为 PDF
            </button>
            <button className="export-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={onExportMarkdown}>
              导出为 Markdown
            </button>
          </div>
        )}
      </div>
      <span className="spacer" />
      <span className="tip">输入 [[ 或 @ 唤起双链 / 关键词联想</span>
    </div>
  );
}

export function Editor({ docId, mode }: { docId: string; mode: EditorMode }) {
  const doc = useWorldStore((s) => s.worldsData[s.current]?.docs.find((d) => d.id === docId));
  const updateDocContent = useWorldStore((s) => s.updateDocContent);
  const [html, setHtml] = useState('');
  const [zoom, setZoom] = useState(1);
  const [footnotes, setFootnotes] = useState<{ id: string; content: string }[]>([]);

  const safeContent = doc?.content ?? { type: 'doc', content: [] };

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontFamily,
      Underline,
      FontSize,
      Placeholder.configure({ placeholder: '开始写作，输入 [[ 或 @ 唤起双链；直接输入实体名前缀即可在光标处唤起候选（Tab/空格 插入）…' }),
      ImageWrap,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      WikiLink,
      KeywordMention,
      EntityAutocomplete,
      BracketTrigger,
      Highlight,
      InlineMath,
      MathBlock,
      Callout,
      Footnote,
      Comment,
      TrailingNode,
    ],
    content: initialContent(docId, safeContent),
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      updateDocContent(docId, json);
      try {
        localStorage.setItem(lsKey(docId), JSON.stringify(json));
      } catch {
        /* ignore */
      }
      setHtml(editor.getHTML());
      setFootnotes(collectFootnotes(editor));
    },
  });

  useEffect(() => {
    if (!editor) return;
    setHtml(editor.getHTML());
    let maxId = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'footnote') {
        const id = Number(n.attrs.id) || 0;
        if (id > maxId) maxId = id;
      }
    });
    resetFootnoteSeq(maxId + 1);
    setFootnotes(collectFootnotes(editor));
  }, [editor, docId]);

  // 响应全局快捷键的撤销/重做（由 App 的 keymap 分发，避免脱离编辑器撤销栈）
  useEffect(() => {
    if (!editor) return;
    const onUndo = () => editor.commands.undo();
    const onRedo = () => editor.commands.redo();
    window.addEventListener('fg-editor-undo', onUndo);
    window.addEventListener('fg-editor-redo', onRedo);
    return () => {
      window.removeEventListener('fg-editor-undo', onUndo);
      window.removeEventListener('fg-editor-redo', onRedo);
    };
  }, [editor]);

  if (!doc) return null;

  return (
    <>
      <EditorContextMenu editor={editor} />
      <Toolbar editor={editor} docId={docId} docTitle={doc?.title || '文档'} />
      <div className="editor-scroll" onWheel={(e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setZoom((z) => Math.max(0.3, Math.min(3, z * (e.deltaY > 0 ? 0.9 : 1.1))));
      }}>
        <div style={{ zoom, transformOrigin: 'top center' }}>
        {mode === 'split' ? (
          <div className="editor-wrap split">
            <EditorContent editor={editor} />
            <div
              className="ProseMirror"
              style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16 }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        ) : (
          <div className="editor-wrap">
            <EditorContent editor={editor} />
          </div>
        )}
        {footnotes.length > 0 && (
          <div className="footnotes" contentEditable={false}>
            <div className="footnotes-title">脚注</div>
            {footnotes.map((f) => (
              <div key={f.id} id={'footnote-' + f.id} className="footnote-item">
                <sup>[{f.id}]</sup> <span>{f.content}</span>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </>
  );
}
