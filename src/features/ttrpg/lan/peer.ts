// ============================================================
// LAN 跑团桥接（Phase 4b）
// ------------------------------------------------------------
// 单例 LanPeer：
// - 房主（host）：经 preload IPC 操作主进程 WS 服务（lan:host-*），
//   收 lan:event 转发；业务路由（hello 应答/action 判定）在视图层
// - 客户端（client）：Chromium 原生 WebSocket 直连房主 WS 服务
//   （?room=&token= 认证），hello → joined 快照 → turns 同步
// ============================================================
import { parseLanMessage, type LanMessage } from './lanClient';

export interface LanHostInfo {
  port: number;
  roomCode: string;
  token: string;
  ips: string[];
}

export interface LanEventData {
  event: 'connect' | 'message' | 'close';
  id?: number;
  name?: string;
  payload?: LanMessage;
}

type LanEventCb = (ev: LanEventData) => void;

class LanPeer {
  role: 'idle' | 'host' | 'client' = 'idle';
  host: LanHostInfo | null = null;
  /** 房主侧：当前在线远程玩家名（hello 时登记） */
  remotePlayers: string[] = [];
  /** 客户端侧：本机玩家名 */
  selfName = '';
  private ws: WebSocket | null = null;
  private cb: LanEventCb | null = null;
  private unsub: (() => void) | null = null;

  onEvent(cb: LanEventCb): void {
    this.cb = cb;
  }

  /** 房主：启动 LAN 房间（WS 服务运行在主进程） */
  async startHost(roomCode: string, token: string): Promise<LanHostInfo> {
    const api = (window as any).api;
    if (!api?.lanHostStart) throw new Error('LAN 仅桌面版支持（浏览器环境无 IPC）');
    const res = await api.lanHostStart({ roomCode, token });
    if (!res?.ok) throw new Error('启动 LAN 房间失败');
    this.role = 'host';
    this.host = { port: res.port, roomCode: res.roomCode, token: res.token, ips: res.ips ?? [] };
    this.remotePlayers = [];
    if (!this.unsub) {
      this.unsub = api.onLanEvent((data: any) => {
        const ev: LanEventData = { event: data?.event, id: data?.id, name: data?.name, payload: data?.payload };
        if (ev.event === 'message' && ev.payload) {
          const p = ev.payload;
          if (p.type === 'hello' && typeof ev.name === 'string') {
            const set = new Set(this.remotePlayers);
            set.add(ev.name);
            this.remotePlayers = [...set];
          }
          if (p.type === 'player-left') {
            this.remotePlayers = this.remotePlayers.filter((n) => n !== p.name);
          }
        }
        this.cb?.(ev);
      });
    }
    return this.host;
  }

  async stopHost(): Promise<void> {
    const api = (window as any).api;
    try {
      await api?.lanHostStop?.();
    } catch { /* ignore */ }
    this.unsub?.();
    this.unsub = null;
    this.role = 'idle';
    this.host = null;
    this.remotePlayers = [];
  }

  /** 房主：广播给所有远程（except 排除指定玩家名） */
  async broadcast(payload: LanMessage, except?: string): Promise<boolean> {
    const api = (window as any).api;
    if (!api?.lanHostBroadcast) return false;
    const res = await api.lanHostBroadcast({ payload, except });
    return !!res?.ok;
  }

  /** 房主：定向发送给指定远程玩家 */
  async sendTo(name: string, payload: LanMessage): Promise<boolean> {
    const api = (window as any).api;
    if (!api?.lanHostSend) return false;
    const res = await api.lanHostSend({ name, payload });
    return !!res?.ok;
  }

  /** 客户端：加入房间（WebSocket 直连，hello 后等 joined 快照） */
  join(url: string, room: string, token: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        try { this.ws.close(); } catch { /* ignore */ }
      }
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${url}?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`);
      } catch (e: any) {
        reject(new Error(`地址格式错误：${e?.message ?? e}`));
        return;
      }
      this.ws = ws;
      this.selfName = name;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('连接超时（请检查地址、房间码与房主状态）'));
          try { ws.close(); } catch { /* ignore */ }
        }
      }, 8000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello', name, version: '1' }));
      };
      ws.onmessage = (e) => {
        const payload = parseLanMessage(String(e.data));
        if (!payload) return;
        if (payload.type === 'joined' && !settled) {
          settled = true;
          clearTimeout(timer);
          this.role = 'client';
          this.cb?.({ event: 'message', name: '', payload });
          resolve();
        } else if (payload.type === 'joined-error' && !settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(payload.error));
        } else {
          this.cb?.({ event: 'message', name: '', payload });
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('连接失败（地址/端口不可达或认证被拒）'));
        }
      };
      ws.onclose = () => {
        this.ws = null;
        this.cb?.({ event: 'close', name: '' });
      };
    });
  }

  /** 客户端：发送消息 */
  send(payload: LanMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** 客户端：离开 */
  leave(): void {
    try {
      this.ws?.close();
    } catch { /* ignore */ }
    this.ws = null;
    this.role = 'idle';
    this.selfName = '';
  }
}

export const lanPeer = new LanPeer();
