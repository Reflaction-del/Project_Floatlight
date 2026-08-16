// ============================================================
// AI 能力守卫（P2-10 统一引导）
// ------------------------------------------------------------
// 依赖 AI 模型的功能入口统一调用：已配置模型 → 放行；
// 未配置 → alert 引导去「设置 → 大模型接入」，返回 false 阻止进入。
// ============================================================
import { useAIStore } from '../store/aiStore';

/** 守卫：有当前模型返回 true；无模型提示并返回 false */
export function ensureAIModel(action = '此功能'): boolean {
  const cfg = useAIStore.getState().getCurrent();
  if (cfg) return true;
  alert(`「${action}」需要先配置 AI 模型。\n请在 设置 → 大模型接入 (AI) → 添加模型 中配置端点、密钥与模型名。`);
  return false;
}
