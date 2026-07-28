import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * 自动在文档末尾追加一个空段落，当最后一个节点是「无法直接在其后输入」的块级节点时。
 * 解决：代码块、表格、数学块、标注、分隔线等后面无法点击继续输入的问题。
 */
const TRAILING_NODE_TYPES = ['codeBlock', 'table', 'mathBlock', 'callout', 'horizontalRule'];

export const TrailingNode = Extension.create({
  name: 'trailingNode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingNode'),
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const lastNode = newState.doc.lastChild;
          if (!lastNode) return null;
          if (!TRAILING_NODE_TYPES.includes(lastNode.type.name)) return null;
          const { schema, doc } = newState;
          const paragraph = schema.nodes.paragraph;
          if (!paragraph) return null;
          const tr = newState.tr.insert(doc.content.size, paragraph.create());
          return tr;
        },
      }),
    ];
  },
});
