import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import tippy from 'tippy.js';
import { makeRender } from './suggestionUI';
import { useWorldStore } from '../../../store/worldStore';
import { ENTITY_LABEL } from '../../../types';
import type { WikiElementType } from '../../../types';

const TYPE_LABEL: Record<WikiElementType, string> = {
  character: '角色', location: '地点', item: '物品', faction: '组织', concept: '概念', document: '文档',
};

const STATIC_ELEMENTS = [
  { id: 'el-char-1', name: '林夜', type: 'character' as WikiElementType },
  { id: 'el-char-2', name: '苏璃', type: 'character' as WikiElementType },
  { id: 'el-loc-1', name: '云隐城', type: 'location' as WikiElementType },
  { id: 'el-fac-1', name: '守夜人', type: 'faction' as WikiElementType },
  { id: 'el-con-1', name: '灵脉', type: 'concept' as WikiElementType },
  { id: 'ev-1', name: '星陨之夜', type: 'document' as WikiElementType },
];

interface SuggestItem {
  targetId: string;
  label: string;
  kind: string;
}

function kindOf(type: string): string {
  if (type in ENTITY_LABEL) return ENTITY_LABEL[type as keyof typeof ENTITY_LABEL];
  return TYPE_LABEL[type as WikiElementType] ?? type;
}

function queryElements(q: string): SuggestItem[] {
  const needle = q.toLowerCase();
  const state = useWorldStore.getState();
  const world = state.worldsData[state.current];
  const ents = (world?.entities ?? []).map((e) => ({ id: e.id, name: e.name, type: e.type }));
  const isDemo = (world?.seedVersion ?? 0) > 0;
  const seen = new Set(ents.map((e) => e.id));
  const all = isDemo ? [...ents, ...STATIC_ELEMENTS.filter((s) => !seen.has(s.id))] : ents;
  return all
    .filter((e) => e.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((e) => ({ targetId: e.id, label: e.name, kind: kindOf(e.type) }));
}

/** 双链节点：渲染为可点击 chip；`[[` 触发搜索补全 */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      targetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-target'),
        renderHTML: (a) => (a.targetId ? { 'data-target': a.targetId } : {}),
      },
      label: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-wikilink': '', class: 'wikilink' }),
      node.attrs.label,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },

  addCommands() {
    return {
      insertWikiLink:
        (attrs: { targetId: string; label: string }) =>
        ({ chain }: any) =>
          chain().insertContent({ type: this.name, attrs }).run(),
    } as any;
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '[[',
        pluginKey: new PluginKey('wikiLinkSuggestion'),
        items: ({ query }: { query: string }) => queryElements(query),
        render: makeRender(),
        command: ({ editor, range, props }: any) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({ type: 'wikiLink', attrs: { targetId: props.targetId, label: props.label } })
            .run();
        },
      }),
    ];
  },
});

/** 关键词联想：`@` 触发，同样插入双链 chip（世界语料补全）。
 *  作为 Extension 仅注入 suggestion 插件，复用 wikiLink 节点，避免节点名冲突。 */
export const KeywordMention = Extension.create({
  name: 'keywordMention',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '@',
        pluginKey: new PluginKey('keywordMention'),
        items: ({ query }: { query: string }) => queryElements(query),
        render: makeRender(),
        command: ({ editor, range, props }: any) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({ type: 'wikiLink', attrs: { targetId: props.targetId, label: props.label } })
            .run();
        },
      }),
    ];
  },
});

/** 全角/半角统一为半角并转小写，用于忽略大小写与全半角的匹配 */
function normalize(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0);
    else out += ch;
  }
  return out.toLowerCase();
}

/** 当前词前缀/整词匹配实体（忽略大小写/全半角） */
function queryEntityPrefix(q: string): SuggestItem[] {
  const needle = normalize(q);
  if (!needle) return [];
  const state = useWorldStore.getState();
  const world = state.worldsData[state.current];
  const ents = (world?.entities ?? []).map((e) => ({ id: e.id, name: e.name, type: e.type }));
  const isDemo = (world?.seedVersion ?? 0) > 0;
  const seen = new Set(ents.map((e) => e.id));
  const all = isDemo ? [...ents, ...STATIC_ELEMENTS.filter((s) => !seen.has(s.id))] : ents;
  return all
    .filter((e) => normalize(e.name).startsWith(needle))
    .slice(0, 8)
    .map((e) => ({ targetId: e.id, label: e.name, kind: kindOf(e.type) }));
}

/**
 * 输入时实体自动补全：用户正常打字，当“当前词”是实体名的前缀/整词
 * （忽略大小写/全半角，≥2 字）时，在光标处弹出候选；
 * Tab / Shift+Tab 移动高亮，Space / Enter 插入选中实体（双链）并补一个空格，Esc 关闭。
 * 仅在纯文本输入时触发（[[ 与 @ 触发器由 WikiLink / KeywordMention 处理）。
 */
export const EntityAutocomplete = Extension.create({
  name: 'entityAutocomplete',

  addProseMirrorPlugins() {
    const ext = this;
    // 跨 handleKeyDown 与 view.update 共享的候选状态
    const box: {
      items: SuggestItem[];
      selected: number;
      range: { from: number; to: number } | null;
      popup: any;
      view: any;
    } = { items: [], selected: 0, range: null, popup: null, view: null };

    const escapeHtmlLocal = (s: string) =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

    const close = () => {
      if (box.popup) {
        box.popup.destroy();
        box.popup = null;
      }
      box.items = [];
      box.selected = 0;
      box.range = null;
    };

    const buildList = () => {
      const el = document.createElement('div');
      el.className = 'suggest-pop';
      if (!box.items.length) {
        const empty = document.createElement('div');
        empty.className = 'suggest-item';
        empty.textContent = '无匹配';
        el.appendChild(empty);
        return el;
      }
      box.items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'suggest-item' + (i === box.selected ? ' sel' : '');
        row.innerHTML = `<span>${escapeHtmlLocal(it.label)}</span><span class="suggest-kind">${it.kind}</span>`;
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          applyItem(it);
        });
        el.appendChild(row);
      });
      return el;
    };

    const refreshPopup = () => {
      if (!box.items.length) {
        if (box.popup) {
          box.popup.destroy();
          box.popup = null;
        }
        return;
      }
      if (box.popup) {
        box.popup.setProps({ content: buildList() });
      } else if (box.view) {
        const inst = tippy(document.body, {
          getReferenceClientRect: () => {
            const c = box.view.coordsAtPos(box.range!.to);
            return { left: c.left, top: c.bottom, bottom: c.bottom, right: c.left, width: 0, height: 0 } as any;
          },
          appendTo: document.body,
          content: buildList(),
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          arrow: false,
          theme: 'light',
        });
        box.popup = Array.isArray(inst) ? inst[0] : inst;
      }
    };

    const applyItem = (it: SuggestItem) => {
      if (!box.range) return;
      ext.editor
        .chain()
        .focus()
        .deleteRange(box.range)
        .insertContent({ type: 'wikiLink', attrs: { targetId: it.targetId, label: it.label } })
        .insertContent(' ')
        .run();
      close();
    };

    const detect = () => {
      const view = box.view;
      if (!view) return;
      const sel = view.state.selection;
      if (!sel.empty) {
        close();
        return;
      }
      const $from = sel.$from;
      const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
      const m = textBefore.match(/[^\s，。、；：！？“”‘’（）《》【】…—~!@#%^&*()_+\-=[\]{}|\\;:'",.<>/?`]+$/);
      if (!m) {
        close();
        return;
      }
      const word = m[0];
      if (word.length < 2) {
        close();
        return;
      }
      const before = textBefore.slice(0, textBefore.length - word.length);
      if (before.endsWith('[[') || before.endsWith('@')) {
        close();
        return;
      }
      const matches = queryEntityPrefix(word);
      if (!matches.length) {
        close();
        return;
      }
      box.items = matches;
      box.selected = 0;
      box.range = { from: $from.pos - word.length, to: $from.pos };
      refreshPopup();
    };

    return [
      new Plugin({
        key: new PluginKey('entityAutocomplete'),
        view: (editorView) => {
          box.view = editorView;
          return {
            update: () => detect(),
            destroy: () => close(),
          };
        },
        props: {
          handleKeyDown: (view, event) => {
            if (!box.items.length || !box.range) return false;
            if ((view as any).composing) return false;
            if (event.key === 'Tab') {
              const n = box.items.length;
              box.selected = (box.selected + (event.shiftKey ? -1 : 1) + n) % n;
              refreshPopup();
              return true;
            }
            if (event.key === 'ArrowDown') {
              const n = box.items.length;
              box.selected = (box.selected + 1) % n;
              refreshPopup();
              return true;
            }
            if (event.key === 'ArrowUp') {
              const n = box.items.length;
              box.selected = (box.selected - 1 + n) % n;
              refreshPopup();
              return true;
            }
            if (event.key === ' ' || event.key === 'Enter') {
              const it = box.items[box.selected];
              if (it) applyItem(it);
              return true;
            }
            if (event.key === 'Escape') {
              close();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/**
 * 中文输入法兼容：在 1 秒内连续两次按下键盘左方括号键（`[` / `【`）即唤醒双链。
 * 监听物理按键 `event.code === 'BracketLeft'`，因为中文输入法下 `event.key`
 * 可能是 'Process' / 'Unidentified'，无法直接判断字符。
 * 检测到第二次按键时，删除光标前已输入的 1–2 个方括号类字符，并插入「[[」
 * 以复用 WikiLink 的 suggestion 触发逻辑。
 *
 * 触发双链后，中文输入法会在 keydown 之后强行再上屏一个「【」。
 * 因此在插入「[[」后的 100ms 内主动回格一次，删掉光标前那个残留的方括号字符，
 * 仅当光标前确为「【」或「[」时才回格，避免误删正常内容。
 */
export const BracketTrigger = Extension.create({
  name: 'bracketTrigger',

  addProseMirrorPlugins() {
    const lastBracket = { current: 0 };
    const BRACKET_RE = /^[【\[]$/;

    return [
      new Plugin({
        key: new PluginKey('bracketTrigger'),
        props: {
          handleKeyDown: (view, event) => {
            if (event.code !== 'BracketLeft') return false;
            if ((view as any).composing) return false;
            const now = Date.now();
            if (now - lastBracket.current < 1000) {
              event.preventDefault();
              const { $from } = view.state.selection;
              const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
              let deleteLen = 0;
              if (textBefore.endsWith('【【') || textBefore.endsWith('[[')) deleteLen = 2;
              else if (textBefore.endsWith('【') || textBefore.endsWith('[')) deleteLen = 1;
              let tr = view.state.tr;
              if (deleteLen > 0) tr = tr.delete($from.pos - deleteLen, $from.pos);
              tr = tr.insertText('[[');
              view.dispatch(tr);
              lastBracket.current = 0;
              // 触发双链后 100ms 内回格一次，删掉输入法上屏的残留「【」
              setTimeout(() => {
                const { $from: f } = view.state.selection;
                const ch = f.parent.textContent.slice(0, f.parentOffset).slice(-1);
                if (BRACKET_RE.test(ch)) {
                  view.dispatch(view.state.tr.delete(f.pos - 1, f.pos));
                }
              }, 100);
              return true;
            }
            lastBracket.current = now;
            return false;
          },
        },
      }),
    ];
  },
});
