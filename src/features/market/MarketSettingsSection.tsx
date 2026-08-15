// ============================================================
// 插件市场设置区（Phase 5 插件市场雏形）
// ------------------------------------------------------------
// 纯本地市场：世界模板（.fuguworld）导入/导出。
// 规则书（.fugurule）/ 视觉模板与风格（.fugu*）在各自主面板管理，
// 本面板提供统一说明与入口提示。
// ============================================================
import { useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { storage } from '../../storage';
import { serializeWorldTemplate, deserializeWorldTemplate, summarizeTemplate, worldTemplateFilename } from './worldTemplate';
import type { WorldTemplateFile } from './worldTemplate';

export function MarketSettingsSection() {
  const world = useWorldStore((s) => s.worldsData[s.current]);
  const worldName = useWorldStore((s) => s.current);
  const addWorldFromTemplate = useWorldStore((s) => s.addWorldFromTemplate);
  const [importMsg, setImportMsg] = useState('');
  const [preview, setPreview] = useState<WorldTemplateFile | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const onExport = () => {
    if (!world) return;
    const content = serializeWorldTemplate(world, { name: worldName, description: `由「${worldName}」导出` });
    if (storage.isNative()) {
      storage.exportFile(worldTemplateFilename(worldName), content);
    } else {
      const blob = new Blob([content], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = worldTemplateFilename(worldName);
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  const onPick = async () => {
    const res = await (storage as any).pickImport?.();
    if (!res) return;
    const { template, error } = deserializeWorldTemplate(res.content);
    if (error || !template) {
      setImportMsg(`导入失败：${error}`);
      setPreview(null);
      setPending(null);
      return;
    }
    setPreview(template);
    setPending(res.name);
    setImportMsg('');
  };

  const doImport = () => {
    if (!preview) return;
    const key = addWorldFromTemplate(preview, preview.name || undefined);
    setImportMsg(key ? `已创建新世界「${key}」并切换到它（共 ${Object.keys(preview.world).length} 类内容）。` : '导入失败');
    setPreview(null);
    setPending(null);
  };

  return (
    <section className="set-section">
      <h3>插件市场（本地 · 零在线依赖）</h3>
      <p className="tip" style={{ margin: '4px 0 8px' }}>
        规则书（.fugurule）在「跑团 → 规则书」管理；视觉模板与风格（.fugu*）在「视觉物料生成器 → 模板/风格市场」管理。
        本面板提供<b>世界模板</b>（.fuguworld）：把整个世界观（实体/关系/时间线/大纲/文档/规则书）打包分享或复用。
      </p>
      <div className="set-bridge-row">
        <button className="mode-btn" onClick={onExport} disabled={!world}>导出当前世界（.fuguworld）</button>
        <button className="mode-btn active" onClick={onPick}>导入世界模板…</button>
        {pending && preview && (
          <>
            <span className="set-bridge-token">{pending} · {summarizeTemplate(preview)}</span>
            <button className="mode-btn active" onClick={doImport}>创建新世界</button>
            <button className="mode-btn" onClick={() => { setPreview(null); setPending(null); }}>取消</button>
          </>
        )}
      </div>
      {importMsg && <div className="set-bridge-result">{importMsg}</div>}
      <p className="tip" style={{ marginTop: 6, fontSize: 11 }}>
        安全说明：模板文件仅在本机解析与导入，不包含任何网络请求；导入前请确认文件来源可信。
      </p>
    </section>
  );
}
