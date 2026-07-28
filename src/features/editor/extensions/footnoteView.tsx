import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

export function FootnoteView({ node }: NodeViewProps) {
  const id = (node.attrs.id as string) || '';
  const content = (node.attrs.content as string) || '';

  const jump = () => {
    const el = document.getElementById('footnote-' + id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      window.setTimeout(() => el.classList.remove('flash'), 1200);
    }
  };

  return (
    <NodeViewWrapper as="sup" className="footnote-ref" contentEditable={false} title={content} onClick={jump}>
      [{id}]
    </NodeViewWrapper>
  );
}
