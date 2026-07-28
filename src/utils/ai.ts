/** OpenAI 兼容 API 流式/非流式调用 + 多模型管理 */

import { useAIStore, type AIModel, type EmbeddingModel, type PromptFormat } from '../store/aiStore';
import { useAIUsageStore, type AIUsageFeature } from '../store/aiUsageStore';

/** 多模态内容片段：纯文本 或 图片（dataURL）。Chat 格式（OpenAI 兼容）原样支持。 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type AIMessage = {
  role: 'system' | 'user' | 'assistant';
  /** 普通对话为字符串；多模态（如带图片的 user 消息）为内容片段数组 */
  content: string | ChatContentPart[];
  thinking?: string;
};

/** 取一条消息的纯文本（多模态时拼接 text 片段），用于计量、思维链解析、搜索等场景 */
export function contentText(content: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('\n');
}

export function getCurrentModel(): AIModel | null {
  const s = useAIStore.getState();
  return s.models.find((m) => m.id === s.currentId) ?? null;
}

/** 从模型输出中分离推理（thinking）与正式回复。
 * 兼容 <think>...</think>、<thinking>...</thinking> 及纯文本 think 标签（不区分大小写）。
 * 若存在多个 think 块，会合并为一段。 */
export function splitThinking(content: string | ChatContentPart[]): { thinking: string; rest: string } {
  const text = typeof content === 'string' ? content : contentText(content);
  if (!text) return { thinking: '', rest: '' };
  const openTagRe = /<(think|thinking)\b[^>]*>/i;
  const closeTagRe = /<\/(think|thinking)>/i;

  // 1) 提取已完整闭合的 think 块
  const fullPatterns = [
    /<think\b[^>]*>([\s\S]*?)<\/think>/gi,
    /<thinking\b[^>]*>([\s\S]*?)<\/thinking>/gi,
  ];
  const parts: string[] = [];
  let rest = text;
  for (const re of fullPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      parts.push(m[1].trim());
    }
    rest = rest.replace(re, '\n\n').trim();
  }

  // 2) 流式未闭合：若存在 <think> 但后面没有 </think>，把从 <think> 到末尾都视为 thinking
  // 避免用户看到 raw 的 <think> 标签把主内容顶出可视区
  let extraThinking = '';
  const lastOpen = rest.match(openTagRe);
  if (lastOpen) {
    const afterOpen = rest.slice(lastOpen.index! + lastOpen[0].length);
    if (!closeTagRe.test(afterOpen)) {
      extraThinking = afterOpen.trim();
      rest = rest.slice(0, lastOpen.index!).trim();
    }
  }

  // 3) 合并
  const thinking = [...parts, extraThinking].filter(Boolean).join('\n\n---\n\n');
  return { thinking, rest: rest.replace(/\n{3,}/g, '\n\n').trim() };
}

export function getAllModels() {
  return useAIStore.getState().models;
}

/** 拼装 chat 格式的 messages 数组 */
function buildMessages(model: AIModel, systemDefault: string, history: AIMessage[], systemOverride?: string): AIMessage[] {
  const sys = systemOverride ?? model.systemPrompt ?? systemDefault;
  const msgs: AIMessage[] = [];
  if (sys) msgs.push({ role: 'system', content: sys });
  msgs.push(...history);
  return msgs;
}

export interface ChatStreamOpts {
  /** 覆盖系统提示词（优先级高于 model.systemPrompt，用于注入世界观约束） */
  systemOverride?: string;
  /** 采样温度（可选） */
  temperature?: number;
  /** 用于手动终止模型响应的 AbortSignal */
  signal?: AbortSignal;
}

/** 格式化为 Qwen ChatML 风格：<|im_start|>system\n...<|im_end|>\n<|im_start|>user\n...<|im_end|>\n<|im_start|>assistant\n */
function formatQwen(systemDefault: string, model: AIModel, history: AIMessage[]): string {
  const sys = model.systemPrompt || systemDefault;
  let p = '';
  if (sys) p += `<|im_start|>system\n${sys}<|im_end|>\n`;
  for (const m of history) {
    p += `<|im_start|>${m.role}\n${contentText(m.content)}<|im_end|>\n`;
  }
  p += '<|im_start|>assistant\n';
  return p;
}

/** 格式化为 Llama2/3 INST 风格：[INST] <<SYS>>\n...\n<</SYS>>\n\n{user}[/INST]{assistant}[INST]{user}[/INST] */
function formatInstruct(systemDefault: string, model: AIModel, history: AIMessage[]): string {
  const sys = model.systemPrompt || systemDefault;
  const sysBlock = sys ? `<<SYS>>\n${sys}\n<</SYS>>\n\n` : '';
  let p = '';
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === 'user') {
      if (i === 0 && sys) p += `<s>[INST] ${sysBlock}${contentText(m.content)} [/INST]`;
      else p += `<s>[INST] ${contentText(m.content)} [/INST]`;
    } else if (m.role === 'assistant') {
      p += ` ${contentText(m.content)}</s>`;
    }
  }
  return p;
}

/** 纯文本拼接：仅最后一条 user 作为 prompt，前面作为前缀 */
function formatRaw(systemDefault: string, model: AIModel, history: AIMessage[]): string {
  const sys = model.systemPrompt || systemDefault;
  let p = '';
  if (sys) p += sys + '\n\n';
  for (const m of history) {
    if (m.role === 'system') p += contentText(m.content) + '\n\n';
    else if (m.role === 'user') p += 'User: ' + contentText(m.content) + '\n';
    else if (m.role === 'assistant') p += 'Assistant: ' + contentText(m.content) + '\n';
  }
  p += 'Assistant:';
  return p;
}

const FORMATTERS: Record<PromptFormat, (sys: string, m: AIModel, h: AIMessage[]) => string> = {
  chat: () => '', // chat 用 buildMessages，不走 formatter
  qwen: formatQwen,
  instruct: formatInstruct,
  raw: formatRaw,
};

/** 流式 chat completion
 * 网络请求与 SSE 解析全部在 Web Worker 线程进行（真正的多线程），
 * 主线程仅以 requestAnimationFrame 节流、把累积的 token 批量交给 onToken，
 * 避免本地模型高频推流时主线程被 JSON.parse / 重渲染占满导致界面卡顿。
 */
export async function chatStream(
  model: AIModel,
  history: AIMessage[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError?: (err: string) => void,
  opts?: ChatStreamOpts,
): Promise<void> {
  const format: PromptFormat = model.format ?? 'chat';
  const systemDefault = '你是一个专业的写作和世界观构建助手。';
  const base = model.endpoint.replace(/\/+$/, '');
  const sysDefault = opts?.systemOverride ?? systemDefault;

  let url: string;
  let bodyStr: string;
  if (format === 'chat') {
    url = `${base}/chat/completions`;
    const payload: Record<string, unknown> = { model: model.model, messages: buildMessages(model, systemDefault, history, opts?.systemOverride), stream: true };
    if (typeof opts?.temperature === 'number') payload.temperature = opts.temperature;
    injectWebSearchParam(model, payload);
    bodyStr = JSON.stringify(payload);
  } else {
    // 走 /v1/completions（兼容性模式）
    url = `${base}/completions`;
    const prompt = FORMATTERS[format](sysDefault, model, history);
    const payload: Record<string, unknown> = { model: model.model, prompt, stream: true, max_tokens: 4096 };
    if (typeof opts?.temperature === 'number') payload.temperature = opts.temperature;
    bodyStr = JSON.stringify(payload);
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` };

  await runStreamInWorker({ url, method: 'POST', headers, body: bodyStr, signal: opts?.signal, onToken, onDone, onError });
}

interface StreamReq {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  onToken: (t: string) => void;
  onDone: () => void;
  onError?: (err: string) => void;
}

/** 在 Worker 线程执行流式请求；UI 更新通过 rAF 合并，避免每 token 重渲染 */
function runStreamInWorker(req: StreamReq): Promise<void> {
  return new Promise<void>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./aiStreamWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      // 极少数环境（如老式 webview）不支持 Worker，退化为主线程流式
      fallbackStream(req).then(resolve);
      return;
    }

    let raf = 0;
    let buffer = '';
    let finished = false;

    const flush = () => {
      raf = 0;
      if (buffer) {
        req.onToken(buffer);
        buffer = '';
      }
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (buffer) { req.onToken(buffer); buffer = ''; }
      try { worker.terminate(); } catch { /* ignore */ }
      resolve();
    };

    worker.onmessage = (e: MessageEvent<any>) => {
      const msg = e.data;
      if (msg.type === 'token') {
        buffer += msg.token;
        if (!raf) raf = requestAnimationFrame(flush);
      } else if (msg.type === 'done') {
        req.onDone();
        finish();
      } else if (msg.type === 'error') {
        req.onError?.(msg.error);
        finish();
      }
    };

    worker.onerror = (err) => {
      req.onError?.(err.message || 'worker error');
      finish();
    };

    if (req.signal) {
      if (req.signal.aborted) {
        try { worker.terminate(); } catch { /* ignore */ }
        resolve();
        return;
      }
      req.signal.addEventListener('abort', () => {
        try { worker.postMessage({ type: 'abort' }); } catch { /* ignore */ }
        finish();
      }, { once: true });
    }

    worker.postMessage({ type: 'start', url: req.url, method: req.method, headers: req.headers, body: req.body });
  });
}

/** 主线程退化路径（Worker 不可用时） */
async function fallbackStream(req: StreamReq): Promise<void> {
  try {
    const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: req.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    await parseStreamFallback(resp, req.onToken, req.signal);
    req.onDone();
  } catch (e: any) {
    if (req.signal?.aborted) { req.onDone(); return; }
    req.onError?.(e.message || String(e));
  }
}

async function parseStreamFallback(resp: Response, onToken: (t: string) => void, signal?: AbortSignal) {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let raf = 0;
  let buffer = '';
  const flush = () => {
    raf = 0;
    if (buffer) {
      onToken(buffer);
      buffer = '';
    }
  };
  const cleanup = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (buffer) { onToken(buffer); buffer = ''; }
  };
  try {
    while (true) {
      if (signal?.aborted) { try { reader.cancel(); } catch { /* ignore */ } break; }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (signal?.aborted) break;
        const m = line.match(/^data:\s*(.+)$/);
        if (!m) continue;
        const data = m[1].trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text ?? '';
          if (token) {
            buffer += token;
            if (!raf) raf = requestAnimationFrame(flush);
          }
        } catch { /* ignore */ }
      }
      if (signal?.aborted) break;
    }
  } finally {
    cleanup();
  }
}

/* ============================================================
 * 非流式（一次性）请求的 Worker 线程化
 * 把 chatOnce / chatVision 的 fetch + JSON.parse 移到 Worker，
 * 主线程在本地模型慢响应期间完全空闲，UI 不卡。
 * ============================================================ */

interface CompleteReq {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export interface AIUsageSnapshot {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** 若模型配置支持联网搜索且指定了参数名，则注入到请求体 */
function injectWebSearchParam(model: AIModel, payload: Record<string, unknown>) {
  if (model.supportsWebSearch && model.webSearchParam?.trim()) {
    payload[model.webSearchParam.trim()] = true;
  }
}

/** 记录 AI 用量（计量默认开启，仅显式 requiresMetering===false 才跳过） */
function trackAIUsage(model: AIModel, feature: AIUsageFeature, usage: AIUsageSnapshot) {
  if (model.requiresMetering === false) return;
  useAIUsageStore.getState().record({
    modelId: model.id,
    modelLabel: model.label || model.model,
    feature,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  });
}

/** 在 Worker 线程执行一次性请求，返回模型回复文本（content）与 usage。 */
function runCompleteInWorker(req: CompleteReq): Promise<{ text: string; usage: AIUsageSnapshot }> {
  return new Promise<{ text: string; usage: AIUsageSnapshot }>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./aiStreamWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      fallbackComplete(req).then(resolve, reject);
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { worker.terminate(); } catch { /* ignore */ }
    };
    worker.onmessage = (e: MessageEvent<any>) => {
      const msg = e.data;
      if (msg.type === 'complete-result') {
        finish();
        resolve({ text: msg.text ?? '', usage: msg.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      } else if (msg.type === 'complete-error') {
        finish();
        reject(new Error(msg.error));
      }
    };
    worker.onerror = (err) => {
      finish();
      reject(new Error(err.message || 'worker error'));
    };
    if (req.signal) {
      if (req.signal.aborted) {
        finish();
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      req.signal.addEventListener('abort', () => {
        finish();
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    }
    worker.postMessage({ type: 'complete', url: req.url, method: req.method, headers: req.headers, body: req.body });
  });
}

/** 增量读取响应体全文：每次 await reader.read() 都会让出事件循环，
 * 不会像 resp.json() 那样在流式响应上形成主线程死循环。 */
async function readAllText(resp: Response): Promise<string> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/** 从响应体文本中提取 content 与 usage；兼容 SSE 流与单条 JSON 两种格式。
 * 部分本地服务会忽略 stream:false 而回吐 SSE，resp.json() 无法解析 → 这里统一兜底。 */
function extractContent(text: string): { content: string; usage: any } {
  const t = (text || '').trim();
  const lines = t.split('\n');
  let isSSE = false;
  for (const line of lines) {
    if (/^data:\s*/.test(line)) { isSSE = true; break; }
  }
  if (isSSE) {
    let content = '';
    let usage: any = null;
    for (const line of lines) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m) continue;
      const d = m[1].trim();
      if (d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        content += j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.text ?? '';
        if (j?.usage) usage = j.usage;
      } catch { /* 忽略不完整/非法行 */ }
    }
    return { content, usage };
  }
  try {
    const j = JSON.parse(t);
    return { content: j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? '', usage: j?.usage ?? null };
  } catch {
    return { content: t, usage: null };
  }
}

/** 主线程退化路径（Worker 不可用时）：fetch + 增量读取 + 解析 content + usage。
 * 与 Worker 端 runComplete 完全一致的处理逻辑，确保本地模型推流时主线程也能让出、不卡死。 */
async function fallbackComplete(req: CompleteReq): Promise<{ text: string; usage: AIUsageSnapshot }> {
  try {
    const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: req.signal });
    if (!resp.ok) throw new Error(`[HTTP ${resp.status}] ${(await resp.text()).slice(0, 300)}`);
    const raw = await readAllText(resp);
    const { content, usage } = extractContent(raw);
    const snap: AIUsageSnapshot = usage
      ? {
          prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
          completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
          total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : 0,
        }
      : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return { text: content, usage: snap };
  } catch (e: any) {
    if (req.signal?.aborted) throw new Error('aborted');
    throw e;
  }
}

export interface ChatOnceOpts {
  /** 用于手动终止模型响应的 AbortSignal */
  signal?: AbortSignal;
  /** 采样温度（可选） */
  temperature?: number;
  /** 最大输出 token 数（可选） */
  maxTokens?: number;
  /** 用量中心统计场景 */
  feature?: AIUsageFeature;
}

/** 非流式 simple chat —— 网络与 JSON 解析均在 Worker 线程执行（见 runCompleteInWorker），
 * 主线程在模型响应期间不阻塞，避免本地模型慢推流时界面卡顿。 */
export async function chatOnce(model: AIModel, history: AIMessage[], opts?: ChatOnceOpts | AbortSignal): Promise<string> {
  const options: ChatOnceOpts = opts instanceof AbortSignal ? { signal: opts } : (opts ?? {});
  const format: PromptFormat = model.format ?? 'chat';
  const systemDefault = '你是一个专业的写作和世界观构建助手。';
  const base = model.endpoint.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` };

  let url: string;
  let bodyStr: string;
  if (format === 'chat') {
    url = `${base}/chat/completions`;
    const payload: Record<string, unknown> = {
      model: model.model,
      messages: buildMessages(model, systemDefault, history),
      stream: false,
    };
    if (typeof options.temperature === 'number') payload.temperature = options.temperature;
    if (typeof options.maxTokens === 'number') payload.max_tokens = options.maxTokens;
    injectWebSearchParam(model, payload);
    bodyStr = JSON.stringify(payload);
  } else {
    url = `${base}/completions`;
    const prompt = FORMATTERS[format](systemDefault, model, history);
    const payload: Record<string, unknown> = {
      model: model.model,
      prompt,
      stream: false,
      max_tokens: typeof options.maxTokens === 'number' ? options.maxTokens : 4096,
    };
    if (typeof options.temperature === 'number') payload.temperature = options.temperature;
    injectWebSearchParam(model, payload);
    bodyStr = JSON.stringify(payload);
  }

  const { text, usage } = await runCompleteInWorker({ url, method: 'POST', headers, body: bodyStr, signal: options.signal });
  if (options.feature) trackAIUsage(model, options.feature, usage);
  return text;
}

/* ============================================================
 * 多模态视觉输入（功能2 多模态设卡）
 * 仅 chat 格式支持 image_url 内容数组；其余格式（qwen/instruct/raw）
 * 无标准视觉输入规范，显式报错引导用户改用 chat 格式 + 视觉模型。
 * ============================================================ */

export interface ChatVisionOpts {
  /** 采样温度（可选） */
  temperature?: number;
  /** 用于手动终止模型响应的 AbortSignal */
  signal?: AbortSignal;
  /** 用量中心统计场景 */
  feature?: AIUsageFeature;
}

/** 多模态 chat：图文一起发给视觉模型，返回纯文本（通常为 JSON）。
 * 要求模型格式为 chat 且支持视觉（如 gpt-4o / qwen-vl / glm-4v 等）。
 * @param text 文字指令（可含世界观背景说明）
 * @param images 图片 dataURL 数组（支持多图；建议单图先试）
 */
export async function chatVision(
  model: AIModel,
  text: string,
  images: string[],
  opts?: ChatVisionOpts,
): Promise<string> {
  const format: PromptFormat = model.format ?? 'chat';
  if (!model.supportsVision) {
    throw new Error(
      '当前模型未标记支持视觉。请在「设置 → 大模型接入」中勾选该模型的「支持视觉输入」，并确认模型格式为 chat。',
    );
  }
  if (format !== 'chat') {
    throw new Error(
      `当前模型格式「${format}」不支持图片输入。请在「设置 → 大模型接入」中将模型格式设为 chat，并使用支持视觉的模型（如 gpt-4o / qwen-vl / glm-4v 系列）。`,
    );
  }
  const base = model.endpoint.replace(/\/+$/, '');
  const url = `${base}/chat/completions`;

  // 系统提示：偏世界观构建助手；用户内容用多模态 parts 拼装
  const sysDefault = '你是一个专业的视觉世界观构建助手，能看懂图片并抽取可用于设定集的结构化信息。';
  const sys = model.systemPrompt || sysDefault;

  const contentParts: any[] = [];
  for (const img of images) {
    // 仅接受 dataURL；data:image/...;base64, 或 data:image/png;base64,
    if (typeof img === 'string' && img.startsWith('data:image')) {
      contentParts.push({ type: 'image_url', image_url: { url: img } });
    }
  }
  if (contentParts.length === 0) {
    throw new Error('没有可用的图片（image_url），请确认传入的是 dataURL 图片。');
  }
  contentParts.push({ type: 'text', text });

  const messages: any[] = [];
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: contentParts });

  const payload: Record<string, unknown> = {
    model: model.model,
    messages,
    stream: false,
  };
  if (typeof opts?.temperature === 'number') payload.temperature = opts.temperature;
  injectWebSearchParam(model, payload);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` };
  const { text: visionText, usage } = await runCompleteInWorker({
    url,
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: opts?.signal,
  });
  if (opts?.feature) trackAIUsage(model, opts.feature, usage);
  return visionText;
}

/* ============================================================
 * 嵌入（Embedding）语义向量 —— 全应用共享一个 EmbeddingModel，
 * 用于语义检索（区别于聊天用的 AIModel）。批量请求 /embeddings，
 * 响应为单条 JSON（embedding 端点不会像 chat 那样推 SSE 流）。
 * ============================================================ */

/** 批量生成文本向量；返回与输入顺序一致的向量数组。
 * 失败时直接抛错，由调用方决定回退到词法检索。 */
export async function embedTexts(model: EmbeddingModel, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const base = model.endpoint.replace(/\/+$/, '');
  const url = `${base}/embeddings`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` };
  const payload = { model: model.model, input: texts };
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`[HTTP ${resp.status}] ${t.slice(0, 300)}`);
  }
  const raw = await readAllText(resp);
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('嵌入模型返回无法解析为 JSON');
  }
  const data = json?.data;
  if (!Array.isArray(data) || data.length === 0) throw new Error('嵌入模型返回格式异常（无 data）');
  // 部分服务按 index 排序返回，确保与输入顺序一致
  data.sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
  return data.map((d: any) => (Array.isArray(d?.embedding) ? d.embedding : []));
}

/* ============================================================
 * 工具调用（Function Calling）—— 让模型按需拉取世界观上下文，
 * 而非把候选库全量灌入 prompt。多轮循环：模型可调用
 * search_entities / get_entity 等工具，执行结果回传，直到产出最终回答。
 * 主线程以 fetch + 增量读取（readAllText）执行，每轮 await 让出事件循环，
 * 不会像 resp.json() 那样在流式响应上忙等占满 CPU。
 * ============================================================ */

/** 模型是否支持工具调用：仅 chat 格式 + 用户主动确认「受过工具使用训练」 */
export function modelSupportsTools(model: AIModel): boolean {
  return (model.format ?? 'chat') === 'chat' && !!model.supportsTools;
}

/** 工具定义（OpenAI function calling 风格） */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema 对象
}

/** 工具上下文：列出可用工具 + 执行器（返回字符串结果） */
export interface ToolContext {
  tools: ToolDef[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<string> | string;
}

interface RawToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface RawMessage {
  role: string;
  content: string | null;
  tool_calls?: RawToolCall[];
}

/** 从响应体（可能是 SSE 流或单条 JSON）抽取 assistant message（含 tool_calls）。
 * 本地服务常无视 stream:false 而推 SSE，此处统一兜底：SSE 下按 index 累加 tool_calls 增量。 */
function parseMessageFromBody(text: string): RawMessage {
  const t = (text || '').trim();
  const lines = t.split('\n');
  let isSSE = false;
  for (const line of lines) {
    if (/^data:\s*/.test(line)) { isSSE = true; break; }
  }
  if (isSSE) {
    let content = '';
    const tcMap = new Map<number, RawToolCall>();
    for (const line of lines) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m) continue;
      const d = m[1].trim();
      if (d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        const delta = j?.choices?.[0]?.delta ?? {};
        if (typeof delta.content === 'string') content += delta.content;
        const tcs = delta.tool_calls;
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            if (!tcMap.has(idx)) tcMap.set(idx, { id: '', type: 'function', function: { name: '', arguments: '' } });
            const cur = tcMap.get(idx)!;
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.function.name += tc.function.name;
            if (typeof tc.function?.arguments === 'string') cur.function.arguments += tc.function.arguments;
          }
        }
      } catch { /* 忽略不完整行 */ }
    }
    const tool_calls = [...tcMap.values()].filter((c) => c.function.name);
    return { role: 'assistant', content: content || null, tool_calls: tool_calls.length ? tool_calls : undefined };
  }
  try {
    const j = JSON.parse(t);
    const msg = j?.choices?.[0]?.message ?? {};
    return { role: msg.role || 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls };
  } catch {
    return { role: 'assistant', content: t, tool_calls: undefined };
  }
}

/** 宽松解析工具参数（容忍被截断的不完整 JSON） */
function safeParseArgs(s: string): Record<string, unknown> {
  const str = (s || '').trim();
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    // 尝试补齐缺失的右括号
    try {
      const open = (str.match(/{/g) || []).length;
      const close = (str.match(/}/g) || []).length;
      if (open > close) return JSON.parse(str + '}'.repeat(open - close));
    } catch { /* ignore */ }
    return {};
  }
}

/**
 * 带工具调用的多轮对话。模型可在回答前调用 tools 中的工具（按需检索上下文），
 * 执行结果以 tool 角色消息回传，循环直至产出无 tool_calls 的最终回答。
 * @returns 最终回答文本（content）
 */
export async function chatWithTools(
  model: AIModel,
  seedMessages: AIMessage[],
  ctx: ToolContext,
  opts?: ChatOnceOpts,
): Promise<string> {
  if ((model.format ?? 'chat') !== 'chat') {
    throw new Error(
      '当前模型格式「' + (model.format ?? 'chat') + '」不支持工具调用。请在「设置 → 大模型接入」中将模型格式设为 chat，并确认模型受过工具使用训练（勾选「支持工具调用」）。',
    );
  }
  if (ctx.tools.length === 0) {
    // 无工具时退化为普通一次性调用
    return chatOnce(model, seedMessages, opts);
  }
  const base = model.endpoint.replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` };
  const toolsPayload = ctx.tools.map((tp) => ({
    type: 'function',
    function: { name: tp.name, description: tp.description, parameters: tp.parameters },
  }));

  const messages: any[] = seedMessages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : contentText(m.content),
  }));

  const MAX_TURNS = 8;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const payload: Record<string, unknown> = {
      model: model.model,
      messages,
      tools: toolsPayload,
      stream: false,
      tool_choice: 'auto',
    };
    if (typeof opts?.temperature === 'number') payload.temperature = opts.temperature;
    if (typeof opts?.maxTokens === 'number') payload.max_tokens = opts.maxTokens;

    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: opts?.signal });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`[HTTP ${resp.status}] ${t.slice(0, 300)}`);
    }
    const raw = await readAllText(resp);
    const msg = parseMessageFromBody(raw);
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content ?? '';
    }
    // 回传 assistant（含 tool_calls）与每个工具的 result
    messages.push({
      role: 'assistant',
      content: msg.content ?? '',
      tool_calls: msg.tool_calls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })),
    });
    for (const tc of msg.tool_calls) {
      let result: string;
      try {
        const args = safeParseArgs(tc.function.arguments || '{}');
        const r = ctx.callTool(tc.function.name, args);
        result = await r;
      } catch (e: any) {
        result = '工具执行出错：' + (e?.message || String(e));
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
  throw new Error('工具调用回合超过上限（' + MAX_TURNS + '），仍未得到最终回答。');
}

/** 测试连接 */
export async function testConnection(model: AIModel): Promise<string> {
  try {
    const r = await chatOnce(model, [{ role: 'user', content: 'Hello. Reply only "OK".' }], { feature: 'test' });
    return r || '无法获取响应';
  } catch (e: any) { return e.message || String(e); }
}

/** 拉取 /v1/models */
export async function listModels(model: AIModel): Promise<string[]> {
  const url = `${model.endpoint.replace(/\/+$/, '')}/models`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${model.apiKey}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    return (json.data || []).map((m: any) => m.id).filter(Boolean);
  } catch (e: any) { throw new Error(e.message); }
}

/** 模型名合法性校验：带斜杠/空格/中文括号/为空时警告 */
export function validateModelName(name: string): string | null {
  if (!name || !name.trim()) return '模型名不能为空';
  if (name.includes('/') || name.includes(' ')) return '模型名不应包含"/"或空格，请检查 LM Studio 中实际加载的模型名（应如 "qwen2.5-7b-instruct"）';
  if (/[（()）]/.test(name)) return '模型名不应含中文括号或全角符号';
  return null;
}

/* ============================================================
 * 文生图（OpenAI 兼容 images/generations）
 * 决策（工单 §0.1 / 用户决策 #2）：头像生成走
 *   POST {base_url}/images/generations
 * refImage 作为参考图传入，用于锁定同角色一致；
 * 不支持 img2img 的 provider 会 4xx，此时退化为
 * 「强 prompt（含一致性约束）+ 去掉参考图」重试一次。
 * ============================================================ */

export interface GenerateImageOpts {
  model?: AIModel;
  prompt: string;
  /** 参考图 dataURL（锁定同角色一致）。可选。 */
  refImageDataUrl?: string;
  /** 输出尺寸，默认 512x512（部分 provider 仅支持特定尺寸） */
  size?: string;
}

export interface GenerateImageResult {
  dataUrl: string;
  rawUrl?: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('图片读取失败'));
    r.readAsDataURL(blob);
  });
}

export async function generateImage(opts: GenerateImageOpts): Promise<GenerateImageResult> {
  const model = opts.model ?? getCurrentModel();
  if (!model) {
    throw new Error('未配置 AI 模型：请打开 设置 → 大模型接入 添加（endpoint / api_key / model）。');
  }
  const base = model.endpoint.replace(/\/+$/, '');
  const url = `${base}/images/generations`;
  const size = opts.size || '512x512';

  const tryOnce = async (withRef: boolean): Promise<GenerateImageResult> => {
    const payload: Record<string, unknown> = {
      model: model.model,
      prompt: opts.prompt,
      n: 1,
      size,
    };
    if (withRef && opts.refImageDataUrl) {
      // 主流兼容端点（gpt-image-1 / 通义万相 OpenAI 兼容层 / SD 兼容网关等）多接受 image 字段
      payload.image = opts.refImageDataUrl;
      // 即便 provider 忽略 image 字段，也把一致性约束写进 prompt 兜底
      payload.prompt =
        `${opts.prompt}\n[一致性约束：严格保持与参考图相同的角色外貌、发型、服饰配色与五官特征，仅做风格化重绘]`;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 400);
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    const json: any = await resp.json();
    const item = json?.data?.[0];
    if (!item) throw new Error('图像生成返回为空');
    if (item.b64_json) {
      const prefix = item.b64_json.startsWith('data:') ? '' : 'data:image/png;base64,';
      return { dataUrl: prefix + item.b64_json };
    }
    if (item.url) {
      const imgResp = await fetch(item.url);
      const blob = await imgResp.blob();
      return { dataUrl: await blobToDataUrl(blob), rawUrl: item.url };
    }
    throw new Error('无法解析图像返回（无 b64_json / url）');
  };

  try {
    const result = await tryOnce(true);
    if (model.requiresMetering !== false) {
      useAIUsageStore.getState().recordImageGen(model);
    }
    return result;
  } catch (e: any) {
    // 退化：去掉参考图，用强 prompt 重试一次
    if (opts.refImageDataUrl) {
      try {
        const result = await tryOnce(false);
        if (model.requiresMetering !== false) {
          useAIUsageStore.getState().recordImageGen(model);
        }
        return result;
      } catch {
        throw e;
      }
    }
    throw e;
  }
}
