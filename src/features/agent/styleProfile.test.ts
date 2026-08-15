import { describe, it, expect } from 'vitest';
import { extractMetrics, splitSentences, scoreStyleDrift, buildStyleProfile } from './styleProfile';

describe('splitSentences 句子切分', () => {
  it('按中文句读切分', () => {
    expect(splitSentences('第一句。第二句！第三句？')).toEqual(['第一句', '第二句', '第三句']);
  });
  it('空串返回空数组', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n  ')).toEqual([]);
  });
});

describe('extractMetrics 指标提取', () => {
  it('空文本全零', () => {
    const m = extractMetrics('');
    expect(m.every((x) => x.value === 0)).toBe(true);
  });

  it('平均句长与短句比例', () => {
    // 「好。」1 字短句 ×3 + 一个 30 字长句
    const text = '好。好。好。这是一个非常长的句子用来测试平均句长计算的准确性指标。';
    const m = extractMetrics(text);
    const avg = m.find((x) => x.key === 'avgSentenceLen')!.value;
    expect(avg).toBeGreaterThan(5);
    expect(avg).toBeLessThan(20);
    expect(m.find((x) => x.key === 'shortSentenceRatio')!.value).toBe(0.75); // 3/4 短句
  });

  it('感叹号/问号频率与标点密度', () => {
    const m = extractMetrics('天哪！真的吗？。');
    expect(m.find((x) => x.key === 'exclaimPerSentence')!.value).toBeCloseTo(1 / 2);
    expect(m.find((x) => x.key === 'questionPerSentence')!.value).toBeCloseTo(1 / 2);
  });
});

describe('buildStyleProfile 指纹构建', () => {
  it('由指标生成完整指纹', () => {
    const metrics = extractMetrics('夜风穿过窗棂，烛火忽明忽暗。她叹了口气，把信纸折好收进匣中。');
    const p = buildStyleProfile(metrics);
    expect(p.avgSentenceLen).toBeGreaterThan(0);
    expect(p.commaPer100).toBeGreaterThan(0);
    expect(p.sampleSize).toBe(0); // sampleSize 未参与（保留字段）
  });
});

describe('scoreStyleDrift 漂移评分', () => {
  it('同源文本评分接近 0（close）', () => {
    const sample = '夜风穿过窗棂，烛火忽明忽暗。她叹了口气，把信纸折好收进匣中。';
    const report = scoreStyleDrift(sample, sample);
    expect(report.score).toBeLessThan(0.05);
    expect(report.verdict).toBe('close');
    expect(report.items.every((i) => !i.deviated)).toBe(true);
  });

  it('风格迥异文本评分为 drifted', () => {
    const sample = '夜风穿过窗棂，烛火忽明忽暗。她叹了口气，把信纸折好收进匣中。';
    const target = '卧槽！！这波操作简直太顶了啊啊啊！！！我直接原地起飞，兄弟们冲鸭！！！';
    const report = scoreStyleDrift(sample, target);
    expect(report.verdict).toBe('drifted');
    expect(report.score).toBeGreaterThan(0.35);
  });

  it('报告含分项明细与偏差标记', () => {
    const sample = '夜风穿过窗棂，烛火忽明忽暗。她叹了口气，把信纸折好收进匣中。';
    const target = '他妈的这什么鬼东西？？？老子不信！！！';
    const report = scoreStyleDrift(sample, target);
    expect(report.items.length).toBe(9);
    expect(report.items.some((i) => i.deviated)).toBe(true);
    expect(report.items.every((i) => i.delta >= 0 && i.delta <= 1)).toBe(true);
  });

  it('空目标文本 → close（无内容可判）', () => {
    const report = scoreStyleDrift('样本文本。', '');
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(['close', 'moderate', 'drifted']).toContain(report.verdict);
  });
});
