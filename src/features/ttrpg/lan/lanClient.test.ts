import { describe, it, expect } from 'vitest';
import { parseLanMessage, mergeTurns, validatePeerName, makeRoomCode, buildJoinedPayload } from './lanClient';
import type { SessionTurn } from '../types';

const turn = (id: string, ts: number, who: string): SessionTurn => ({ id, ts, kind: 'player', who, content: '行动' });

describe('parseLanMessage 消息解析', () => {
  it('合法 hello', () => {
    const m = parseLanMessage(JSON.stringify({ type: 'hello', name: '小林', version: '1' }));
    expect(m).toEqual({ type: 'hello', name: '小林', version: '1' });
  });

  it('非法 JSON 返回 null', () => {
    expect(parseLanMessage('not json {')).toBeNull();
    expect(parseLanMessage('')).toBeNull();
    expect(parseLanMessage('   ')).toBeNull();
  });

  it('未知 type 返回 null', () => {
    expect(parseLanMessage(JSON.stringify({ type: 'hack', x: 1 }))).toBeNull();
  });

  it('缺字段的 action 返回 null', () => {
    expect(parseLanMessage(JSON.stringify({ type: 'action', name: '小林' }))).toBeNull(); // 缺 text
    expect(parseLanMessage(JSON.stringify({ type: 'action', text: 'x' }))).toBeNull(); // 缺 name
  });

  it('joined 快照解析并过滤非字符串玩家', () => {
    const m = parseLanMessage(JSON.stringify({
      type: 'joined', ok: true, players: ['A', 42, 'B'], log: [{ id: 't1', ts: 1, kind: 'gm', who: 'GM', content: '开局' }], title: '测试团', rulebookName: 'DND5e',
    }));
    expect(m && m.type === 'joined' && m.players).toEqual(['A', 'B']);
    expect(m && m.type === 'joined' && m.log).toHaveLength(1);
    expect(m && m.type === 'joined' && m.title).toBe('测试团');
  });

  it('turns / state / error 解析', () => {
    expect(parseLanMessage(JSON.stringify({ type: 'turns', turns: [{ id: 'a' }] }))?.type).toBe('turns');
    expect(parseLanMessage(JSON.stringify({ type: 'state', name: 'A', patch: { hp: 10 } }))?.type).toBe('state');
    expect(parseLanMessage(JSON.stringify({ type: 'error', message: 'boom' }))?.type).toBe('error');
    expect(parseLanMessage(JSON.stringify({ type: 'turns', turns: 'x' }))).toBeNull();
  });
});

describe('mergeTurns 日志合并', () => {
  it('按 id 去重（重复广播不产生重复条目）', () => {
    const base = [turn('a', 1, 'A'), turn('b', 2, 'B')];
    const merged = mergeTurns(base, [turn('b', 2, 'B'), turn('c', 3, 'C')]);
    expect(merged.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('按 ts 升序排列', () => {
    const merged = mergeTurns([turn('a', 3, 'A')], [turn('b', 1, 'B'), turn('c', 2, 'C')]);
    expect(merged.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('容忍空日志与空入站', () => {
    expect(mergeTurns([], [])).toEqual([]);
    expect(mergeTurns([turn('a', 1, 'A')], [])).toHaveLength(1);
  });
});

describe('validatePeerName 玩家名校验', () => {
  it('空名 / 冲突 / 超长拒绝', () => {
    expect(validatePeerName('', [])).toBe('玩家名不能为空');
    expect(validatePeerName('   ', [])).toBe('玩家名不能为空');
    expect(validatePeerName('小林', ['小林'])).toContain('已被使用');
    expect(validatePeerName('这个玩家的名字实在是太长了有十七个字符', [])).toContain('过长');
  });

  it('合法名通过', () => {
    expect(validatePeerName('夜行', ['小林'])).toBeNull();
    expect(validatePeerName(' 夜行 ', [])).toBeNull(); // trim 后合法
  });
});

describe('makeRoomCode 房间码', () => {
  it('6 位且只含去混淆字符集', () => {
    for (let i = 0; i < 50; i++) {
      const c = makeRoomCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});

describe('buildJoinedPayload 加入快照', () => {
  it('组装完整 joined 消息', () => {
    const m = buildJoinedPayload({ players: ['A', 'B'], log: [turn('t', 1, 'A')], title: '团', rulebookName: 'COC7' });
    expect(m.type).toBe('joined');
    if (m.type === 'joined') {
      expect(m.players).toEqual(['A', 'B']);
      expect(m.rulebookName).toBe('COC7');
    }
  });
});
