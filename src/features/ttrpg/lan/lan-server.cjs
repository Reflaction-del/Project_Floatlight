// ============================================================
// LAN 跑团 WS 服务（Phase 4b）— 纯 Node 模块（无 Electron 依赖）
// ------------------------------------------------------------
// 单份实现：electron-main.cjs 的 startLanHost 调用本模块；
// vitest 以真实 TCP + WebSocket 集成测试覆盖。
// 握手校验 ?room=房间码&token=令牌；事件经 onEvent 回调对外暴露。
// ============================================================
'use strict';

const http = require('http');
const wsFrames = require('./wsFrames.cjs');

/**
 * @param {{ roomCode: string, token: string, onEvent: (ev: object) => void }} opts
 * @returns {{ port: () => number, stop: () => void, broadcast: (payload: object, except?: string) => number,
 *            sendTo: (name: string, payload: object) => boolean, clientNames: () => string[] }}
 */
function createLanServer(opts) {
  const { roomCode, token, onEvent } = opts || {};
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('floatlight-lan');
  });
  const clients = new Map(); // socket → { name }
  let seq = 0;
  let pingTimer = null;
  let port = 0;
  let resolveReady = null;
  const readyPromise = new Promise((r) => { resolveReady = r; });

  const safeEqual = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
  };

  const sendJson = (sock, obj) => {
    try {
      sock.write(wsFrames.encodeText(JSON.stringify(obj)));
    } catch { /* ignore */ }
  };

  server.on('upgrade', (req, socket) => {
    let q = null;
    try {
      q = new URL(req.url, 'http://localhost').searchParams;
    } catch { /* ignore */ }
    if (!q || q.get('room') !== roomCode || !safeEqual(q.get('token') || '', token)) {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        wsFrames.acceptKey(key) + '\r\n\r\n',
    );
    socket.setNoDelay(true);
    let buf = Buffer.alloc(0);
    const info = { name: '' };
    clients.set(socket, info);
    const id = ++seq;
    if (typeof onEvent === 'function') onEvent({ event: 'connect', id, name: '' });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = wsFrames.decodeFrames(buf);
      buf = rest;
      for (const f of frames) {
        if (f.opcode === 0x8) {
          try { socket.end(); } catch { /* ignore */ }
          break;
        }
        if (f.opcode === 0x9) {
          try { socket.write(wsFrames.encodePong()); } catch { /* ignore */ }
          continue;
        }
        if (f.opcode !== 0x1 && f.opcode !== 0x2) continue;
        let msg = null;
        try {
          msg = JSON.parse(f.payload.toString('utf8'));
        } catch { continue; }
        if (msg && msg.type === 'hello' && typeof msg.name === 'string') info.name = msg.name;
        if (typeof onEvent === 'function') onEvent({ event: 'message', id, name: info.name, payload: msg });
      }
    });
    socket.on('close', () => {
      clients.delete(socket);
      if (typeof onEvent === 'function') onEvent({ event: 'close', id, name: info.name });
    });
    socket.on('error', () => { /* ignore */ });
  });

  server.listen(0, '0.0.0.0', () => {
    port = server.address().port;
    if (resolveReady) resolveReady();
  });

  pingTimer = setInterval(() => {
    for (const sock of clients.keys()) {
      try { sock.write(wsFrames.encodePing()); } catch { /* ignore */ }
    }
  }, 30000);

  return {
    port: () => port,
    /** 等待端口绑定完成（listen 异步） */
    ready: () => readyPromise,
    stop() {
      try { clearInterval(pingTimer); } catch { /* ignore */ }
      for (const sock of clients.keys()) {
        try { sock.destroy(); } catch { /* ignore */ }
      }
      clients.clear();
      try { server.close(); } catch { /* ignore */ }
    },
    broadcast(payload, except) {
      let count = 0;
      for (const [sock, info] of clients) {
        if (except && info.name === except) continue;
        sendJson(sock, payload);
        count++;
      }
      return count;
    },
    sendTo(name, payload) {
      for (const [sock, info] of clients) {
        if (info.name === name) {
          sendJson(sock, payload);
          return true;
        }
      }
      return false;
    },
    clientNames() {
      return [...clients.values()].map((c) => c.name);
    },
  };
}

module.exports = { createLanServer };
