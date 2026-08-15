// ============================================================
// store/proposalTypes.ts 单元测试
// 守护提案来源标签映射完整性：新增 ProposalSource 必须补标签，
// 否则提案中心分组会显示 undefined。
// ============================================================

import { describe, it, expect } from 'vitest';
import { PROPOSAL_SOURCE_LABEL } from './proposalTypes';

describe('PROPOSAL_SOURCE_LABEL', () => {
  it('全部提案来源均有非空可读标签', () => {
    for (const [source, label] of Object.entries(PROPOSAL_SOURCE_LABEL)) {
      expect(label.trim().length, `source=${source} 缺少标签`).toBeGreaterThan(0);
    }
  });

  it('关键来源标签文案正确', () => {
    expect(PROPOSAL_SOURCE_LABEL.agent).toBe('主动提议');
    expect(PROPOSAL_SOURCE_LABEL.article).toBe('文章抽取');
    expect(PROPOSAL_SOURCE_LABEL.chat).toBe('对话');
  });
});
