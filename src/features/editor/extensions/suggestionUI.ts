import tippy from 'tippy.js';
import type { SuggestionOptions } from '@tiptap/suggestion';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * 通用建议弹窗渲染（tippy 定位 + 自定义列表）。
 * 返回的 render 函数供 @tiptap/suggestion 使用。
 */
export function makeRender() {
  return (): ReturnType<NonNullable<SuggestionOptions['render']>> => {
    let popup: any = null;
    let selected = 0;
    let propsRef: any = null;

    const buildList = () => {
      const el = document.createElement('div');
      el.className = 'suggest-pop';
      const items: any[] = propsRef?.items ?? [];
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'suggest-item';
        empty.textContent = '无匹配';
        el.appendChild(empty);
        return el;
      }
      items.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'suggest-item' + (i === selected ? ' sel' : '');
        row.innerHTML = `<span>${escapeHtml(item.label)}</span><span class="suggest-kind">${escapeHtml(item.kind)}</span>`;
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          propsRef?.command(item);
        });
        el.appendChild(row);
      });
      return el;
    };

    return {
      onStart: (props: any) => {
        propsRef = props;
        selected = 0;
        const inst = tippy(document.body, {
          getReferenceClientRect: props.clientRect,
          appendTo: document.body,
          content: buildList(),
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          arrow: false,
          theme: 'light',
        });
        popup = Array.isArray(inst) ? inst[0] : inst;
      },
      onUpdate: (props: any) => {
        propsRef = props;
        selected = 0;
        popup?.setProps({ getReferenceClientRect: props.clientRect, content: buildList() });
      },
      onKeyDown: (props: any) => {
        const items: any[] = propsRef?.items ?? [];
        const n = Math.max(items.length, 1);
        if (props.event.key === 'ArrowDown') {
          selected = (selected + 1) % n;
          popup?.setProps({ content: buildList() });
          return true;
        }
        if (props.event.key === 'ArrowUp') {
          selected = (selected - 1 + n) % n;
          popup?.setProps({ content: buildList() });
          return true;
        }
        if (props.event.key === 'Enter') {
          if (items[selected]) propsRef?.command(items[selected]);
          return true;
        }
        if (props.event.key === 'Escape') {
          popup?.hide();
          return true;
        }
        return false;
      },
      onExit: () => {
        popup?.destroy();
        popup = null;
      },
    };
  };
}

/**
 * 实体自动补全专用渲染：Tab / Shift+Tab 在候选间移动高亮，
 * Space / Enter 插入当前高亮实体（含尾部空格），Esc 关闭；
 * 输入法组合（composing）期间不拦截按键，交给 IME 处理。
 */
export function makeEntityRender() {
  return (): ReturnType<NonNullable<SuggestionOptions['render']>> => {
    let popup: any = null;
    let selected = 0;
    let propsRef: any = null;

    const buildList = () => {
      const el = document.createElement('div');
      el.className = 'suggest-pop';
      const items: any[] = propsRef?.items ?? [];
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'suggest-item';
        empty.textContent = '无匹配';
        el.appendChild(empty);
        return el;
      }
      items.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'suggest-item' + (i === selected ? ' sel' : '');
        row.innerHTML = `<span>${escapeHtml(item.label)}</span><span class="suggest-kind">${escapeHtml(item.kind)}</span>`;
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          propsRef?.command(item);
        });
        el.appendChild(row);
      });
      return el;
    };

    return {
      onStart: (props: any) => {
        propsRef = props;
        selected = 0;
        const inst = tippy(document.body, {
          getReferenceClientRect: props.clientRect,
          appendTo: document.body,
          content: buildList(),
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          arrow: false,
          theme: 'light',
        });
        popup = Array.isArray(inst) ? inst[0] : inst;
      },
      onUpdate: (props: any) => {
        propsRef = props;
        selected = 0;
        popup?.setProps({ getReferenceClientRect: props.clientRect, content: buildList() });
      },
      onKeyDown: (props: any) => {
        const view = props.view;
        // 输入法组合中输入：不拦截，让 IME 正常上屏
        if (view && (view as any).composing) return false;
        const items: any[] = propsRef?.items ?? [];
        const n = Math.max(items.length, 1);
        if (props.event.key === 'Tab') {
          selected = (selected + (props.event.shiftKey ? -1 : 1) + n) % n;
          popup?.setProps({ content: buildList() });
          return true;
        }
        if (props.event.key === 'ArrowDown') {
          selected = (selected + 1) % n;
          popup?.setProps({ content: buildList() });
          return true;
        }
        if (props.event.key === 'ArrowUp') {
          selected = (selected - 1 + n) % n;
          popup?.setProps({ content: buildList() });
          return true;
        }
        if (props.event.key === ' ' || props.event.key === 'Enter') {
          if (items[selected]) propsRef?.command(items[selected]);
          return true;
        }
        if (props.event.key === 'Escape') {
          popup?.hide();
          return true;
        }
        return false;
      },
      onExit: () => {
        popup?.destroy();
        popup = null;
      },
    };
  };
}
