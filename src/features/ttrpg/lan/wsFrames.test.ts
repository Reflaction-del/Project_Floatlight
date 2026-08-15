import { describe, it, expect } from 'vitest';
// @ts-expect-error CJS 模块无类型声明
import { acceptKey, encodeText, encodePing, encodePong, decodeFrames } from './wsFrames.cjs';

const decodeAll = (buf: Buffer) => {
  const { frames, rest } = decodeFrames(buf);
  return { frames, rest };
};

describe('wsFrames 帧编解码', () => {
  it('encodeText 短文本（len<126）', () => {
    const f = encodeText('hi');
    expect(f[0]).toBe(0x81); // fin + text
    expect(f[1]).toBe(2); // len=2 不 mask
    expect(f.subarray(2).toString()).toBe('hi');
  });

  it('encodeText 中等长度（len=126 分支）', () => {
    const body = 'x'.repeat(200);
    const f = encodeText(body);
    expect(f[1]).toBe(126);
    expect(f.readUInt16BE(2)).toBe(200);
    expect(f.subarray(4).toString()).toBe(body);
  });

  it('decodeFrames 解析客户端 masked 文本帧', () => {
    // 手造 masked 帧：fin|text(0x81) + mask|len(0x82) + mask key + payload^key
    const payload = Buffer.from('hello');
    const key = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.from(payload.map((b, i) => b ^ key[i % 4]));
    const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), key, masked]);
    const { frames } = decodeAll(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(0x1);
    expect(frames[0].payload.toString()).toBe('hello');
  });

  it('decodeFrames 粘包：多帧一次解出', () => {
    const a = encodeText('a');
    const b = encodeText('b');
    const c = encodeText('c');
    const { frames, rest } = decodeAll(Buffer.concat([a, b, c]));
    expect(frames.map((f: any) => f.payload.toString())).toEqual(['a', 'b', 'c']);
    expect(rest.length).toBe(0);
  });

  it('decodeFrames 半包：不完整帧返回空并保留 rest', () => {
    const full = encodeText('hello world');
    const half = full.subarray(0, full.length - 3);
    const { frames, rest } = decodeAll(half);
    expect(frames).toHaveLength(0); // 半包不产出帧
    expect(rest.length).toBe(half.length); // 全部保留等续传
    // 续传后能完整解出
    const tail = full.subarray(full.length - 3);
    const { frames: f2 } = decodeAll(Buffer.concat([rest, tail]));
    expect(f2.map((x: any) => x.payload.toString())).toEqual(['hello world']);
  });

  it('decodeFrames 一帧半包+一完整帧（粘包与半包混合）', () => {
    const first = encodeText('first');
    const second = encodeText('second');
    const mixed = Buffer.concat([first, second.subarray(0, 4)]);
    const { frames, rest } = decodeAll(mixed);
    expect(frames.map((f: any) => f.payload.toString())).toEqual(['first']);
    expect(rest.length).toBe(4);
    const { frames: f2 } = decodeAll(Buffer.concat([rest, second.subarray(4)]));
    expect(f2.map((f: any) => f.payload.toString())).toEqual(['second']);
  });

  it('ping/pong 帧', () => {
    const ping = encodePing();
    expect(ping[0]).toBe(0x89);
    expect(ping[1]).toBe(0);
    const pong = encodePong();
    expect(pong[0]).toBe(0x8a);
    const { frames } = decodeAll(ping);
    expect(frames[0].opcode).toBe(0x9);
  });

  it('close 帧 opcode 识别', () => {
    const close = Buffer.from([0x88, 0x02, 0x03, 0xe8]); // close + 1000
    const { frames } = decodeAll(close);
    expect(frames[0].opcode).toBe(0x8);
  });

  it('acceptKey 握手应答（RFC 6455 官方示例）', () => {
    // RFC 6455 §1.3 示例：dGhlIHNhbXBsZSBub25jZQ== → s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});
