// ============================================================
// LAN 跑团协议（Phase 4b）
// ------------------------------------------------------------
// 纯函数层：消息解析 / 回合日志合并 / 玩家名校验 / 房间码生成。
// 房主与远程实例共用同一套协议，WS 只负责帧传输，业务在此层。
// ============================================================
import type { SessionTurn } from '../types';

/** LAN 消息协议（JSON 文本帧） */
export type LanMessage =
  | { type: 'hello'; name: string; version: string }
  | { type: 'joined'; ok: true; players: string[]; log: SessionTurn[]; title: string; rulebookName: string }
  | { type: 'joined-error'; ok: false; error: string }
  | { type: 'player-joined'; name: string }
  | { type: 'player-left'; name: string }
  | { type: 'action'; name: string; text: string }
  | { type: 'turns'; turns: SessionTurn[] }
  | { type: 'state'; name?: string; patch: Record<string, number | string> }
  | { type: 'error'; message: string };

/** 房主进程：玩家名列表（含本机房主）；远程实例：本地玩家名 + 远程名 */
export type LanPeerState = {
  role: 'host' | 'client';
  /** 本机玩家名（房主=会话玩家；客户端=输入的名字） */
  selfName: string;
  /** 当前房间内玩家名列表（房主侧维护；客户端侧为 joined 快照） */
  players: string[];
};

/** 安全解析入站消息；非法 JSON / 未知 type / 缺字段一律返回 null */
export function parseLanMessage(text: string): LanMessage | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const t = (m as any).type;
  switch (t) {
    case 'hello':
      return typeof (m as any).name === 'string' ? { type: 'hello', name: (m as any).name, version: String((m as any).version ?? '') } : null;
    case 'joined':
      return { type: 'joined', ok: true, players: Array.isArray((m as any).players) ? (m as any).players.filter((x: unknown) => typeof x === 'string') : [], log: Array.isArray((m as any).log) ? (m as any).log : [], title: String((m as any).title ?? ''), rulebookName: String((m as any).rulebookName ?? '') };
    case 'joined-error':
      return { type: 'joined-error', ok: false, error: String((m as any).error ?? '加入失败') };
    case 'player-joined':
      return typeof (m as any).name === 'string' ? { type: 'player-joined', name: (m as any).name } : null;
    case 'player-left':
      return typeof (m as any).name === 'string' ? { type: 'player-left', name: (m as any).name } : null;
    case 'action':
      return typeof (m as any).name === 'string' && typeof (m as any).text === 'string'
        ? { type: 'action', name: (m as any).name, text: (m as any).text }
        : null;
    case 'turns':
      return Array.isArray((m as any).turns) ? { type: 'turns', turns: (m as any).turns } : null;
    case 'state':
      return { type: 'state', name: (m as any).name, patch: (m as any).patch ?? {} };
    case 'error':
      return { type: 'error', message: String((m as any).message ?? '未知错误') };
    default:
      return null;
  }
}

/** 回合日志合并：按 id 去重、按 ts 升序（用于远程实例同步房主日志副本） */
export function mergeTurns(log: SessionTurn[], incoming: SessionTurn[]): SessionTurn[] {
  const byId = new Map<string, SessionTurn>();
  for (const t of log) if (t && t.id) byId.set(t.id, t);
  for (const t of incoming) if (t && t.id && !byId.has(t.id)) byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

/** 玩家名校验：返回错误信息（null = 通过）；空名 / 已存在 / 过长 */
export function validatePeerName(name: string, existing: string[]): string | null {
  const n = (name || '').trim();
  if (!n) return '玩家名不能为空';
  if (n.length > 16) return '玩家名过长（≤16 字符）';
  if (existing.includes(n)) return `玩家名「${n}」已被使用`;
  return null;
}

/** 生成房间码（6 位，去易混淆字符，与主进程字符集一致） */
export function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** 房主侧：新玩家加入的应答快照 */
export function buildJoinedPayload(opts: {
  players: string[];
  log: SessionTurn[];
  title: string;
  rulebookName: string;
}): LanMessage {
  return { type: 'joined', ok: true, players: opts.players, log: opts.log, title: opts.title, rulebookName: opts.rulebookName };
}
