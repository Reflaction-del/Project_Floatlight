import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-expect-error CJS 模块无类型声明
import { createLanServer } from './lan-server.cjs';

const ROOM = 'ABC123';
const TOKEN = 'test-token-abc';

const waitFor = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('websocket connect error'));
  });
}

function wsMsg(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.onmessage = (e) => resolve(JSON.parse(String(e.data)));
  });
}

describe('LAN WS 服务集成（真实 TCP + WebSocket）', () => {
  let server: any;
  let events: any[];

  beforeEach(async () => {
    events = [];
    server = createLanServer({ roomCode: ROOM, token: TOKEN, onEvent: (ev: any) => events.push(ev) });
    await server.ready();
  });
  afterEach(() => {
    try { server?.stop(); } catch { /* ignore */ }
  });

  it('错误房间码/令牌连接被拒，不产生任何事件', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port()}/?room=WRONG&token=${TOKEN}`);
    await new Promise<void>((resolve) => {
      ws.onerror = () => resolve();
      ws.onclose = () => resolve();
    });
    expect(events).toHaveLength(0);
    expect(server.clientNames()).toEqual([]);
  });

  it('正确认证 + hello → connect/message 事件 + 玩家登记', async () => {
    const ws = await openWs(`ws://127.0.0.1:${server.port()}/?room=${ROOM}&token=${TOKEN}`);
    ws.send(JSON.stringify({ type: 'hello', name: '小林', version: '1' }));
    await waitFor(100);
    expect(events.some((e) => e.event === 'connect')).toBe(true);
    expect(events.some((e) => e.event === 'message' && e.payload?.type === 'hello' && e.name === '小林')).toBe(true);
    expect(server.clientNames()).toContain('小林');
    ws.close();
    await waitFor(50);
  });

  it('broadcast 全员收到；sendTo 定向；except 排除', async () => {
    const a = await openWs(`ws://127.0.0.1:${server.port()}/?room=${ROOM}&token=${TOKEN}`);
    const b = await openWs(`ws://127.0.0.1:${server.port()}/?room=${ROOM}&token=${TOKEN}`);
    a.send(JSON.stringify({ type: 'hello', name: 'A', version: '1' }));
    b.send(JSON.stringify({ type: 'hello', name: 'B', version: '1' }));
    await waitFor(100);
    expect(server.clientNames()).toEqual(expect.arrayContaining(['A', 'B']));

    const receivedA: any[] = [];
    const receivedB: any[] = [];
    a.onmessage = (e) => receivedA.push(JSON.parse(String(e.data)));
    b.onmessage = (e) => receivedB.push(JSON.parse(String(e.data)));

    // broadcast
    const turn = { type: 'turns', turns: [{ id: 't1', ts: 1, kind: 'gm', who: 'GM', content: '开局' }] };
    server.broadcast(turn);
    await waitFor(100);
    expect(receivedA.some((m) => m.type === 'turns')).toBe(true);
    expect(receivedB.some((m) => m.type === 'turns')).toBe(true);

    // sendTo 只发 B
    receivedA.length = 0;
    receivedB.length = 0;
    server.sendTo('B', { type: 'error', message: 'only-B' });
    await waitFor(100);
    expect(receivedA).toHaveLength(0);
    expect(receivedB.some((m) => m.type === 'error' && m.message === 'only-B')).toBe(true);

    // except 排除 A
    receivedA.length = 0;
    receivedB.length = 0;
    server.broadcast({ type: 'error', message: 'not-A' }, 'A');
    await waitFor(100);
    expect(receivedA).toHaveLength(0);
    expect(receivedB.some((m) => m.type === 'error' && m.message === 'not-A')).toBe(true);

    a.close();
    b.close();
    await waitFor(50);
  });

  it('客户端发 action → 房主 onEvent 收到', async () => {
    const ws = await openWs(`ws://127.0.0.1:${server.port()}/?room=${ROOM}&token=${TOKEN}`);
    ws.send(JSON.stringify({ type: 'action', name: 'A', text: '用剑劈开大门' }));
    await waitFor(100);
    expect(events.some((e) => e.event === 'message' && e.payload?.type === 'action' && e.payload.text === '用剑劈开大门')).toBe(true);
    ws.close();
    await waitFor(50);
  });

  it('客户端断开 → close 事件（带已登记名字）', async () => {
    const ws = await openWs(`ws://127.0.0.1:${server.port()}/?room=${ROOM}&token=${TOKEN}`);
    ws.send(JSON.stringify({ type: 'hello', name: '临时玩家', version: '1' }));
    await waitFor(100);
    ws.close();
    await waitFor(150);
    expect(events.some((e) => e.event === 'close' && e.name === '临时玩家')).toBe(true);
    expect(server.clientNames()).not.toContain('临时玩家');
  });

  it('服务停止后连接被断', async () => {
    const ws = await openWs(`ws://127.0.0.1:${server.port()}/?room=${ROOM}&token=${TOKEN}`);
    server.stop();
    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
      ws.onerror = () => resolve();
    });
  });

  it('协议 ping（30s 心跳）不打断消息流', async () => {
    const ws = await openWs(`ws://127.0.0.1:${server.port()}/?room=${ROOM}&token=${TOKEN}`);
    ws.send(JSON.stringify({ type: 'hello', name: '心跳测试', version: '1' }));
    await waitFor(100);
    // 服务端广播仍能到达（ping 帧被 undici 自动 pong，不触发 onmessage）
    const p = wsMsg(ws);
    server.broadcast({ type: 'turns', turns: [] });
    const m = await p;
    expect(m.type).toBe('turns');
    ws.close();
  });
});
