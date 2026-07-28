// TipTap(JSON) → Markdown 转换 + 世界数据 → Markdown 导出
import type { WorldData } from '../store/worldStore';

interface TNode {
  type: string;
  attrs?: Record<string, any>;
  content?: TNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
}

function serializeInline(node: TNode): string {
  let t = node.text ?? '';
  for (const m of node.marks ?? []) {
    if (m.type === 'bold') t = `**${t}**`;
    else if (m.type === 'italic') t = `*${t}*`;
    else if (m.type === 'code') t = '`' + t + '`';
    else if (m.type === 'strike') t = `~~${t}~~`;
    else if (m.type === 'link') t = `[${t}](${m.attrs?.href ?? ''})`;
  }
  return t;
}

function serializeTable(node: TNode): string {
  const rows = node.content ?? [];
  if (!rows.length) return '';
  const cellText = (cell: TNode) => (cell.content ?? []).map(serializeInline).join('').replace(/\n/g, ' ');
  const lines: string[] = [];
  rows.forEach((row, ri) => {
    const cells = (row.content ?? []).map(cellText);
    lines.push('| ' + cells.join(' | ') + ' |');
    if (ri === 0) lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
  });
  return lines.join('\n');
}

function serializeNode(node: TNode, listDepth = 0): string {
  const c = (node.content ?? []).map((n) => serializeNode(n, listDepth)).join('');
  switch (node.type) {
    case 'doc':
      return c;
    case 'heading':
      return '#'.repeat(node.attrs?.level || 1) + ' ' + c.replace(/\n+$/, '') + '\n\n';
    case 'paragraph':
      return c + '\n\n';
    case 'bulletList':
      return (node.content ?? [])
        .map((li) => '  '.repeat(listDepth) + '- ' + serializeNode(li, listDepth + 1).trim())
        .join('\n') + '\n\n';
    case 'orderedList': {
      let i = 1;
      return (node.content ?? [])
        .map((li) => '  '.repeat(listDepth) + `${i++}. ` + serializeNode(li, listDepth + 1).trim())
        .join('\n') + '\n\n';
    }
    case 'listItem':
      return c;
    case 'blockquote':
      return '> ' + c.replace(/\n+$/, '').split('\n').join('\n> ') + '\n\n';
    case 'codeBlock':
      return '```\n' + c + '```\n\n';
    case 'image':
      return `![${node.attrs?.alt ?? ''}](${node.attrs?.src ?? ''})\n\n`;
    case 'wikiLink':
      return `[${node.attrs?.label ?? '链接'}]`;
    case 'horizontalRule':
      return '---\n\n';
    case 'table':
      return serializeTable(node) + '\n\n';
    case 'text':
      return serializeInline(node);
    default:
      return c;
  }
}

export function docToMarkdown(content: unknown): string {
  try {
    return serializeNode(content as TNode).trim() + '\n';
  } catch {
    return '';
  }
}

export function worldToMarkdown(world: WorldData, name: string): string {
  let md = `# ${name}\n\n> 由浮光 · 世界观编辑器导出\n\n`;
  const folders = world.folders ?? [];
  for (const f of folders) {
    const docs = (world.docs ?? []).filter((d) => d.folder === f);
    if (docs.length) {
      md += `## ${f}\n\n`;
      for (const d of docs) {
        md += `### ${d.icon ?? ''} ${d.title}\n\n`;
        md += docToMarkdown(d.content) + '\n';
      }
    }
  }
  if (world.timelines?.length) {
    md += `## 时间轴\n\n`;
    for (const tl of world.timelines) {
      md += `### ${tl.name}\n\n`;
      for (const ev of tl.events) {
        md += `- **${ev.label}**（${ev.year}）${ev.note ? ' — ' + ev.note : ''}\n`;
      }
      md += '\n';
    }
  }
  const entities = (world as any).entities as
    | { emoji?: string; name: string; type?: string; fields?: { label: string; value: string }[]; tags?: string[] }[]
    | undefined;
  if (entities?.length) {
    md += `## 实体\n\n`;
    for (const e of entities) {
      md += `### ${e.emoji ?? ''} ${e.name}${e.type ? `（${e.type}）` : ''}\n\n`;
      for (const f of e.fields ?? []) md += `- **${f.label}**： ${f.value}\n`;
      if (e.tags?.length) md += `\n标签：${e.tags.join('、')}\n`;
      md += '\n';
    }
  }
  return md;
}
