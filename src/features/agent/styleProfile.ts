// ============================================================
// StyleKeeper 风格指纹与漂移检测（Phase 5 质量增强）
// ------------------------------------------------------------
// 纯本地统计（不调 LLM）：从样本文本提取「风格指纹」，对目标文本
// 计算分项偏差并给出漂移评分。用于长文口吻一致性检查——
// 检测 AI 续写/他人代笔的片段是否偏离作者既有文风。
// ============================================================

/** 分项指标 */
export interface StyleMetric {
  key: string;
  label: string;
  value: number;
}

/** 风格指纹（样本文本的统计特征） */
export interface StyleProfile {
  /** 平均句长（字/句） */
  avgSentenceLen: number;
  /** 短句比例（≤10 字） */
  shortSentenceRatio: number;
  /** 长句比例（≥40 字） */
  longSentenceRatio: number;
  /** 感叹号频率（每句） */
  exclaimPerSentence: number;
  /** 问号频率（每句） */
  questionPerSentence: number;
  /** 逗号密度（每 100 字） */
  commaPer100: number;
  /** 第一人称密度（每 100 字） */
  firstPersonPer100: number;
  /** 语气词密度（每 100 字） */
  particlePer100: number;
  /** 省略号/破折号频率（每句） */
  dashPerSentence: number;
  /** 样本有效句子数 */
  sampleSize: number;
}

/** 分项漂移报告条目 */
export interface DriftItem {
  key: keyof StyleProfile | 'sampleSize';
  label: string;
  sample: number;
  target: number;
  /** 归一化偏差 0-1（该指标相对样本的漂移程度） */
  delta: number;
  /** 是否超过偏差阈值（默认 0.35） */
  deviated: boolean;
}

/** 漂移报告 */
export interface StyleDriftReport {
  /** 总漂移分 0-1（0=完全一致，1=完全漂移），指标加权平均 */
  score: number;
  verdict: 'close' | 'moderate' | 'drifted';
  items: DriftItem[];
}

/** 判定阈值 */
export const VERDICT_THRESHOLDS = { close: 0.15, moderate: 0.35 } as const;
/** 单指标偏差阈值 */
export const ITEM_DEVIATION_THRESHOLD = 0.35;

// —— 文本切分 ——

const SENTENCE_SPLIT = /[。！？!?…]+|\n+/;
const FIRST_PERSON = /我|咱|俺|我们|咱们|俺们/g;
const PARTICLES = /[啊呀吧呢啦哦唉嘛哈噢]/g;

/** 按句切分（忽略空串） */
export function splitSentences(text: string): string[] {
  return (text || '')
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 提取指标（纯函数，可测） */
export function extractMetrics(text: string): StyleMetric[] {
  const sentences = splitSentences(text);
  const total = text.replace(/\s+/g, '');
  const chars = total.length;
  if (sentences.length === 0 || chars === 0) {
    return [
      { key: 'avgSentenceLen', label: '平均句长', value: 0 },
      { key: 'shortSentenceRatio', label: '短句比例', value: 0 },
      { key: 'longSentenceRatio', label: '长句比例', value: 0 },
      { key: 'exclaimPerSentence', label: '感叹句频', value: 0 },
      { key: 'questionPerSentence', label: '疑问句频', value: 0 },
      { key: 'commaPer100', label: '逗号密度', value: 0 },
      { key: 'firstPersonPer100', label: '第一人称', value: 0 },
      { key: 'particlePer100', label: '语气词', value: 0 },
      { key: 'dashPerSentence', label: '破折省略', value: 0 },
    ];
  }
  const lens = sentences.map((s) => s.length);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const short = lens.filter((l) => l <= 10).length / lens.length;
  const long = lens.filter((l) => l >= 40).length / lens.length;
  const exclaim = (text.match(/[！!]/g) ?? []).length / sentences.length;
  const question = (text.match(/[？?]/g) ?? []).length / sentences.length;
  const comma = (text.match(/[,，]/g) ?? []).length / chars * 100;
  const firstPerson = (text.match(FIRST_PERSON) ?? []).length / chars * 100;
  const particle = (text.match(PARTICLES) ?? []).length / chars * 100;
  const dash = (text.match(/[—…]/g) ?? []).length / sentences.length;
  return [
    { key: 'avgSentenceLen', label: '平均句长', value: avg },
    { key: 'shortSentenceRatio', label: '短句比例', value: short },
    { key: 'longSentenceRatio', label: '长句比例', value: long },
    { key: 'exclaimPerSentence', label: '感叹句频', value: exclaim },
    { key: 'questionPerSentence', label: '疑问句频', value: question },
    { key: 'commaPer100', label: '逗号密度', value: comma },
    { key: 'firstPersonPer100', label: '第一人称', value: firstPerson },
    { key: 'particlePer100', label: '语气词', value: particle },
    { key: 'dashPerSentence', label: '破折省略', value: dash },
  ];
}

/** 由指标数组构建风格指纹 */
export function buildStyleProfile(metrics: StyleMetric[]): StyleProfile {
  const m = (key: string) => metrics.find((x) => x.key === key)?.value ?? 0;
  return {
    avgSentenceLen: m('avgSentenceLen'),
    shortSentenceRatio: m('shortSentenceRatio'),
    longSentenceRatio: m('longSentenceRatio'),
    exclaimPerSentence: m('exclaimPerSentence'),
    questionPerSentence: m('questionPerSentence'),
    commaPer100: m('commaPer100'),
    firstPersonPer100: m('firstPersonPer100'),
    particlePer100: m('particlePer100'),
    dashPerSentence: m('dashPerSentence'),
    sampleSize: splitSentences('').length,
  };
}

/** 归一化偏差：abs(a-b) 相对 max(a,b)（分母为 0 时用 b） */
function relDelta(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-6);
  return Math.min(1, Math.abs(a - b) / denom);
}

const METRIC_LABELS: Record<string, string> = {
  avgSentenceLen: '平均句长',
  shortSentenceRatio: '短句比例',
  longSentenceRatio: '长句比例',
  exclaimPerSentence: '感叹句频',
  questionPerSentence: '疑问句频',
  commaPer100: '逗号密度',
  firstPersonPer100: '第一人称',
  particlePer100: '语气词',
  dashPerSentence: '破折省略',
};

/** 风格漂移检测：目标文本 vs 样本文本 */
export function scoreStyleDrift(sampleText: string, targetText: string): StyleDriftReport {
  const sampleMetrics = extractMetrics(sampleText);
  const targetMetrics = extractMetrics(targetText);
  const profile = buildStyleProfile(sampleMetrics);
  const targetMap = new Map(targetMetrics.map((m) => [m.key, m.value]));

  const keys = ['avgSentenceLen', 'shortSentenceRatio', 'longSentenceRatio', 'exclaimPerSentence', 'questionPerSentence', 'commaPer100', 'firstPersonPer100', 'particlePer100', 'dashPerSentence'] as const;
  const items: DriftItem[] = keys.map((k) => {
    const sample = profile[k];
    const target = targetMap.get(k) ?? 0;
    const delta = relDelta(sample, target);
    return {
      key: k as any,
      label: METRIC_LABELS[k],
      sample,
      target,
      delta,
      deviated: delta > ITEM_DEVIATION_THRESHOLD,
    };
  });

  const weights: Record<string, number> = {
    avgSentenceLen: 1.2,
    shortSentenceRatio: 1.0,
    longSentenceRatio: 1.0,
    exclaimPerSentence: 0.9,
    questionPerSentence: 0.9,
    commaPer100: 0.8,
    firstPersonPer100: 1.3,
    particlePer100: 1.0,
    dashPerSentence: 0.8,
  };
  let wsum = 0;
  let acc = 0;
  for (const it of items) {
    const w = weights[it.key] ?? 1;
    wsum += w;
    acc += it.delta * w;
  }
  const score = wsum > 0 ? acc / wsum : 0;
  const verdict = score < VERDICT_THRESHOLDS.close ? 'close' : score < VERDICT_THRESHOLDS.moderate ? 'moderate' : 'drifted';
  return { score, verdict, items };
}
