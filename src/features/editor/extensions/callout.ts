import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CalloutView } from './calloutView';

export type CalloutType = 'note' | 'warning' | 'info' | 'success' | 'danger' | 'question';

export const CALLOUT_TYPES: CalloutType[] = ['note', 'warning', 'info', 'success', 'danger', 'question'];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attributes?: { type?: CalloutType; title?: string }) => ReturnType;
      toggleCallout: (attributes?: { type?: CalloutType; title?: string }) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note' as CalloutType,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-callout-type') || 'note',
        renderHTML: (attrs) => ({ 'data-callout-type': attrs.type }),
      },
      title: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-callout-title') || '',
        renderHTML: (attrs) => ({ 'data-callout-title': attrs.title }),
      },
      collapsed: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-callout-collapsed') === 'true',
        renderHTML: (attrs) => ({ 'data-callout-collapsed': attrs.collapsed ? 'true' : 'false' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-callout': '', class: 'callout' }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attrs),
    };
  },
});
