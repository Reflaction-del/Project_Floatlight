import { describe, it, expect } from 'vitest';
import { findDocTitleConflict, hasDocTitleConflict, uniqueDocTitle } from './docConflict';
import type { DocFile } from '../types';

const doc = (id: string, title: string, folder = '未分组'): DocFile => ({ id, title, icon: '', folder, content: { type: 'doc', content: [] } });

describe('findDocTitleConflict 查重', () => {
  it('同名命中（跨文件夹，全局查重）', () => {
    const docs = [doc('a', '第一章', '卷1'), doc('c', '第二章')];
    expect(findDocTitleConflict(docs, '第一章')?.id).toBe('a');
  });

  it('排除自身后无冲突 → null', () => {
    const docs = [doc('a', '第一章')];
    expect(findDocTitleConflict(docs, '第一章', 'a')).toBeNull();
  });

  it('排除自身后仍有他人同名 → 命中他人', () => {
    const docs = [doc('a', '第一章'), doc('b', '第一章')];
    expect(findDocTitleConflict(docs, '第一章', 'a')?.id).toBe('b');
  });

  it('无冲突 / 空白 / undefined 返回 null', () => {
    const docs = [doc('a', '第一章')];
    expect(findDocTitleConflict(docs, '第三章')).toBeNull();
    expect(findDocTitleConflict(docs, '')).toBeNull();
    expect(findDocTitleConflict(docs, '   ')).toBeNull();
    expect(findDocTitleConflict(undefined, '第一章')).toBeNull();
  });

  it('hasDocTitleConflict 布尔封装', () => {
    const docs = [doc('a', '第一章'), doc('b', '第二章')];
    expect(hasDocTitleConflict(docs, '第一章')).toBe(true);
    expect(hasDocTitleConflict(docs, '第一章', 'a')).toBe(false);
    expect(hasDocTitleConflict(docs, '第二章')).toBe(true);
  });
});

describe('uniqueDocTitle 自动编号', () => {
  it('无冲突原样返回', () => {
    const docs = [doc('a', '第一章')];
    expect(uniqueDocTitle(docs, '新的文章')).toBe('新的文章'); // docs 中没有「新的文章」
    expect(uniqueDocTitle(docs, '第二章')).toBe('第二章');
  });

  it('冲突自动加序号（跳过已占用序号）', () => {
    const docs = [doc('a', '未命名'), doc('b', '未命名（2）')];
    expect(uniqueDocTitle(docs, '未命名')).toBe('未命名（3）');
  });

  it('空标题回退未命名', () => {
    expect(uniqueDocTitle([], '')).toBe('未命名');
    expect(uniqueDocTitle(undefined, '   ')).toBe('未命名');
    const docs = [doc('a', '未命名')];
    expect(uniqueDocTitle(docs, '')).toBe('未命名（2）');
  });

  it('连续创建同名（模拟同时创建两个完全相同文档——bug 场景）', () => {
    // 已存在「第一章」→ 新文档自动编号为「第一章（2）」
    let list = [doc('a', '第一章')];
    const t1 = uniqueDocTitle(list, '第一章');
    expect(t1).toBe('第一章（2）');
    list = [...list, doc('x1', t1)];
    // 再建第三个 → 「第一章（3）」
    const t2 = uniqueDocTitle(list, '第一章');
    expect(t2).toBe('第一章（3）');
  });
});
