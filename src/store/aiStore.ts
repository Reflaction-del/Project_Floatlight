import { create } from 'zustand';
import { storage } from '../storage';

const MODEL_DEFAULTS = getModelDefaults();

export type PromptFormat = 'chat' | 'qwen' | 'instruct' | 'raw';

/** 嵌入（Embedding）模型配置：全应用共享一个，用于语义检索（区别于聊天用的 AIModel）。 */
export interface EmbeddingModel {
  endpoint: string; // https://api.openai.com/v1
  apiKey: string;
  model: string;     // text-embedding-3-small / bge-m3 / nomic-embed-text 等
  /** 期望维度（可选，仅用于提示/校验，0 表示未知） */
  dimensions?: number;
  /** 语义索引的自动更新策略（详见 embeddingIndex.ts） */
  indexPolicy?: IndexPolicy;
}

/** 语义索引自动更新策略 */
export type IndexMode = 'manual' | 'onEntityChange' | 'onSave';
export interface IndexPolicy {
  /** manual=仅手动；onEntityChange=实体/关系变更后自动（短防抖）；onSave=停手/保存时自动（长防抖） */
  mode: IndexMode;
  /** 防抖毫秒数，避免高频编辑反复触发嵌入 */
  debounceMs: number;
}
export const DEFAULT_INDEX_POLICY: IndexPolicy = { mode: 'manual', debounceMs: 3000 };

export interface AIModel {
  id: string;
  label: string;     // 别名，如「qwen本地」「deepseek云」
  endpoint: string;  // https://api.openai.com/v1
  apiKey: string;
  model: string;     // gpt-4o-mini / qwen2.5-7b-instruct
  /** 提示词格式：chat=标准 OpenAI chat；qwen=ChatML；instruct=Llama INST；raw=纯文本拼接 */
  format?: PromptFormat;
  /** 自定义系统提示词前缀（覆盖默认值） */
  systemPrompt?: string;

  // ---------------- 模型能力开关 ----------------
  /** 是否支持图片/视觉输入（多模态设卡等功能依赖此标志） */
  supportsVision?: boolean;
  /** 是否受过「工具调用 / Function Calling」训练（用户需主动确认；文章抽取、实体关联等将改为按需取上下文，而非灌入候选库） */
  supportsTools?: boolean;
  /** 模型输出是否包含 <think> / <thinking> 等推理内容；UI 据此控制是否渲染/折叠思考块 */
  supportsThinking?: boolean;
  /** 是否支持联网搜索 */
  supportsWebSearch?: boolean;
  /** 联网搜索参数名，请求时注入 body（如 enable_search / web_search / search 等） */
  webSearchParam?: string;

  // ---------------- 计量与预算 ----------------
  /** 是否启用该模型的用量/费用统计 */
  requiresMetering?: boolean;
  /** 最大上下文窗口量（token），0 表示未设置 */
  contextWindow?: number;
  /** 输入 token 单价：每 1K tokens 多少元 */
  inputPricePer1K?: number;
  /** 输出 token 单价：每 1K tokens 多少元 */
  outputPricePer1K?: number;
  /** 费用预算上限（元），0 表示无限制 */
  budgetLimit?: number;
  /** Token 预算上限，0 表示无限制 */
  tokenBudget?: number;
}

/** 新模型的能力/计量默认值 */
export function getModelDefaults(): Partial<AIModel> {
  return {
    supportsVision: false,
    supportsThinking: false,
    supportsTools: false,
    supportsWebSearch: false,
    requiresMetering: true,
    contextWindow: 0,
    inputPricePer1K: 0,
    outputPricePer1K: 0,
    budgetLimit: 0,
    tokenBudget: 0,
  };
}

export interface AIStore {
  models: AIModel[];
  currentId: string;
  /** 共享嵌入模型（语义检索用），null 表示未配置 */
  embeddingModel: EmbeddingModel | null;
  setModels: (ms: AIModel[]) => void;
  addModel: (m: AIModel) => void;
  updateModel: (id: string, patch: Partial<AIModel>) => void;
  removeModel: (id: string) => void;
  setCurrent: (id: string) => void;
  getCurrent: () => AIModel | null;
  /** 设置/清空共享嵌入模型 */
  setEmbeddingModel: (m: EmbeddingModel | null) => void;
  /** 兼容旧版单模型：第一次初始化时从旧 localStorage 迁移 */
  migrate: () => void;
}

const LS_KEY = 'fl-ai-store-v2';

function withDefaults(m: AIModel): AIModel {
  return { ...MODEL_DEFAULTS, ...m };
}

function loadState(): Pick<AIStore, 'models' | 'currentId' | 'embeddingModel'> {
  // 桌面版由 main.tsx 启动期从磁盘注入；不读取 localStorage
  if (storage.isNative()) return { models: [], currentId: '', embeddingModel: null };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.models && Array.isArray(parsed.models)) {
        parsed.models = parsed.models.map(withDefaults);
      }
      return {
        models: parsed.models ?? [],
        currentId: parsed.currentId ?? '',
        embeddingModel: parsed.embeddingModel ?? (storage.lsGetEmbedding() as EmbeddingModel | null) ?? null,
      };
    }
    // 旧 key 迁移
    const old = localStorage.getItem('fl-ai-config');
    if (old) {
      const o = JSON.parse(old);
      const id = `m-${Date.now()}`;
      return { models: [withDefaults({ id, label: o.model || '默认', endpoint: o.endpoint || 'https://api.openai.com/v1', apiKey: o.apiKey || '', model: o.model || 'gpt-4o-mini' })], currentId: id, embeddingModel: (storage.lsGetEmbedding() as EmbeddingModel | null) ?? null };
    }
  } catch {}
  return { models: [], currentId: '', embeddingModel: (storage.lsGetEmbedding() as EmbeddingModel | null) ?? null };
}

function saveState(models: AIModel[], currentId: string) {
  storage.saveAI(models, currentId);
  // 触发 storage 事件供其他组件订阅
  window.dispatchEvent(new StorageEvent('storage', { key: LS_KEY }));
}

export const useAIStore = create<AIStore>((set, get) => {
  const init = loadState();
  return {
    models: init.models,
    currentId: init.currentId,
    embeddingModel: init.embeddingModel,
    setModels: (ms) => { saveState(ms, get().currentId); set({ models: ms }); },
    addModel: (m) => {
      const model = withDefaults(m);
      const models = [...get().models, model];
      const currentId = get().currentId || model.id;
      saveState(models, currentId);
      set({ models, currentId });
    },
    updateModel: (id, patch) => {
      const models = get().models.map((x) => x.id === id ? { ...x, ...patch } : x);
      saveState(models, get().currentId);
      set({ models });
    },
    removeModel: (id) => {
      const models = get().models.filter((x) => x.id !== id);
      const currentId = get().currentId === id ? (models[0]?.id ?? '') : get().currentId;
      saveState(models, currentId);
      set({ models, currentId });
    },
    setCurrent: (id) => { saveState(get().models, id); set({ currentId: id }); },
    getCurrent: () => get().models.find((m) => m.id === get().currentId) ?? null,
    setEmbeddingModel: (m) => { storage.saveEmbedding(m); set({ embeddingModel: m }); },
    migrate: () => { /* 已在 loadState 中处理 */ },
  };
});
