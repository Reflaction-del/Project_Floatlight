import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MathViewInline, MathViewBlock } from './mathView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineMath: {
      setInlineMath: (content?: string) => ReturnType;
    };
    mathBlock: {
      setMathBlock: (content?: string) => ReturnType;
    };
  }
}

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-latex') || '',
        renderHTML: (attrs) => ({ 'data-latex': attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-inline-math]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-inline-math': '', class: 'math-inline' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathViewInline);
  },

  addCommands() {
    return {
      setInlineMath:
        (content = '') =>
        ({ chain }) =>
          chain().focus().insertContent({ type: this.name, attrs: { latex: content } }).run(),
    };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-latex') || '',
        renderHTML: (attrs) => ({ 'data-latex': attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-math-block': '', class: 'math-block' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathViewBlock);
  },

  addCommands() {
    return {
      setMathBlock:
        (content = '') =>
        ({ chain }) =>
          chain().focus().insertContent({ type: this.name, attrs: { latex: content } }).run(),
    };
  },
});
