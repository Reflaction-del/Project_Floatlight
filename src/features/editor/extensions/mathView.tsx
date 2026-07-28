import { useState, useMemo, useEffect } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

function renderToHtml(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex || '', { throwOnError: false, displayMode });
  } catch {
    return `<span class="math-error">${latex}</span>`;
  }
}

function MathEditor({
  draft,
  setDraft,
  commit,
  cancel,
}: {
  draft: string;
  setDraft: (v: string) => void;
  commit: () => void;
  cancel: () => void;
}) {
  return (
    <input
      className="math-input"
      value={draft}
      autoFocus
      placeholder="输入 LaTeX，如 E = mc^2"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
    />
  );
}

export function MathViewInline({ node, updateAttributes, editor }: NodeViewProps) {
  const latex = (node.attrs.latex as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  useEffect(() => setDraft(latex), [latex]);
  const html = useMemo(() => renderToHtml(latex, false), [latex]);

  if (editing) {
    return (
      <NodeViewWrapper as="span" className="math-inline editing" contentEditable={false}>
        <MathEditor
          draft={draft}
          setDraft={setDraft}
          commit={() => {
            updateAttributes({ latex: draft });
            setEditing(false);
          }}
          cancel={() => setEditing(false)}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className="math-inline"
      contentEditable={false}
      onDoubleClick={() => {
        if (editor.isEditable) {
          setDraft(latex);
          setEditing(true);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html || '<span class="math-empty">∑</span>' }}
    />
  );
}

export function MathViewBlock({ node, updateAttributes, editor }: NodeViewProps) {
  const latex = (node.attrs.latex as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  useEffect(() => setDraft(latex), [latex]);
  const html = useMemo(() => renderToHtml(latex, true), [latex]);

  if (editing) {
    return (
      <NodeViewWrapper className="math-block editing" contentEditable={false}>
        <MathEditor
          draft={draft}
          setDraft={setDraft}
          commit={() => {
            updateAttributes({ latex: draft });
            setEditing(false);
          }}
          cancel={() => setEditing(false)}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className="math-block"
      contentEditable={false}
      onDoubleClick={() => {
        if (editor.isEditable) {
          setDraft(latex);
          setEditing(true);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html || '<span class="math-empty">∑ 数学块（双击编辑）</span>' }}
    />
  );
}
