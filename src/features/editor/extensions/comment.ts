import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CommentView } from './commentView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (content?: string) => ReturnType;
    };
  }
}

export const Comment = Node.create({
  name: 'comment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-comment') || '',
        renderHTML: (attrs) => ({ 'data-comment': attrs.content }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-comment': '', class: 'comment-mark' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CommentView);
  },

  addCommands() {
    return {
      setComment:
        (content = '') =>
        ({ chain }) =>
          chain().focus().insertContent({ type: this.name, attrs: { content } }).run(),
    };
  },
});
