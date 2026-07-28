import { useState, useEffect } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

export function CommentView({ node, updateAttributes, editor }: NodeViewProps) {
  const content = (node.attrs.content as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  useEffect(() => setDraft(content), [content]);

  return (
    <NodeViewWrapper as="span" className="comment-mark" contentEditable={false}>
      <span
        className="comment-anchor"
        title="双击编辑评论"
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (editor.isEditable) {
            setDraft(content);
            setEditing(true);
          }
        }}
      >
        评
      </span>
      {content && !editing && <span className="comment-pop">{content}</span>}
      {editing && (
        <span className="comment-edit">
          <input
            className="comment-input"
            value={draft}
            autoFocus
            placeholder="输入评论内容"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              updateAttributes({ content: draft });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateAttributes({ content: draft });
                setEditing(false);
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
          />
        </span>
      )}
    </NodeViewWrapper>
  );
}
