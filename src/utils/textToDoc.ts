// ============================================================
// 纯文本 → TipTap JSON 文档（草稿/灵感转正文用）
// ------------------------------------------------------------
// 按行拆分段落，供 updateDocContent 写入编辑器。
// ============================================================

export interface TipTapParagraph {
  type: 'paragraph';
  content: [{ type: 'text'; text: string }];
}

export interface TipTapDoc {
  type: 'doc';
  content: TipTapParagraph[];
}

/** 纯文本 → TipTap 段落数组（空行/空白行忽略） */
export function textToTipTapDoc(text: string | undefined | null): TipTapDoc {
  const lines = (text ?? '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { type: 'doc', content: [] };
  return {
    type: 'doc',
    content: lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] })),
  };
}

/** 草稿内容去 HTML 标签（草稿可能含富文本/纯文本混合） */
export function stripHtml(text: string | undefined | null): string {
  return (text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
