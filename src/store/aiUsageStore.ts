import { create } from 'zustand';
import { storage } from '../storage';
import { useAIStore, type AIModel } from './aiStore';

export type AIUsageFeature =
  | 'chat'
  | 'article-extract'
  | 'entity-link'
  | 'scene-card'
  | 'template-gen'
  | 'image-gen'
  | 'draft-analyze'
  | 'entity-ai'
  | 'material-ai'
  | 'test';

export const AI_USAGE_FEATURE_LABELS: Record<AIUsageFeature, string> = {
  chat: 'AI 对话',
  'article-extract': '文章抽取',
  'entity-link': '实体关联',
  'scene-card': '多模态设卡',
  'template-gen': 'NL 建模板',
  'image-gen': '图像生成',
  'draft-analyze': '草稿分析',
  'entity-ai': '实体 AI 填充',
  'material-ai': '物料 AI 文案',
  test: '连接测试',
};

export interface AIUsageRecord {
  id: string;
  timestamp: number;
  modelId: string;
  modelLabel: string;
  feature: AIUsageFeature;
  inputTokens: number;
  outputTokens: number;
  /** 估算费用（元） */
  cost: number;
}

export interface AIUsageAlert {
  type: 'cost' | 'token';
  message: string;
  triggeredAt: number;
}

export type PeriodMode = 'today' | 'month' | 'all';

interface RawRecord {
  modelId: string;
  modelLabel: string;
  feature: AIUsageFeature;
  inputTokens: number;
  outputTokens: number;
}

function nowId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function startOfDay(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(t = Date.now()) {
  const d = new Date(t);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function periodRange(mode: PeriodMode): { start: number; end: number } | null {
  const now = Date.now();
  if (mode === 'today') return { start: startOfDay(now), end: now };
  if (mode === 'month') return { start: startOfMonth(now), end: now };
  return null;
}

function matchesPeriod(r: AIUsageRecord, mode: PeriodMode): boolean {
  if (mode === 'all') return true;
  const range = periodRange(mode);
  if (!range) return true;
  return r.timestamp >= range.start && r.timestamp <= range.end;
}

/** 简单 token 估算：CJK 约 0.8 token/字，非 CJK 约 0.25 token/字符 */
export function approximateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const nonCjk = text.length - cjk;
  return Math.max(1, Math.ceil(cjk * 0.8 + nonCjk * 0.25));
}

function computeCost(model: AIModel | undefined, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const inPrice = model.inputPricePer1K ?? 0;
  const outPrice = model.outputPricePer1K ?? 0;
  if (inPrice <= 0 && outPrice <= 0) return 0;
  return Number(((inputTokens / 1000) * inPrice + (outputTokens / 1000) * outPrice).toFixed(6));
}

function loadRecords(): AIUsageRecord[] {
  try {
    const raw = localStorage.getItem('fl-ai-usage-v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return [];
}

function saveRecords(records: AIUsageRecord[]) {
  try {
    const payload = JSON.stringify(records);
    // 桌面版走统一磁盘存储，避免 Electron localStorage 随 origin/分区丢失
    storage.writeFile('fl-ai-usage-v1.json', payload);
    // 浏览器/预览环境兜底：writeFile 内部已写 localStorage，这里再写一次确保旧数据兼容
    localStorage.setItem('fl-ai-usage-v1', payload);
  } catch { /* ignore quota */ }
}

function getModelById(modelId: string): AIModel | undefined {
  try {
    return useAIStore.getState().models.find((m) => m.id === modelId);
  } catch {
    return undefined;
  }
}

export interface AIUsageState {
  records: AIUsageRecord[];
  alert: AIUsageAlert | null;
  dismissAlert: () => void;
  record: (params: RawRecord) => void;
  recordStreamingChat: (model: AIModel, inputText: string, outputText: string) => void;
  recordImageGen: (model: AIModel) => void;
  getStats: (mode: PeriodMode) => { requests: number; inputTokens: number; outputTokens: number; cost: number };
  getByModel: (mode: PeriodMode) => Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>;
  getByFeature: (mode: PeriodMode) => Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>;
  checkBudget: (model: AIModel, mode: PeriodMode) => AIUsageAlert | null;
  exportCSV: () => string;
  clear: () => void;
}

function aggregate(grouped: Iterable<AIUsageRecord[]>) {
  const result: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }> = {};
  for (const group of grouped) {
    const key = group[0]?.modelLabel || group[0]?.feature || '未知';
    result[key] = group.reduce(
      (acc, r) => ({
        requests: acc.requests + 1,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        cost: acc.cost + r.cost,
      }),
      { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    );
  }
  return result;
}

function groupBy<K extends keyof AIUsageRecord>(records: AIUsageRecord[], key: K): Record<string, AIUsageRecord[]> {
  const groups: Record<string, AIUsageRecord[]> = {};
  for (const r of records) {
    const k = String(r[key]);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  return groups;
}

export const useAIUsageStore = create<AIUsageState>((set, get) => ({
  records: loadRecords(),
  alert: null,

  dismissAlert: () => set({ alert: null }),

  record: (params) => {
    const model = getModelById(params.modelId);
    // 计量默认开启：仅显式 requiresMetering===false 才跳过（兼容老模型缺省字段）
    if (model && model.requiresMetering === false) return;
    const cost = computeCost(model, params.inputTokens, params.outputTokens);
    const record: AIUsageRecord = {
      id: nowId(),
      timestamp: Date.now(),
      modelId: params.modelId,
      modelLabel: params.modelLabel || '未知模型',
      feature: params.feature,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cost,
    };
    const records = [...get().records, record];
    saveRecords(records);
    const alert = model ? get().checkBudget(model, 'month') || get().checkBudget(model, 'today') : null;
    set({ records, alert });
  },

  recordStreamingChat: (model, inputText, outputText) => {
    if (model.requiresMetering === false) return;
    const inputTokens = approximateTokens(inputText);
    const outputTokens = approximateTokens(outputText);
    get().record({
      modelId: model.id,
      modelLabel: model.label || model.model,
      feature: 'chat',
      inputTokens,
      outputTokens,
    });
  },

  recordImageGen: (model) => {
    if (!model.requiresMetering) return;
    get().record({
      modelId: model.id,
      modelLabel: model.label || model.model,
      feature: 'image-gen',
      inputTokens: 0,
      outputTokens: 0,
    });
  },

  getStats: (mode) => {
    const list = get().records.filter((r) => matchesPeriod(r, mode));
    return list.reduce(
      (acc, r) => ({
        requests: acc.requests + 1,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        cost: acc.cost + r.cost,
      }),
      { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    );
  },

  getByModel: (mode) => {
    const list = get().records.filter((r) => matchesPeriod(r, mode));
    return aggregate(Object.values(groupBy(list, 'modelLabel')));
  },

  getByFeature: (mode) => {
    const list = get().records.filter((r) => matchesPeriod(r, mode));
    return aggregate(Object.values(groupBy(list, 'feature')));
  },

  checkBudget: (model, mode) => {
    if (!model.requiresMetering) return null;
    const list = get().records.filter((r) => r.modelId === model.id && matchesPeriod(r, mode));
    const { cost, tokens } = list.reduce(
      (acc, r) => ({ cost: acc.cost + r.cost, tokens: acc.tokens + r.inputTokens + r.outputTokens }),
      { cost: 0, tokens: 0 },
    );
    const budgetLimit = model.budgetLimit ?? 0;
    const tokenBudget = model.tokenBudget ?? 0;
    if (budgetLimit > 0 && cost >= budgetLimit) {
      return { type: 'cost' as const, message: `模型「${model.label || model.model}」${mode === 'today' ? '今日' : '本月'}费用已达 ¥${cost.toFixed(2)}，超过预算 ¥${budgetLimit.toFixed(2)}`, triggeredAt: Date.now() };
    }
    if (tokenBudget > 0 && tokens >= tokenBudget) {
      return { type: 'token' as const, message: `模型「${model.label || model.model}」${mode === 'today' ? '今日' : '本月'}Token 已达 ${tokens.toLocaleString()}，超过预算 ${tokenBudget.toLocaleString()}`, triggeredAt: Date.now() };
    }
    return null;
  },

  exportCSV: () => {
    const rows = get().records;
    const header = ['时间', '模型', '功能', '输入Tokens', '输出Tokens', '总Tokens', '费用(元)'];
    const lines = rows.map((r) => [
      new Date(r.timestamp).toLocaleString('zh-CN'),
      r.modelLabel,
      AI_USAGE_FEATURE_LABELS[r.feature] || r.feature,
      r.inputTokens,
      r.outputTokens,
      r.inputTokens + r.outputTokens,
      r.cost.toFixed(6),
    ].join(','));
    return [header.join(','), ...lines].join('\n');
  },

  clear: () => {
    saveRecords([]);
    set({ records: [], alert: null });
  },
}));
