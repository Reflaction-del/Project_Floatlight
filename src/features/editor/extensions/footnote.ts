import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FootnoteView } from './footnoteView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      setFootnote: (content?: string) => ReturnType;
    };
  }
}

let footnoteSeq = 1;
export function resetFootnoteSeq(start = 1) {
  footnoteSeq = start;
}

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-footnote-id') || '',
        renderHTML: (attrs) => ({ 'data-footnote-id': attrs.id }),
      },
      content: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-footnote-content') || '',
        renderHTML: (attrs) => ({ 'data-footnote-content': attrs.content }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes({ 'data-footnote': '', class: 'footnote-ref' }, HTMLAttributes),
      `[${HTMLAttributes['data-footnote-id']}]`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView);
  },

  addCommands() {
    return {
      setFootnote:
        (content = '') =>
        ({ chain }) => {
          const id = String(footnoteSeq++);
          return chain().focus().insertContent({ type: this.name, attrs: { id, content } }).run();
        },
    };
  },
});
