import { Mark, mergeAttributes } from '@tiptap/core';

export interface HighlightOptions {
  multicolor?: boolean;
  defaultColor?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      setHighlight: (attributes?: { color?: string }) => ReturnType;
      toggleHighlight: (attributes?: { color?: string }) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}

export const Highlight = Mark.create<HighlightOptions>({
  name: 'highlight',

  addOptions() {
    return {
      multicolor: true,
      defaultColor: '#FFFB7A',
    };
  },

  addAttributes() {
    return {
      color: {
        default: this.options.defaultColor,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-color') || this.options.defaultColor,
        renderHTML: (attrs) => ({ 'data-color': attrs.color, style: `background-color: ${attrs.color}` }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'mark[data-highlight]' },
      { style: 'background-color' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes({ 'data-highlight': '' }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlight:
        (attrs = {}) =>
        ({ commands }) => {
          return commands.setMark(this.name, attrs);
        },
      toggleHighlight:
        (attrs = {}) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attrs);
        },
      unsetHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },
});
