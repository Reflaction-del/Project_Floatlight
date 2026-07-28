import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { marked } from 'marked';
import { useAIStore } from '../store/aiStore';
import { useWorldStore } from '../store/worldStore';
import { useUIStore } from '../store/uiStore';
import { useAIUsageStore, approximateTokens } from '../store/aiUsageStore';
import {
  chatStream,
  getCurrentModel,
  contentText,
  type AIMessage,
  type ChatContentPart,
  listModels,
  splitThinking,
} from '../utils/ai';
import {
  retrieveRelevant,
  retrieveRelevantSemantic,
  buildConstraintPrompt,
  composeSystem,
  extractCited,
  entityBrief,
  assembleContextWithBudget,
  type Retrieved,
  type AITask,
} from '../utils/worldContext';
import type { WikiEntity, WikiRelation } from '../types';
import type { WorldData } from '../store/worldStore';

marked.setOptions({
  gfm: true,
  breaks: false,
  pedantic: false,
});

function escapeHtml(src: string): string {
  return src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mdToHtml(src: string): string {
  try {
    return marked.parse(src, { async: false }) as string;
  } catch {
    return escapeHtml(src);
  }
}

/** TipTap JSON 节点 → 纯文本（保留段落/标题换行） */
function tiptapToText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) {
    return node.content
      .map(tiptapToText)
      .join(node.type === 'paragraph' || node.type === 'heading' ? '\n' : '');
  }
  return '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 把 DocFile.content（TipTap JSON 或 HTML 字符串）转为纯文本，供注入 AI 上下文 */
function docPlainText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') {
    const s = content.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        return tiptapToText(JSON.parse(s));
      } catch {
        return stripHtml(s);
      }
    }
    return stripHtml(s);
  }
  return tiptapToText(content);
}

/** 前端压缩图片为 dataURL（限制最长边与质量，避免请求体过大） */
function compressImage(dataUrl: string, maxSide = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        const r = Math.min(maxSide / width, maxSide / height);
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** 把用户手动固定的引用（文章/实体）拼成 AI 上下文文本 */
function buildPinnedBlock(
  world: Pick<WorldData, 'entities' | 'relations' | 'docs'>,
  pinned: { kind: 'doc' | 'entity'; id: string }[],
): string {
  const entities = world.entities ?? [];
  const relations = world.relations ?? [];
  const docs = (world.docs ?? []) as { id: string; title: string; content: unknown }[];
  const byId = new Map<string, WikiEntity>(entities.map((e) => [e.id, e]));
  const lines: string[] = [];
  for (const ref of pinned) {
    if (ref.kind === 'entity') {
      const e = entities.find((x) => x.id === ref.id);
      if (e) lines.push(entityBrief(e, relations.filter((r) => r.source === e.id || r.target === e.id), byId));
    } else {
      const d = docs.find((x) => x.id === ref.id);
      if (d) {
        const text = docPlainText(d.content).slice(0, 6000);
        lines.push(`【文章】${d.title}\n${text}`);
      }
    }
  }
  return lines.join('\n\n');
}

/** 单条消息（memo 化）：流式更新时仅最后一条消息重渲染，历史消息跳过，
 * 配合 chatStream 的 rAF 节流，彻底消除每 token 全列表重渲染造成的卡顿。
 * 流式过程中最后一条消息使用纯文本，避免每 token 都对整段长文本做 Markdown 解析。 */
interface CoMessageProps {
  msg: AIMessage;
  index: number;
  isLast: boolean;
  loading: boolean;
  label: string;
  expanded: boolean;
  supportsThinking: boolean;
  onToggleThinking: (i: number) => void;
}
const CoMessage = memo(function CoMessage({ msg, index, isLast, loading, label, expanded, supportsThinking, onToggleThinking }: CoMessageProps) {
  const isAssistant = msg.role === 'assistant';
  // 文本部分用于思维链解析与 Markdown 渲染；图片部分单独渲染
  const text = contentText(msg.content);
  const { thinking, rest } = isAssistant ? splitThinking(text) : { thinking: '', rest: text };
  const imageParts: ChatContentPart[] =
    typeof msg.content === 'string' ? [] : msg.content.filter((p) => p.type === 'image_url');
  const hasThinking = supportsThinking && thinking.length > 0;
  const isStreaming = loading && isLast;

  // 历史消息 / 已完成消息：一次性解析 Markdown；流式中：仅做 HTML 转义，大幅降低 CPU 占用
  const restHtml = useMemo(() => (rest ? (isStreaming ? escapeHtml(rest).replace(/\n/g, '<br>') : mdToHtml(rest)) : ''), [rest, isStreaming]);
  const thinkingHtml = useMemo(() => (thinking ? (isStreaming ? escapeHtml(thinking).replace(/\n/g, '<br>') : mdToHtml(thinking)) : ''), [thinking, isStreaming]);

  return (
    <div className={'co-msg co-' + msg.role}>
      <div className="co-role">
        {msg.role === 'user' ? '你' : label}
        {hasThinking && (
          <button className="co-think-toggle" onClick={() => onToggleThinking(index)} title={expanded ? '隐藏思考过程' : '显示思考过程'}>
            {expanded ? '隐藏思考' : '显示思考'}
          </button>
        )}
      </div>
      {imageParts.length > 0 && (
        <div className="co-images">
          {imageParts.map((p, i) =>
            p.type === 'image_url' ? (
              <img key={i} className="co-img" src={p.image_url.url} alt="用户上传图片" />
            ) : null,
          )}
        </div>
      )}
      {hasThinking && expanded && (
        <div className="co-thinking">
          <div className="co-thinking-label">思考过程</div>
          <div className="co-thinking-content" dangerouslySetInnerHTML={{ __html: thinkingHtml }} />
        </div>
      )}
      <div
        className="co-content"
        dangerouslySetInnerHTML={{
          __html: restHtml || (isStreaming ? '等待响应…' : ''),
        }}
      />
    </div>
  );
});

export function CopilotSidebar() {
  const models = useAIStore((s) => s.models);
  const currentId = useAIStore((s) => s.currentId);
  const setCurrent = useAIStore((s) => s.setCurrent);
  const currentModel = models.find((m) => m.id === currentId) ?? null;

  const world = useWorldStore((s) => s.worldsData[s.current]);
  const entities = world?.entities ?? [];
  const relations = world?.relations ?? [];
  const docs = (world?.docs ?? []) as { id: string; title: string; icon: string; content: unknown }[];
  const openTab = useUIStore((s) => s.openTab);
  const current = useWorldStore((s) => s.current);

  const DEFAULT_MSGS: AIMessage[] = [
    { role: 'system', content: '你是一个专业的写作和世界观构建助手，帮助用户构建虚构世界、完善设定、润色文字。回答简洁、有洞察力。' },
    { role: 'assistant', content: '你好，我是浮光 AI 助手。我可以协助你写作、构建世界观、润色文稿；开启「约束模式」后，我会自动遵循你已建立的设定。' },
  ];
  const [msgs, setMsgs] = useState<AIMessage[]>(() => {
    const chat = useWorldStore.getState().getChat(useWorldStore.getState().current, 'copilot-main');
    return chat ? chat.messages : DEFAULT_MSGS;
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const [constraintMode, setConstraintMode] = useState(true);
  const [task, setTask] = useState<AITask>('');
  const [ignored, setIgnored] = useState<string[]>([]);
  const [usedRefs, setUsedRefs] = useState<Retrieved[]>([]);
  const [cited, setCited] = useState<string[]>([]);
  const [showThinking, setShowThinking] = useState<Set<number>>(new Set());

  // —— 引用上下文（手动指定文章/实体作为固定背景）——
  const [pinned, setPinned] = useState<{ kind: 'doc' | 'entity'; id: string }[]>([]);
  // —— 待发送图片（dataURL）——
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickBottomRef = useRef(true); // 是否自动跟随到底部
  const lastContentRef = useRef('');

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = msgs[msgs.length - 1];
    const lastContent = last?.role === 'assistant' ? contentText(last.content) : '';
    // 只有最后一条 assistant 消息内容真正变化时才尝试滚动；避免输入/previewRefs 等无关更新触发 reflow
    if (lastContent === lastContentRef.current) return;
    lastContentRef.current = lastContent;
    // 仅在用户停留在底部时自动跟随，避免打断向上查看历史；放进 rAF 避免与渲染同帧强制 reflow
    if (stickBottomRef.current) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [msgs]);

  const onBodyScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const msgsRef = useRef<AIMessage[]>(msgs);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  // 持久化当前对话到世界数据（Phase 0：对话记录落盘）
  const persistChat = () => {
    const key = useWorldStore.getState().current;
    const existing = useWorldStore.getState().getChat(key, 'copilot-main');
    useWorldStore.getState().upsertChat(key, {
      id: 'copilot-main',
      title: '浮光 AI 助手',
      modelId: useAIStore.getState().currentId ?? undefined,
      messages: msgsRef.current.map((m) => ({ role: m.role, content: m.content })),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  };

  // 切换世界时：先保存旧世界对话，再载入新世界对话（Phase 0）
  const prevCurrent = useRef(current);
  useEffect(() => {
    const prev = prevCurrent.current;
    if (prev && prev !== current) {
      const existing = useWorldStore.getState().getChat(prev, 'copilot-main');
      useWorldStore.getState().upsertChat(prev, {
        id: 'copilot-main',
        title: '浮光 AI 助手',
        modelId: useAIStore.getState().currentId ?? undefined,
        messages: msgsRef.current.map((m) => ({ role: m.role, content: m.content })),
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    }
    prevCurrent.current = current;
    const chat = useWorldStore.getState().getChat(current, 'copilot-main');
    setMsgs(chat ? chat.messages : DEFAULT_MSGS);
    // 切换世界时清空手动引用上下文与待发送图片（引用对象属于旧世界）
    setPinned([]);
    setPendingImages([]);
  }, [current]);

  useEffect(() => {
    if (!currentModel) { setModelList([]); return; }
    setFetchingModels(true);
    listModels(currentModel).then((list) => {
      setModelList(list);
      setFetchingModels(false);
    }).catch(() => { setFetchingModels(false); });
  }, [currentModel?.id, currentModel?.endpoint, currentModel?.apiKey]);

  // 响应编辑器右键菜单：将选中内容加入上下文 / 聚焦输入框
  useEffect(() => {
    const onContext = (e: Event) => {
      const text = (e as CustomEvent).detail as string;
      if (text) setInput((prev) => (prev ? prev + '\n\n' : '') + text);
      inputRef.current?.focus();
    };
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener('fg-copilot-context', onContext);
    window.addEventListener('fg-copilot-focus', onFocus);
    return () => {
      window.removeEventListener('fg-copilot-context', onContext);
      window.removeEventListener('fg-copilot-focus', onFocus);
    };
  }, []);

  // 发送前预览：根据当前输入检索相关设定（排除已忽略）
  const ignoreSet = useMemo(() => new Set(ignored), [ignored]);
  const previewRefs = useMemo<Retrieved[]>(() => {
    if (!constraintMode || !world || entities.length === 0) return [];
    if (input.trim().length < 2) return [];
    return retrieveRelevant(world, input, 6, ignoreSet);
  }, [constraintMode, world, entities.length, input, ignoreSet]);

  const jumpToEntity = (id: string) => {
    const e = entities.find((x) => x.id === id);
    if (e) openTab({ title: e.name, icon: e.type, kind: 'entity', ref: id });
  };

  const toggleIgnore = (id: string) => {
    setIgnored((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // —— 引用上下文：手动指定文章/实体为固定背景 ——
  const isPinned = (kind: 'doc' | 'entity', id: string) =>
    pinned.some((p) => p.kind === kind && p.id === id);

  const togglePin = (kind: 'doc' | 'entity', id: string) => {
    setPinned((prev) =>
      prev.some((p) => p.kind === kind && p.id === id)
        ? prev.filter((p) => !(p.kind === kind && p.id === id))
        : [...prev, { kind, id }],
    );
  };

  // —— 图片：选择并前端压缩为 dataURL ——
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const dataUrl = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => res('');
        r.readAsDataURL(f);
      });
      if (!dataUrl) continue;
      const compressed = await compressImage(dataUrl);
      setPendingImages((prev) => [...prev, compressed]);
    }
  };

  const removeImage = (idx: number) => setPendingImages((prev) => prev.filter((_, i) => i !== idx));

  const send = async () => {
    const q = input.trim();
    if ((!q && pendingImages.length === 0) || loading || !currentModel) return;
    setInput('');
    setCited([]);
    // 约束模式 + 已配置嵌入模型时，发送前用「语义检索」召回最相关设定（近义/改写提及也能命中）；
    // 否则沿用词法预览结果。两者都受下方 token 预算护栏控制，不会撑爆上下文。
    let refs = previewRefs.filter((r) => !ignoreSet.has(r.entity.id));
    if (constraintMode && q.length >= 2 && useAIStore.getState().embeddingModel) {
      try {
        const sem = await retrieveRelevantSemantic(
          world ?? { entities: [], relations: [], docs: [] },
          q,
          6,
          ignoreSet,
        );
        if (sem.length > 0) refs = sem;
      } catch {
        /* 语义检索异常时回退词法预览结果 */
      }
    }
    setUsedRefs(refs);

    // 多模态 user 消息：文字 + 图片
    const format: string = (currentModel.format ?? 'chat') as string;
    let imageParts: ChatContentPart[] = [];
    if (pendingImages.length > 0) {
      if (format !== 'chat') {
        alert('当前模型使用「' + format + '」格式，不支持发送图片。本次将仅发送文字，图片已忽略。');
      } else {
        imageParts = pendingImages.map((url) => ({ type: 'image_url', image_url: { url } }));
      }
    }
    const contentParts: ChatContentPart[] = [];
    if (q) contentParts.push({ type: 'text', text: q });
    contentParts.push(...imageParts);
    const userContent: string | ChatContentPart[] = imageParts.length > 0 ? contentParts : q;

    const apiMsgs: AIMessage[] = [...msgs, { role: 'user', content: userContent }];

    // 固定参考上下文（手动引用）拼入 system
    // 用共享 RAG 层的 token 预算护栏组装：用户固定大量实体/文档时按优先级裁剪，绝不撑爆上下文
    const ctxBlocks: { text: string; priority: number; label: string }[] = [];
    if (constraintMode) {
      ctxBlocks.push({
        text: buildConstraintPrompt(world ?? { entities: [], relations: [], docs: [] }, refs, task),
        priority: 10,
        label: '约束设定',
      });
    }
    if (pinned.length > 0) {
      ctxBlocks.push({
        text: '【固定参考上下文（本次对话应始终参考的文档与设定）】\n' + buildPinnedBlock(world ?? { entities: [], relations: [], docs: [] }, pinned),
        priority: 5,
        label: '固定参考',
      });
    }
    const assembled = assembleContextWithBudget(ctxBlocks, 4000);
    const constraintBlock = assembled.text;
    const systemOverride = constraintBlock ? composeSystem(currentModel.systemPrompt, constraintBlock) : undefined;

    // 注入约束时去掉默认人格 system，避免重复 system 消息
    const modelMsgs = systemOverride ? apiMsgs.filter((m) => m.role !== 'system') : apiMsgs;

    setMsgs([...apiMsgs, { role: 'assistant', content: '' }]);
    setPendingImages([]);
    setLoading(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    let full = '';
    await chatStream(
      currentModel,
      modelMsgs,
      (t) => {
        full += t;
        setMsgs((prev) => {
          const last = prev[prev.length - 1];
          const nextMsgs = last.role === 'assistant'
            ? [...prev.slice(0, -1), { ...last, content: last.content + t }]
            : [...prev, { role: 'assistant' as const, content: t }];
          msgsRef.current = nextMsgs;
          return nextMsgs;
        });
      },
      () => {
        setLoading(false);
        abortRef.current = null;
        const ids = new Set<string>([...refs.map((r) => r.entity.id), ...extractCited(full, entities)]);
        setCited([...ids]);
        if (currentModel?.requiresMetering) {
          const inputText = modelMsgs.map((m) => contentText(m.content)).join('\n');
          useAIUsageStore.getState().recordStreamingChat(currentModel, inputText, full);
        }
        persistChat();
      },
      (err) => {
        setLoading(false);
        abortRef.current = null;
        // 用户手动终止时不弹错误提示
        if (err === '手动终止' || (typeof err === 'string' && err.includes('aborted'))) return;
        setMsgs((p) => {
          const n = [...p, { role: 'assistant' as const, content: `（${err}）` }] as AIMessage[];
          msgsRef.current = n;
          return n;
        });
        persistChat();
      },
      { systemOverride, temperature: task === 'idea' ? 1.05 : task === 'lore' ? 0.3 : 0.8, signal: abortRef.current.signal },
    );
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const toggleThinking = (msgIndex: number) => {
    setShowThinking((prev) => {
      const next = new Set(prev);
      if (next.has(msgIndex)) next.delete(msgIndex); else next.add(msgIndex);
      return next;
    });
  };

  const clear = () => {
    const cleared: AIMessage[] = [DEFAULT_MSGS[0], { role: 'assistant', content: '会话已清空。有什么新问题？' }];
    setMsgs(cleared);
    msgsRef.current = cleared;
    setCited([]);
    setUsedRefs([]);
    persistChat();
  };

  const taskBtn = (key: AITask, label: string) => (
    <button
      className={'co-task' + (task === key ? ' active' : '')}
      onClick={() => setTask(task === key ? '' : key)}
      title={key === 'prose' ? '生成连贯叙事正文' : key === 'idea' ? '发散灵感点子' : key === 'lore' ? '考据与逻辑校验' : '自由对话'}
    >
      {label}
    </button>
  );

  if (!currentModel) {
    return (
      <div className="copilot">
        <div className="copilot-head">浮光 AI</div>
        <div className="copilot-body" style={{ padding: 16 }}>
          <div className="tip">尚未配置 AI 模型。</div>
          <div className="tip" style={{ marginTop: 8 }}>请打开 设置 → 大模型接入 (AI) → 添加模型 配置端点、密钥和模型名。配置后会自动显示在这里。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="copilot">
      <div className="copilot-head">
        <select className="copilot-model" value={currentId} onChange={(e) => setCurrent(e.target.value)}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}（{m.model}）</option>)}
        </select>
        <button className="mode-btn" style={{ fontSize: 11, padding: '2px 6px' }} onClick={clear}>清空</button>
      </div>

      <div className="copilot-status">
        端点 <code>{currentModel.endpoint}</code> · 模型 <code>{currentModel.model}</code>
        {fetchingModels && <span> · 拉取模型列表…</span>}
        {!fetchingModels && modelList.length > 0 && !modelList.includes(currentModel.model) && (
          <span style={{ color: 'var(--danger)' }}> · 当前模型名不在该端点返回的列表中（{modelList.slice(0, 3).join(', ')}…）</span>
        )}
      </div>

      <div className="co-controls">
        <button
          className={'co-task' + (constraintMode ? ' active' : '')}
          onClick={() => setConstraintMode((v) => !v)}
          title="开启后，AI 会参考你已建立的设定并不与之矛盾"
        >
          约束模式
        </button>
        {taskBtn('prose', '续写')}
        {taskBtn('idea', '灵感')}
        {taskBtn('lore', '考据')}
      </div>

      {constraintMode && entities.length > 0 && (
        <div className="co-constraint-row">
          {input.trim().length < 2 ? (
            <span className="tip" style={{ fontSize: 12 }}>输入问题后将自动检索相关设定并作为约束注入。</span>
          ) : previewRefs.length === 0 ? (
            <span className="tip" style={{ fontSize: 12 }}>未匹配到相关设定，本次将作自由创作。</span>
          ) : (
            <>
              <span className="co-row-label">本次参考 {previewRefs.length} 条：</span>
              <div className="co-chips">
                {previewRefs.map((r) => {
                  const off = ignoreSet.has(r.entity.id);
                  return (
                    <button
                      key={r.entity.id}
                      className={'co-chip' + (off ? ' ignored' : '')}
                      onClick={() => toggleIgnore(r.entity.id)}
                      title={off ? '点击恢复：本次将参考该设定' : '点击忽略：本次跳过该设定'}
                    >
                      {r.entity.name}{off ? ' ⊘' : ''}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
      {constraintMode && entities.length === 0 && (
        <div className="co-constraint-row">
          <span className="tip" style={{ fontSize: 12 }}>当前世界还没有实体，开启约束模式后将自动参考你创建的设定。</span>
        </div>
      )}

      {/* 引用上下文：手动把文章/实体固定为 AI 的长期参考 */}
      <div className="co-pin-row">
        <div className="co-pin-head">
          <span className="co-row-label">引用上下文{pinned.length > 0 && `（${pinned.length}）`}</span>
          <button className="co-add-ref" onClick={() => setPickerOpen((v) => !v)} title="添加文章或实体作为固定参考">
            {pickerOpen ? '收起' : '＋ 添加'}
          </button>
        </div>
        {pinned.length === 0 ? (
          <span className="tip" style={{ fontSize: 12 }}>点「＋ 添加」把文章/实体固定为 AI 的长期参考上下文（与约束模式独立，始终生效）。</span>
        ) : (
          <div className="co-chips">
            {pinned.map((p) => {
              const item = p.kind === 'entity' ? entities.find((x) => x.id === p.id) : docs.find((x) => x.id === p.id);
              const label =
                p.kind === 'entity'
                  ? item ? `$${(item as WikiEntity).name}` : '（已删除实体）'
                  : item ? `${(item as { title: string }).title}` : '（已删除文章）';
              return (
                <button key={p.kind + p.id} className="co-chip pinned" onClick={() => togglePin(p.kind, p.id)} title="点击移除该引用">
                  {label} ✕
                </button>
              );
            })}
          </div>
        )}
        {pickerOpen && (
          <div className="co-picker">
            <div className="co-picker-col">
              <div className="co-picker-title">文章</div>
              <div className="co-picker-list">
                {docs.length === 0 && <div className="tip" style={{ fontSize: 12 }}>暂无文章</div>}
                {docs.map((d) => (
                  <button key={d.id} className={'co-pick-item' + (isPinned('doc', d.id) ? ' on' : '')} onClick={() => togglePin('doc', d.id)}>
                    {isPinned('doc', d.id) ? '✓ ' : ''}{d.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="co-picker-col">
              <div className="co-picker-title">实体</div>
              <div className="co-picker-list">
                {entities.length === 0 && <div className="tip" style={{ fontSize: 12 }}>暂无实体</div>}
                {entities.map((e) => (
                  <button key={e.id} className={'co-pick-item' + (isPinned('entity', e.id) ? ' on' : '')} onClick={() => togglePin('entity', e.id)}>
                    {isPinned('entity', e.id) ? '✓ ' : ''}{e.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="copilot-body" ref={scrollRef} onScroll={onBodyScroll}>
        {msgs.slice(1).map((m, i) => (
          <CoMessage
            key={i}
            msg={m}
            index={i}
            isLast={loading && i === msgs.length - 2}
            loading={loading}
            label={currentModel.label || 'AI'}
            expanded={showThinking.has(i)}
            supportsThinking={!!currentModel?.supportsThinking}
            onToggleThinking={toggleThinking}
          />
        ))}
        {loading && (
          <div className="co-status-row">
            <span className="tip">AI 响应中…</span>
            <button className="co-stop-btn" onClick={stop} title="终止当前响应">停止</button>
          </div>
        )}
        {cited.length > 0 && (
          <div className="co-cited-row">
            <span className="co-row-label">本次引用设定：</span>
            <div className="co-chips">
              {cited.map((id) => {
                const e = entities.find((x) => x.id === id);
                if (!e) return null;
                return (
                  <button key={id} className="co-chip cited" onClick={() => jumpToEntity(id)} title="点击跳转到该实体">
                    {e.name} ↗
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="copilot-foot">
        {pendingImages.length > 0 && (
          <div className="co-thumbs">
            {pendingImages.map((url, i) => (
              <div key={i} className="co-thumb">
                <img src={url} alt="待发送图片" />
                <button className="co-thumb-x" onClick={() => removeImage(i)} title="移除">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="co-foot-row">
          <button className="co-img-btn" onClick={() => fileRef.current?.click()} title="发送图片（支持多张）" disabled={loading}></button>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onPickImage} />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !loading) { e.preventDefault(); send(); } }}
            placeholder={loading ? '等待 AI 响应中…' : '输入你的问题…（可附图片 / 引用上下文）'}
            disabled={loading}
          />
          {loading ? (
            <button className="co-stop-btn" onClick={stop} style={{ fontSize: 12 }}>停止</button>
          ) : (
            <button className="mode-btn active" onClick={send} disabled={(!input.trim() && pendingImages.length === 0) || !currentModel} style={{ fontSize: 12 }}>发送</button>
          )}
        </div>
      </div>
    </div>
  );
}
