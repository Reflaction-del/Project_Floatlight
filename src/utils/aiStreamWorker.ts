/// <reference lib="webworker" />
/**
 * AI 流式解析 Worker
 * ----------------
 * 把 SSE 流式请求的 fetch + 逐行解析放在独立线程，避免本地模型高频
 * 推流时占用 UI 主线程（主线程不再做 JSON.parse / 字符串拼接 / React 协调）。
 * 仅做纯网络与文本解析，不依赖任何 store，便于独立打包。
 */

// 在 Worker 线程中 self 即 DedicatedWorkerGlobalScope；用断言避免与 DOM lib 的 Window.self 冲突
const ctx: any = self;

type InMsg =
  | { type: 'start'; url: string; method: string; headers: Record<string, string>; body: string }
  | { type: 'complete'; url: string; method: string; headers: Record<string, string>; body: string }
  | { type: 'abort' };

let ctrl: AbortController | null = null;

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'abort') {
    ctrl?.abort();
    return;
  }
  if (msg.type === 'start') {
    void run(msg);
  } else if (msg.type === 'complete') {
    void runComplete(msg);
  }
};

async function run(msg: Extract<InMsg, { type: 'start' }>) {
  ctrl = new AbortController();
  try {
    const resp = await fetch(msg.url, {
      method: msg.method,
      headers: msg.headers,
      body: msg.body,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      ctx.postMessage({ type: 'error', error: `[HTTP ${resp.status}] ${text.slice(0, 300)}` });
      return;
    }
    await parseStream(resp);
    ctx.postMessage({ type: 'done' });
  } catch (err: any) {
    if (ctrl.signal.aborted) {
      // 用户手动终止：不发 error，发 done 让主线程清理
      ctx.postMessage({ type: 'done' });
    } else {
      ctx.postMessage({ type: 'error', error: err?.message || String(err) });
    }
  }
}

async function parseStream(resp: Response) {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m) continue;
      const data = m[1].trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text ?? '';
        if (token) ctx.postMessage({ type: 'token', token });
      } catch {
        /* 忽略不完整/非法行 */
      }
    }
  }
}

/**
 * 非流式（一次性）请求处理器：在 Worker 线程完成 fetch + 文本解析。
 * 关键点：不再用 resp.json() —— 部分本地 OpenAI 兼容服务（LM Studio / Ollama）
 * 会忽略请求的 stream:false 而直接回吐 SSE 流，resp.json() 内部逐块读取会形成
 * 死循环 / 反复重试，把 CPU 占满（与流式 Card/侧栏那次 bug 同源）。这里改用
 * readAllText 增量读取（每次 await reader.read() 都会让出事件循环）+ extractContent
 * 同时兼容「SSE 流」与「单条 JSON」两种响应体，一次性请求因此既能正确处理推流，
 * 又绝不会在主线程死循环。
 * 文章抽取 / 实体关联 / NL 建模板 / 草稿分析等所有 chatOnce / chatVision 调用都受益。
 */
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

/** 从响应体文本中提取 content 与 usage；兼容 SSE 流与单条 JSON 两种格式。 */
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

async function runComplete(msg: Extract<InMsg, { type: 'complete' }>) {
  ctrl = new AbortController();
  try {
    const resp = await fetch(msg.url, {
      method: msg.method,
      headers: msg.headers,
      body: msg.body,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      ctx.postMessage({ type: 'complete-error', error: `[HTTP ${resp.status}] ${text.slice(0, 300)}` });
      return;
    }
    const raw = await readAllText(resp);
    const { content, usage } = extractContent(raw);
    const snap = usage
      ? {
          prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
          completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
          total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : 0,
        }
      : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    ctx.postMessage({ type: 'complete-result', text: content, usage: snap });
  } catch (err: any) {
    if (ctrl.signal.aborted) {
      ctx.postMessage({ type: 'complete-error', error: 'aborted' });
      return;
    }
    ctx.postMessage({ type: 'complete-error', error: err?.message || String(err) });
  }
}
