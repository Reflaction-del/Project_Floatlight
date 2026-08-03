// ============================================================
// HTML 消毒工具（防注入）
// ------------------------------------------------------------
// 用途：所有「外部可控内容 → dangerouslySetInnerHTML」的渲染入口
// 必须经过本工具。典型场景：
//   - CopilotSidebar 用 marked 渲染 AI 回复（模型输出可能被恶意
//     文章文件 / 提示词注入诱导携带原始 HTML）
//   - Editor 分栏预览直接渲染 editor.getHTML()
// 策略：白名单标签 + 白名单属性 + URL 协议白名单 + 事件属性剔除。
// 实现：DOMParser 解析 → 逐节点重建 → serialize，不依赖任何第三方库。
// 注意：本工具仅用于渲染进程（依赖 DOMParser）。
// ============================================================

/** 允许保留的标签（其余一律丢弃，仅保留其文本内容） */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
  'sub', 'sup', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'kbd', 'mark',
  'details', 'summary', 'cite', 'small', 'abbr', 'dl', 'dt', 'dd',
]);

/** 各标签允许的属性白名单（class/lang 无执行能力，可保留以维持样式） */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
  code: new Set(['class']),
  pre: new Set(['class']),
  ol: new Set(['start', 'type']),
  li: new Set(['value']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  td: new Set(['colspan', 'rowspan']),
  table: new Set(['summary']),
};
const GLOBAL_ATTRS = new Set(['class', 'lang']);

/** URL 协议白名单 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isSafeUrl(url: string, allowImageData: boolean): boolean {
  const u = (url || '').trim();
  if (!u) return false;
  // 相对链接（#锚点、/路径、./ ../ 等）安全
  if (/^(#|\/|\.\/|\.\.\/|[a-zA-Z0-9\-_])/.test(u) && !/^[a-z][a-z0-9+.-]*:/i.test(u)) return true;
  try {
    const proto = new URL(u, 'https://local.invalid').protocol;
    if (SAFE_PROTOCOLS.has(proto)) return true;
    if (allowImageData && proto === 'data:' && /^data:image\//i.test(u)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** 是否危险属性名（事件处理器 / 内联执行入口） */
function isDangerousAttr(name: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith('on')) return true; // onclick / onerror / onload ...
  return (
    n === 'style' || n === 'srcdoc' || n === 'formaction' || n === 'formtarget' || n === 'xlink:href'
  );
}

/** 复制节点到白名单 DOM（含文本节点）。keepClassNames=false 时连 class 也剥掉（用于最严格场景）。 */
function cloneNode(
  src: Node,
  out: Document,
  target: Node,
  allowImageData: boolean,
): void {
  if (src.nodeType === Node.TEXT_NODE) {
    target.appendChild(out.createTextNode(src.textContent ?? ''));
    return;
  }
  if (src.nodeType !== Node.ELEMENT_NODE) return; // 注释/文档片段等一律丢弃
  const el = src as Element;
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    // 危险标签（script/style/iframe/object/svg/math/form...）：丢弃标签本身，保留文本
    for (const child of Array.from(el.childNodes)) {
      cloneNode(child, out, target, allowImageData);
    }
    return;
  }
  const outEl = out.createElement(tag);
  const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    if (isDangerousAttr(name)) continue;
    if (!GLOBAL_ATTRS.has(name) && !allowed.has(name)) continue;
    const value = attr.value;
    if (tag === 'a' && name === 'href') {
      if (!isSafeUrl(value, false)) continue;
      outEl.setAttribute('href', value);
      outEl.setAttribute('rel', 'noopener noreferrer nofollow');
      outEl.setAttribute('target', '_blank');
      continue;
    }
    if (tag === 'img' && name === 'src') {
      if (!isSafeUrl(value, allowImageData)) {
        // 危险 src：直接丢弃整张图片，避免占位/加载外部内容
        return;
      }
      outEl.setAttribute('src', value);
      continue;
    }
    outEl.setAttribute(name, value);
  }
  for (const child of Array.from(el.childNodes)) {
    cloneNode(child, out, outEl, allowImageData);
  }
  target.appendChild(outEl);
}

/** 消毒 HTML 字符串；返回安全的 HTML（可能为空字符串）。 */
export function sanitizeHtml(html: string): string {
  try {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = new DOMParser().parseFromString('<template></template>', 'text/html');
    const tpl = out.querySelector('template') as HTMLTemplateElement | null;
    if (!tpl) return '';
    for (const child of Array.from(doc.body.childNodes)) {
      cloneNode(child, out, tpl.content, true);
    }
    return tpl.innerHTML;
  } catch {
    // 解析失败时按纯文本处理（转义），绝不原样注入
    return html.replace(/[&<>"']/g, (c) => (
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    ));
  }
}

/** 仅保留文本（彻底剥离所有 HTML 与脚本），用于最严格场景。 */
export function htmlToPlainText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}
