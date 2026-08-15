// ============================================================
// 最小 WebSocket 帧编解码（Phase 4b LAN 跑团）
// ------------------------------------------------------------
// 单份实现（.cjs 同时供 electron-main.cjs require 与 vitest 测试）。
// 支持：文本帧 / 二进制帧 / ping / pong / close，无分片、无扩展。
// 服务端发送不 mask（RFC 6455 §5.1），客户端帧强制要求 mask 位。
// ============================================================
'use strict';

const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 握手应答：Sec-WebSocket-Accept 计算 */
function acceptKey(key) {
  return crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64');
}

function encodeText(text) {
  return encodeFrame(0x1, Buffer.from(String(text), 'utf8'));
}

function encodePing() {
  return encodeFrame(0x9, Buffer.alloc(0));
}

function encodePong() {
  return encodeFrame(0xa, Buffer.alloc(0));
}

/** 编码帧（服务端→客户端：不 mask） */
function encodeFrame(opcode, payload) {
  const len = payload.length;
  const header = Buffer.alloc(10);
  let offset = 0;
  header[offset++] = 0x80 | (opcode & 0x0f); // fin=1
  if (len < 126) {
    header[offset++] = len;
  } else if (len < 65536) {
    header[offset++] = 126;
    header.writeUInt16BE(len, offset);
    offset += 2;
  } else {
    header[offset++] = 127;
    header.writeBigUInt64BE(BigInt(len), offset);
    offset += 8;
  }
  return Buffer.concat([header.subarray(0, offset), payload]);
}

/**
 * 解码累积缓冲中的帧（支持粘包/半包）。
 * 返回 { frames: [{ fin, opcode, payload: Buffer }], rest: Buffer }
 * frames 为空表示数据不足以构成完整帧（半包等待续传）。
 */
function decodeFrames(buf) {
  const frames = [];
  let offset = 0;
  const len = buf.length;
  while (len - offset >= 2) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let headerLen = 2;
    if (payloadLen === 126) {
      if (len - offset < 4) break;
      payloadLen = buf.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (len - offset < 10) break;
      payloadLen = Number(buf.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }
    let maskKey = null;
    if (masked) {
      if (len - offset < headerLen + 4) break;
      maskKey = buf.subarray(offset + headerLen, offset + headerLen + 4);
      headerLen += 4;
    }
    const total = headerLen + payloadLen;
    if (len - offset < total) break; // 半包
    let payload = buf.subarray(offset + headerLen, offset + headerLen + payloadLen);
    if (masked) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
    } else {
      payload = Buffer.from(payload); // 复制出独立 Buffer，避免引用大缓冲
    }
    frames.push({ fin, opcode, payload });
    offset += total;
  }
  return { frames, rest: buf.subarray(offset) };
}

module.exports = { acceptKey, encodeText, encodePing, encodePong, encodeFrame, decodeFrames };
