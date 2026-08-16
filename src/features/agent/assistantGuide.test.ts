import { describe, it, expect } from 'vitest';
import { ASSISTANT_GUIDE, ASSISTANT_SKILLS, matchSkills, buildAssistantSystem } from './assistantGuide';

describe('assistantGuide 操作手册', () => {
  it('基础手册包含组件地图与工具清单', () => {
    expect(ASSISTANT_GUIDE).toContain('实体库');
    expect(ASSISTANT_GUIDE).toContain('可视化编辑器');
    expect(ASSISTANT_GUIDE).toContain('material.configure');
    expect(ASSISTANT_GUIDE).toContain('行为准则');
  });

  it('技能卡按关键词匹配', () => {
    expect(matchSkills('帮我生成一张海报').map((s) => s.id)).toContain('material-sop');
    expect(matchSkills('扫描一下一致性').map((s) => s.id)).toContain('world-health');
    expect(matchSkills('我要新建一个世界').map((s) => s.id)).toContain('world-setup');
    expect(matchSkills('跑团开局').map((s) => s.id)).toContain('trpg-gm');
    // 无关请求不触发任何技能
    expect(matchSkills('你好')).toHaveLength(0);
  });

  it('buildAssistantSystem 按需注入技能段落', () => {
    const base = buildAssistantSystem();
    expect(base).toBe(ASSISTANT_GUIDE);
    const withSop = buildAssistantSystem('帮我做一张角色卡海报');
    expect(withSop).toContain('【技能：物料制作】');
    expect(withSop).toContain('material.listTemplates');
    const withHealth = buildAssistantSystem('检查一下设定冲突');
    expect(withHealth).toContain('【技能：世界一致性】');
  });

  it('技能卡结构完整（id/name/when/instructions）', () => {
    for (const sk of ASSISTANT_SKILLS) {
      expect(sk.id).toBeTruthy();
      expect(sk.name).toBeTruthy();
      expect(sk.when.length).toBeGreaterThan(0);
      expect(sk.instructions.length).toBeGreaterThan(20);
    }
  });
});
