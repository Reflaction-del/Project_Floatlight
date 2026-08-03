// ============================================================
// AI 调用日志总线（进度窗口数据源）
// ------------------------------------------------------------
// 所有大模型调用（chatOnce / chatStream / chatWithTools /
// embedTexts / generateImage / testConnection 等）通过 logAI()
// 上报阶段与原始回复摘要；AILogPanel 订阅后实时展示，
// 用于排查「模型返回为空 / 配置后无法立即使用」等问题。
// 纯内存、不落盘；模块级单例，不依赖 React。
// ============================================================

export type AILogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface AILogEntry {
  /** epoch ms */
  time: number;
  level: AILogLevel;
  /** 功能/场景，如 article-extract / chat / vision / embed */
  phase: string;
  message: string;
  /** 可选：请求/响应细节（URL、状态码等） */
  detail?: string;
  /** 可选：模型原始回复（截断后） */
  raw?: string;
}

const MAX_ENTRIES = 500;

const entries: AILogEntry[] = [];
const listeners = new Set<(entries: AILogEntry[]) => void>();

export function logAI(entry: Omit<AILogEntry, 'time'>): void {
  const full: AILogEntry = { time: Date.now(), ...entry };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const cb of listeners) cb(entries);
}

export function clearAILogs(): void {
  entries.length = 0;
  for (const cb of listeners) cb(entries);
}

export function getAILogs(): AILogEntry[] {
  return entries.slice();
}

export function subscribeAI(cb: (entries: AILogEntry[]) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** 取一条日志的展示时间（HH:MM:SS） */
export function fmtLogTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 截断长文本到 N 字符（保留首尾标记） */
export function truncate(s: string, n = 500): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + `\n…（已截断，共 ${s.length} 字符）` : s;
}
