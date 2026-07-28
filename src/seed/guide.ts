// ============================================================
// 新手引导种子：把 Markdown 手册 / 欢迎词转成 TipTap JSON 文档，
// 嵌入默认演示世界「幻光纪元」，让新用户一打开就能看到引导与完整说明。
// 纯函数、无 React / Electron 依赖，渲染进程启动期调用一次即可。
// ============================================================

import type { DocFile } from '../types';
import manualMd from './manual.md?raw';
import welcomeMd from './welcome.md?raw';

/* —— 行内解析：支持 **粗体** / `代码` / [[id|label]] 维基链接 —— */
type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; content: InlineNode[] }
  | { type: 'code'; content: InlineNode[] }
  | { type: 'wikiLink'; attrs: { targetId: string; label: string } };

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const re = /\[\[([^\]|]+)\|([^\]]+)\]\]|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      nodes.push({ type: 'wikiLink', attrs: { targetId: m[1].trim(), label: m[2].trim() } });
    } else if (m[3] !== undefined) {
      nodes.push({ type: 'code', content: [{ type: 'text', text: m[3] }] });
    } else if (m[4] !== undefined) {
      nodes.push({ type: 'strong', content: [{ type: 'text', text: m[4] }] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes.filter((n) => !(n.type === 'text' && !n.text));
}

type BlockNode = Record<string, unknown>;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim());
}

function isTableSep(line: string): boolean {
  return /^\|[\s:|\-]+\|$/.test(line.trim());
}

/** Markdown → TipTap JSON（覆盖手册使用的子集：标题/段落/列表/引用/分割线/表格） */
function mdToDoc(md: string): { type: string; content: BlockNode[] } {
  const lines = md.split('\n');
  const content: BlockNode[] = [];
  let i = 0;

  const pushBlock = (n: BlockNode) => {
    if (n && Array.isArray((n as any).content) && (n as any).content.length === 0) return;
    content.push(n);
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    // 标题 # ~ ######
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const body = parseInline(h[2]);
      pushBlock({ type: 'heading', attrs: { level: h[1].length }, content: body });
      i++; continue;
    }

    // 分割线
    if (/^---+$/.test(trimmed)) { pushBlock({ type: 'horizontalRule' }); i++; continue; }

    // 表格（| 表头 | + | --- | 分隔 + 数据行）
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i])); i++;
      }
      const bq: BlockNode[] = [
        { type: 'paragraph', content: [{ type: 'strong', content: parseInline(header.join(' · ')) }] },
      ];
      for (const r of rows) bq.push({ type: 'paragraph', content: parseInline(r.join(' · ')) });
      pushBlock({ type: 'blockquote', content: bq });
      continue;
    }

    // 引用 > （连续多行合并为一个 blockquote）
    if (trimmed.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, '')); i++;
      }
      pushBlock({ type: 'blockquote', content: [{ type: 'paragraph', content: parseInline(buf.join(' ')) }] });
      continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^[-*]\s+/, ''))); i++;
      }
      pushBlock({
        type: 'bulletList',
        content: items.map((c) => ({ type: 'listItem', content: [{ type: 'paragraph', content: c }] })),
      });
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\d+\.\s+/, ''))); i++;
      }
      pushBlock({
        type: 'orderedList',
        content: items.map((c) => ({ type: 'listItem', content: [{ type: 'paragraph', content: c }] })),
      });
      continue;
    }

    // 段落（合并连续普通行）
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('>') &&
      !/^---+$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('|')
    ) {
      buf.push(lines[i]); i++;
    }
    pushBlock({ type: 'paragraph', content: parseInline(buf.join(' ')) });
  }

  return { type: 'doc', content };
}

/** 引导文档集合：欢迎词 + 完整手册，置于「新手引导」文件夹 */
export const GUIDE_DOCS: DocFile[] = [
  {
    id: 'guide-welcome',
    title: '新手引导 · 从这里开始',
    icon: '',
    folder: '新手引导',
    content: mdToDoc(welcomeMd),
  },
  {
    id: 'guide-manual',
    title: '浮光世界观编辑器 · 使用说明',
    icon: '',
    folder: '新手引导',
    content: mdToDoc(manualMd),
  },
];
