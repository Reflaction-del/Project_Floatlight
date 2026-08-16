import { describe, it, expect } from 'vitest';
import { textToTipTapDoc, stripHtml } from './textToDoc';

describe('textToTipTapDoc 文本转文档', () => {
  it('多行 → 多段落', () => {
    const doc = textToTipTapDoc('第一行\n第二行');
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: '第一行' }] });
    expect(doc.content[1].content[0].text).toBe('第二行');
  });

  it('空行忽略、行首尾空白清理', () => {
    const doc = textToTipTapDoc('  第一行  \n\n   \n第二行');
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].content[0].text).toBe('第一行');
  });

  it('空/undefined/null → 空文档', () => {
    expect(textToTipTapDoc('').content).toHaveLength(0);
    expect(textToTipTapDoc('   \n  ').content).toHaveLength(0);
    expect(textToTipTapDoc(undefined).content).toHaveLength(0);
    expect(textToTipTapDoc(null).content).toHaveLength(0);
  });

  it('多空行压缩为单段落', () => {
    const doc = textToTipTapDoc('一段\n\n\n\n二段');
    expect(doc.content).toHaveLength(2);
  });
});

describe('stripHtml 去标签', () => {
  it('去除标签并清理空白', () => {
    expect(stripHtml('<p>你好</p>')).toBe('你好');
    expect(stripHtml('a&nbsp;b')).toBe('a b');
    expect(stripHtml('<div>1</div><div>2</div>')).toBe('12');
    expect(stripHtml('')).toBe('');
    expect(stripHtml(null)).toBe('');
  });
});
