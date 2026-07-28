import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { useWorldStore } from '../../store/worldStore';
import { useUIStore } from '../../store/uiStore';
import { ENTITY_TEMPLATES } from '../../types';
import {
  IconNewEntity, IconTextFormat, IconText, IconBold, IconItalic, IconStrike, IconHighlight,
  IconCode, IconMath, IconComment, IconEraser, IconClearFormat, IconParagraph, IconHeading,
  IconListBullet, IconListOrdered, IconPlus, IconTable, IconHr, IconCodeBlock, IconCut,
  IconCopy, IconPaste, IconPastePlain, IconSelectAll, IconCopilot,
} from '../../components/icons';

interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  children?: MenuItem[];
  onClick?: () => void;
}

interface Pos {
  x: number;
  y: number;
}

interface EditorContextMenuProps {
  editor: TiptapEditor | null;
}

const PADDING = 8;

function clampMenuPos(x: number, y: number, width: number, height: number) {
  const maxX = window.innerWidth - width - PADDING;
  const maxY = window.innerHeight - height - PADDING;
  return { x: Math.max(PADDING, Math.min(x, maxX)), y: Math.max(PADDING, Math.min(y, maxY)) };
}

function MenuItemRow({
  item,
  onHover,
  active,
  onClickItem,
}: {
  item: MenuItem;
  onHover: (id: string | null) => void;
  active: boolean;
  onClickItem: (item: MenuItem) => void;
}) {
  const hasChildren = !!item.children && item.children.length > 0;
  return (
    <button
      className={'ecm-item' + (item.active ? ' active' : '') + (item.disabled ? ' disabled' : '') + (hasChildren ? ' has-children' : '')}
      disabled={item.disabled}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (!hasChildren) onClickItem(item);
      }}
    >
      <span className="ecm-icon">{item.icon}</span>
      <span className="ecm-label">{item.label}</span>
      {item.shortcut && <span className="ecm-shortcut">{item.shortcut}</span>}
      {hasChildren && <span className="ecm-arrow">›</span>}
    </button>
  );
}

function SubMenu({
  items,
  parentPos,
  parentHeight,
  onMouseEnter,
  onMouseLeave,
  onClickItem,
  activeItem,
  onHover,
}: {
  items: MenuItem[];
  parentPos: { x: number; y: number };
  parentHeight: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClickItem: (item: MenuItem) => void;
  activeItem: string | null;
  onHover: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const gap = 2;
    let x = parentPos.x + gap;
    if (x + rect.width > window.innerWidth - PADDING) {
      x = Math.max(PADDING, parentPos.x - rect.width - gap);
    }
    let y = parentPos.y;
    if (y + rect.height > window.innerHeight - PADDING) {
      y = Math.max(PADDING, window.innerHeight - rect.height - PADDING);
    }
    setPos({ x, y });
  }, [parentPos]);

  const menu = (
    <div
      ref={ref}
      className="ecm-menu ecm-submenu"
      style={{ left: pos.x, top: pos.y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {items.map((item) => (
        <MenuItemRow
          key={item.id}
          item={item}
          onHover={onHover}
          active={activeItem === item.id}
          onClickItem={onClickItem}
        />
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}

export function EditorContextMenu({ editor }: EditorContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [menuSize, setMenuSize] = useState({ width: 220, height: 320 });
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeTimerRef = useRef<number | null>(null);

  const selectedText = editor?.state.selection.empty ? '' : editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) || '';

  const closeMenu = useCallback(() => {
    setVisible(false);
    setActiveSubmenu(null);
  }, []);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.editor-wrap, .editor-scroll, .ProseMirror, .tiptap')) return;
      e.preventDefault();
      setVisible(true);
      setActiveSubmenu(null);
      requestAnimationFrame(() => {
        const rect = menuRef.current?.getBoundingClientRect();
        const size = rect ? { width: rect.width, height: rect.height } : { width: 220, height: 320 };
        setMenuSize(size);
        setPos(clampMenuPos(e.clientX, e.clientY, size.width, size.height));
      });
    },
    []
  );

  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  useEffect(() => {
    if (!visible) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 点击菜单内部（含 portal 子菜单）不关闭，留给按钮的 onClick 处理
      if (target.closest('.ecm-menu')) return;
      closeMenu();
    };
    const onScroll = () => closeMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [visible, closeMenu]);

  const run = (fn: () => void) => {
    if (!editor || editor.isDestroyed) return;
    fn();
    closeMenu();
  };

  const openCopilot = (text?: string) => {
    const ui = (window as any).__FG_UI__;
    if (ui?.setCopilot) ui.setCopilot(true);
    if (text) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('fg-copilot-context', { detail: text }));
      }, 50);
    } else {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('fg-copilot-focus'));
      }, 50);
    }
    closeMenu();
  };

  if (!editor) return null;

  const createEntityFromSelection = () => {
    if (!selectedText) {
      window.alert('请先选中一段文本，再据此新建实体。');
      return;
    }
    const name = selectedText.trim().replace(/\s+/g, ' ').slice(0, 60) || '未命名实体';
    const tpl = ENTITY_TEMPLATES.find((t) => t.type === 'character');
    const fields = (tpl?.fields ?? []).map((f) => ({
      label: f.label,
      value: '',
      kind: f.kind,
      entityType: f.entityType,
    }));
    const id = useWorldStore.getState().addEntity({
      type: 'character',
      name,
      fields,
      note: '通过编辑器右键菜单「从选区新建实体」创建',
    });
    useUIStore.getState().openTab({ title: name, kind: 'entity', ref: id });
  };

  const menuItems: MenuItem[] = [
    {
      id: 'new-entity',
      label: '从选区新建实体',
      icon: <IconNewEntity size={16} />,
      disabled: !selectedText,
      onClick: () => run(() => createEntityFromSelection()),
    },
    { id: 'sep1', label: '', onClick: () => {} },
    {
      id: 'format',
      label: '文本格式',
      icon: <IconTextFormat size={16} />,
      children: [
        {
          id: 'bold',
          label: '加粗',
          icon: <IconBold size={16} />,
          active: editor.isActive('bold'),
          shortcut: 'Ctrl+B',
          onClick: () => run(() => editor.chain().focus().toggleBold().run()),
        },
        {
          id: 'italic',
          label: '倾斜',
          icon: <IconItalic size={16} />,
          active: editor.isActive('italic') ?? false,
          shortcut: 'Ctrl+I',
          onClick: () => run(() => editor.chain().focus().toggleItalic().run()),
        },
        {
          id: 'strike',
          label: '删除线',
          icon: <IconStrike size={16} />,
          active: editor.isActive('strike') ?? false,
          onClick: () => run(() => editor.chain().focus().toggleStrike().run()),
        },
        {
          id: 'highlight',
          label: '高亮',
          icon: <IconHighlight size={16} />,
          active: editor.isActive('highlight') ?? false,
          onClick: () => run(() => {
            if (editor.isActive('highlight')) {
              (editor.chain().focus() as any).unsetHighlight().run();
            } else {
              (editor.chain().focus() as any).setHighlight({ color: '#FFFB7A' }).run();
            }
          }),
        },
        {
          id: 'code',
          label: '代码',
          icon: <IconCode size={16} />,
          active: editor.isActive('code') ?? false,
          onClick: () => run(() => editor.chain().focus().toggleCode().run()),
        },
        {
          id: 'math-inline',
          label: '数学',
          icon: <IconMath size={16} />,
          onClick: () => run(() => {
            const latex = window.prompt('输入 LaTeX 公式', '') || '';
            if (latex) (editor.chain().focus() as any).setInlineMath(latex).run();
          }),
        },
        {
          id: 'comment',
          label: '注释',
          icon: <IconComment size={16} />,
          onClick: () => run(() => {
            const comment = window.prompt('输入注释内容', '') || '';
            if (comment) (editor.chain().focus() as any).setComment(comment).run();
          }),
        },
        {
          id: 'clear-highlight',
          label: '清除高亮',
          icon: <IconEraser size={16} />,
          onClick: () => run(() => (editor.chain().focus() as any).unsetHighlight().run()),
        },
        {
          id: 'clear-format',
          label: '清除格式',
          icon: <IconClearFormat size={16} />,
          onClick: () => run(() => editor.chain().focus().unsetAllMarks().clearNodes().run()),
        },
      ],
    },
    {
      id: 'paragraph',
      label: '段落设置',
      icon: <IconParagraph size={16} />,
      children: [
        {
          id: 'paragraph-normal',
          label: '正文',
          icon: <IconText size={16} />,
          active: editor.isActive('paragraph') && !editor.isActive('heading') && !editor.isActive('bulletList') && !editor.isActive('orderedList'),
          onClick: () => run(() => editor.chain().focus().setParagraph().run()),
        },
        {
          id: 'heading1',
          label: '一级标题',
          icon: <IconHeading size={16} />,
          active: editor.isActive('heading', { level: 1 }) ?? false,
          onClick: () => run(() => editor.chain().focus().toggleHeading({ level: 1 }).run()),
        },
        {
          id: 'heading2',
          label: '二级标题',
          icon: <IconHeading size={16} />,
          active: editor.isActive('heading', { level: 2 }) ?? false,
          onClick: () => run(() => editor.chain().focus().toggleHeading({ level: 2 }).run()),
        },
        {
          id: 'heading3',
          label: '三级标题',
          icon: <IconHeading size={16} />,
          active: editor.isActive('heading', { level: 3 }) ?? false,
          onClick: () => run(() => editor.chain().focus().toggleHeading({ level: 3 }).run()),
        },
        {
          id: 'bullet-list',
          label: '无序列表',
          icon: <IconListBullet size={16} />,
          active: editor.isActive('bulletList') ?? false,
          onClick: () => run(() => editor.chain().focus().toggleBulletList().run()),
        },
        {
          id: 'ordered-list',
          label: '有序列表',
          icon: <IconListOrdered size={16} />,
          active: editor.isActive('orderedList') ?? false,
          onClick: () => run(() => editor.chain().focus().toggleOrderedList().run()),
        },
      ],
    },
    {
      id: 'insert',
      label: '插入',
      icon: <IconPlus size={16} />,
      children: [
        {
          id: 'table',
          label: '表格',
          icon: <IconTable size={16} />,
          onClick: () => run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
        },
        {
          id: 'hr',
          label: '分隔线',
          icon: <IconHr size={16} />,
          onClick: () => run(() => editor.chain().focus().setHorizontalRule().run()),
        },
        {
          id: 'code-block',
          label: '代码块',
          icon: <IconCodeBlock size={16} />,
          active: editor.isActive('codeBlock') ?? false,
          onClick: () => run(() => editor.chain().focus().toggleCodeBlock().run()),
        },
        {
          id: 'math-block',
          label: '数学块',
          icon: <IconMath size={16} />,
          onClick: () => run(() => {
            const latex = window.prompt('输入 LaTeX 公式块', '') || '';
            if (latex) (editor.chain().focus() as any).setMathBlock(latex).run();
          }),
        },
      ],
    },
    { id: 'sep2', label: '', onClick: () => {} },
    {
      id: 'cut',
      label: '剪切',
      icon: <IconCut size={16} />,
      shortcut: 'Ctrl+X',
      onClick: () => run(() => {
        if (selectedText) {
          navigator.clipboard.writeText(selectedText).then(() => {
            editor.chain().focus().deleteSelection().run();
          });
        }
      }),
    },
    {
      id: 'copy',
      label: '复制',
      icon: <IconCopy size={16} />,
      shortcut: 'Ctrl+C',
      onClick: () => run(() => {
        if (selectedText) navigator.clipboard.writeText(selectedText);
      }),
    },
    {
      id: 'paste',
      label: '粘贴',
      icon: <IconPaste size={16} />,
      shortcut: 'Ctrl+V',
      onClick: () => run(() => {
        navigator.clipboard.readText().then((text) => {
          editor.chain().focus().insertContent(text).run();
        });
      }),
    },
    {
      id: 'paste-plain',
      label: '以纯文本形式粘贴',
      icon: <IconPastePlain size={16} />,
      shortcut: 'Ctrl+Shift+V',
      onClick: () => run(() => {
        navigator.clipboard.readText().then((text) => {
          editor.chain().focus().insertContent(text.replace(/</g, '&lt;')).run();
        });
      }),
    },
    {
      id: 'select-all',
      label: '全选',
      icon: <IconSelectAll size={16} />,
      shortcut: 'Ctrl+A',
      onClick: () => run(() => editor.chain().focus().selectAll().run()),
    },
    { id: 'sep3', label: '', onClick: () => {} },
    {
      id: 'copilot',
      label: 'Copilot',
      icon: <IconCopilot size={16} />,
      children: [
        {
          id: 'copilot-context',
          label: '将所选内容添加到聊天上下文',
          disabled: !selectedText,
          onClick: () => openCopilot(selectedText),
        },
        {
          id: 'copilot-ask',
          label: '快速提问',
          onClick: () => openCopilot(),
        },
      ],
    },
  ];

  const scheduleCloseSubmenu = useCallback(() => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setActiveSubmenu(null), 180);
  }, []);

  const cancelCloseSubmenu = useCallback(() => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const onHover = (id: string | null) => {
    cancelCloseSubmenu();
    if (id) {
      setActiveSubmenu(id);
    } else {
      scheduleCloseSubmenu();
    }
  };

  const onClickItem = (item: MenuItem) => {
    if (item.disabled) return;
    item.onClick?.();
  };

  const activeItem = menuItems.find((i) => i.id === activeSubmenu && i.children);
  const activeEl = itemRefs.current[activeSubmenu || ''];
  const parentRect = activeEl?.getBoundingClientRect();

  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      className="ecm-menu ecm-root"
      style={{ left: pos.x, top: pos.y, minWidth: 200, maxWidth: 280 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menuItems.map((item) =>
        item.id.startsWith('sep') ? (
          <div key={item.id} className="ecm-sep" />
        ) : (
          <div
            key={item.id}
            ref={(el) => {
              if (el) itemRefs.current[item.id] = el.querySelector('button') as HTMLButtonElement;
            }}
          >
            <MenuItemRow
              item={item}
              onHover={onHover}
              active={activeSubmenu === item.id}
              onClickItem={onClickItem}
            />
            {activeItem?.id === item.id && item.children && parentRect && (
              <SubMenu
                items={item.children}
                parentPos={{ x: parentRect.right, y: parentRect.top }}
                parentHeight={parentRect.height}
                onMouseEnter={cancelCloseSubmenu}
                onMouseLeave={scheduleCloseSubmenu}
                onClickItem={onClickItem}
                activeItem={null}
                onHover={() => {}}
              />
            )}
          </div>
        )
      )}
    </div>
  );
}
