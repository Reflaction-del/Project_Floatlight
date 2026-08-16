// ============================================================
// 聊天接入 · 桥接类型（Phase 3.5）
// ============================================================

/** 草稿来源标记（聊天平台） */
export interface DraftSource {
  platform: string;
  userId: string;
  nickname: string;
  ts: number;
}

/** 接入日志条目（WorldData.bridgeLog） */
export interface BridgeEntry {
  id: string;
  ts: number;
  platform: string;
  userId: string;
  nickname: string;
  text: string;
  mode: 'structured' | 'raw';
  draftId: string;
  summary?: string;
  outlineHint?: { id: string; title: string };
  /** 处理结果（成功/失败原因） */
  ok: boolean;
  error?: string;
}
