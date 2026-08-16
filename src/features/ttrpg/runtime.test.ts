// ============================================================
// features/ttrpg/runtime.ts 单元测试（mock chatFn）
// 守护：/roll 指令、/check 检定（技能匹配/难度/属性值）、
// GM 提示词组装、自由行动 GM 回应。
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { runGMAction, parseCheckCommand, matchSkill, buildGMPrompt, playerStat } from './runtime';
import { BUILTIN_RULEBOOKS } from './rules';
import type { TTRPGSession } from './types';
import type { WorldData } from '../../store/worldStore';

const rulebook = BUILTIN_RULEBOOKS[0]; // dnd5e: formula 1d20+{attr}+{skill}, normal=15
const world = () => ({ entities: [], relations: [], outline: [],
    outlineTrash: [], timelines: [], docs: [], folders: [], styles: [], materials: [], templates: [], drafts: [], activeDocId: '', activeTimelineId: '', clueBoard: {}, proposals: [], chats: [], simulations: [], bridgeLog: [], rulebooks: [], ttrpgSessions: [] }) as WorldData;

const session = (over: Partial<TTRPGSession> = {}): TTRPGSession => ({
  id: 'tt-1', mode: 'ai-gm', title: '测试跑团', rulebookId: rulebook.id, gmName: 'GM',
  players: [{ name: '林夜', state: { hp: 10 } }], log: [], state: {
    林夜: { attrs: { 力量: 3, 敏捷: 2 }, skills: { 运动: 2, 隐匿: 1 } },
  }, createdAt: 1, updatedAt: 1, ...over,
});

const mockChat = (reply: string) => vi.fn(async (_m: any, _msgs: any[]) => reply);
const noModel = (): any => ({ id: 'm1', label: '测试', endpoint: 'http://x', apiKey: 'k', model: 'gpt-x', format: 'chat' });

describe('parseCheckCommand', () => {
  it('解析技能与可选难度/dc', () => {
    expect(parseCheckCommand('/check 运动')).toEqual({ skill: '运动' });
    expect(parseCheckCommand('/check 运动 困难')).toEqual({ skill: '运动', difficultyKey: '困难' });
    expect(parseCheckCommand('/check 隐匿 18')).toEqual({ skill: '隐匿', dc: 18 });
    expect(parseCheckCommand('正常行动')).toBeNull();
  });
});

describe('matchSkill', () => {
  it('精确/包含匹配', () => {
    expect(matchSkill(rulebook, '运动')?.name).toBe('运动');
    expect(matchSkill(rulebook, '运')).toBeTruthy();
    expect(matchSkill(rulebook, '不存在的技能')).toBeNull();
  });
});

describe('playerStat', () => {
  it('从会话状态取属性/技能，缺省 0', () => {
    expect(playerStat(session(), '林夜', 'attrs', '力量')).toBe(3);
    expect(playerStat(session(), '林夜', 'skills', '运动')).toBe(2);
    expect(playerStat(session(), '无名', 'attrs', '力量')).toBe(0);
  });
});

describe('buildGMPrompt', () => {
  it('含规则说明/世界快照/最近日志/玩家行动', () => {
    const p = buildGMPrompt({
      rulebook, worldSnapshot: '【实体】林夜：剑客', recentLog: session().log,
      playerName: '林夜', action: '我要调查', gmName: 'GM',
    });
    expect(p.system).toContain('DND5e 简化');
    expect(p.system).toContain('检定公式');
    expect(p.system).toContain('林夜：剑客');
    expect(p.user).toContain('我要调查');
  });
});

describe('runGMAction', () => {
  it('/roll 指令：掷骰回合 + GM 回应', async () => {
    const s = session();
    const chatFn = mockChat('骰子落下，滚到 12。');
    const r = await runGMAction(
      { session: s, rulebook, world: world(), action: '/roll 1d20+3', playerName: '林夜' },
      { chatFn, getModel: () => noModel() },
    );
    const roll = r.roll;
    expect(roll).toBeTruthy();
    expect(roll!.content).toContain('掷骰');
    expect(roll!.detail).toContain('1d20+3');
    expect(r.gm).toBeTruthy();
    expect(r.gm!.content).toContain('骰子落下');
  });

  it('/check 技能 难度：按公式与属性值判定', async () => {
    const s = session();
    const r = await runGMAction(
      { session: s, rulebook, world: world(), action: '/check 运动 困难', playerName: '林夜' },
      { chatFn: mockChat('ok'), getModel: () => noModel() },
    );
    const roll = r.roll!;
    expect(roll.content).toBe('检定 运动');
    // 力量 3 + 运动 2 + 1d20 随机 → detail 含难度 20（困难）与成功/失败
    expect(roll.detail).toContain('难度 20');
    expect(roll.detail).toMatch(/成功|失败/);
    expect(roll.detail).toContain('运动'); // 技能名出现在判定中
  });

  it('未知技能返回系统提示', async () => {
    const r = await runGMAction(
      { session: session(), rulebook, world: world(), action: '/check 龙语', playerName: '林夜' },
      { chatFn: mockChat('x'), getModel: () => noModel() },
    );
    expect(r.roll!.kind).toBe('system');
    expect(r.roll!.content).toContain('未知技能');
  });

  it('自由行动：玩家回合 + GM 回应', async () => {
    const r = await runGMAction(
      { session: session(), rulebook, world: world(), action: '我拔出剑，警惕地环顾四周', playerName: '林夜' },
      { chatFn: mockChat('浓雾中传来脚步声……'), getModel: () => noModel() },
    );
    expect(r.session.log.length).toBe(2); // player + gm
    expect(r.session.log[0].kind).toBe('player');
    expect(r.session.log[1].kind).toBe('gm');
  });

  it('无模型时自由行动仅记玩家回合（不崩溃）', async () => {
    const r = await runGMAction(
      { session: session(), rulebook, world: world(), action: '环顾四周', playerName: '林夜' },
      { chatFn: mockChat('x'), getModel: () => null },
    );
    expect(r.session.log).toHaveLength(1);
  });
});
