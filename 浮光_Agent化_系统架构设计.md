# 浮光 Agent 化 · 系统架构设计

> 分支：`agent方向预览` ｜ 日期：2026-08-15 ｜ 状态：v1.2 评审稿（设计定稿，待确认问题已全部闭环）
> 参考：《织界 WorldForge 系统设计方案 v2》（`D:\世界观编辑器历史版本\worldforge-agent-system.md`）
> 约束：**保留浮光现有全部功能**，纯本地自研数据层，逐步增量升级（非从零重写）

---

## 1. 目标与约束

### 1.1 产品目标
把浮光从「世界观管理工具 + AI 辅助功能」升级为**面向世界观创作者的 Agent 智能体**，新增四项核心能力：

| # | 能力 | 一句话定义 |
| --- | --- | --- |
| 1 | **角色模拟** | 大模型扮演世界观中的角色；支持**观察式沙盘**（多子代理自发推演）与**导演式**（用户逐步精控）双模式；支持**在时间轴内按划定时间尺度推演**；每角色可单独配置模型与人格提示词 |
| 2 | **全局大纲** | 独立于正文的**树形全局大纲**（**自由嵌套任意深度**），Agent 具备读写大纲的能力，用于长文结构与伏笔管理 |
| 3 | **跑团模拟** | 基于规则书组织跑团；AI 当 GM + 用户当玩家，或 AI 全自动跑团；**局域网多用户同场参与**（远程玩家安装浮光实例加入）；规则书=**兼容 DND5e / COC7 / Cyberpunk RED 等世界观框架**，技能检定公式用户可编辑 |
| 4 | **聊天平台接入** | 以**本地 API 桥接**方式兼容聊天平台机器人（QQ/微信/Telegram/通用 Webhook）：用户在聊天软件里发灵感给机器人 → 自动整理进草稿箱（结构化/原文直存可选） |

### 1.2 硬约束（来自参考文档 + 用户要求）
- **保留全部已有功能**：实体库/关系图/时间线/文档/草稿/线索板/一致性检查/分享/MaterialForge/提案队列/文章抽取/消歧/设卡/NL→模板/语义检索。
- **事实写入三原则**（参考文档创新点 1，浮光已有雏形，需补强）：
  - 可溯源 provenance：谁写的、哪个来源、何时 —— 提案对象需补 `provenance` 字段
  - 可裁决 disputed：冲突事实进入待裁决状态 —— **提案队列天然满足**（pending = 待裁决）
  - 可回滚 rollback：实体版本历史已存在（M7-3 `versions`），沙盘/跑团事件流另做快照
- **纯本地数据层**：不引入 Neo4j/Qdrant/Redis 等外部服务（用户已确认），自研轻量索引。
- **LAN 多人**：仅局域网内，无外网暴露；远程玩家**安装浮光实例**加入（非浏览器）。
- **聊天桥接安全**：本地 HTTP API 仅绑定回环（127.0.0.1）+ 随机令牌认证 + 限流；聊天凭证不落盘明文；平台适配交给外部框架（AstrBot 等），浮光只提供平台无关 API。
- **规则书版权红线**：DND5e/COC7/Cyberpunk RED 为商业 IP，浮光**只内置通用规则框架骨架**（属性/技能/检定公式/难度表结构 + 三套简化默认值），完整规则书由用户以 `.fugurule` 文件导入（作为插件与知识库补充），不内置版权内容。

### 1.3 关键复用点（不重复造轮子）
| 已有资产 | 复用为 |
| --- | --- |
| 提案队列 `WorldData.proposals` + `dispatchProposal` | **审批层**（Agent 一切写操作的唯一出口） |
| 对话持久化 `WorldData.chats` + `upsertChat` | **会话/工作记忆**载体 |
| 草稿箱 `WorldData.drafts` | **聊天灵感落点**（机器人整理结果的写入目标） |
| embedding 语义索引（aiStore + embeddingIndex） | **RAG 检索**基础（世界库向量召回） |
| 多模型配置 `aiStore.models[]`（OpenAI 兼容） | **模型服务层**（子代理/整理管线模型路由） |
| 一致性检查 features/consistency | **pre-execute 监听器**雏形 |
| dev 分支静态服务器 + 令牌认证 | **LAN 跑团服务 / 本地桥接 API**安全底座 |
| `agentPropose.ts`（主动提议 v1） | **感知层**雏形：世界变化 → 主动提案 |

---

## 2. 现状盘点 → 新架构映射（保留性清单）

| 现有功能 | 所属新架构层 | 处置 |
| --- | --- | --- |
| 三栏布局 / 实体库 / 关系图 / 时间线 | 用户交互层 · 设定看板 | 保留 |
| 文档（TipTap）/ 草稿 / 线索板 | 用户交互层 · 编辑器与看板 | 保留；文档与大纲节点关联；草稿为聊天灵感落点 |
| MaterialForge（模板/风格/八源/批量/导出） | 能力工具层 · `materials` 工具 | 保留；升级为 Agent 可调工具 |
| 一致性检查 | 能力工具层 · `consistency` 监听器 | 保留；挂 pre-execute |
| 提案队列 + 主动提议 | 审批层（横切） | 保留；补 provenance |
| 文章抽取 / 消歧 / 设卡 / NL→模板 | 能力工具层（现成工具） | 保留；纳入工具注册表 |
| 对话持久化 + 语义检索 | 记忆层 + RAG | 保留；扩展为三级记忆 |
| 多模型配置 | 模型服务层 | 保留；加子代理/整理路由 |
| 分享 / 导入导出（fugu*） | 用户交互层 + 插件总线 | 保留；规则书沿用 fugu* 格式族 |

---

## 3. 目标架构（五层 + 插件总线）

```
┌──────────────────────────────────────────────────────────────────┐
│  用户交互层（React，现有三栏 + 新增视图）                           │
│  设定看板：实体/关系/时间线/文档/草稿/线索板/MaterialForge          │
│  + 大纲视图 · 沙盘视图 · 跑团视图 · 角色卡面板 · 桥接管理面板       │
└──────────────────────────────┬───────────────────────────────────┘
                               │ 自然语言 + 工具调用结果
┌──────────────────────────────▼───────────────────────────────────┐
│  Agent 编排层（新增：src/features/agent/）                         │
│  Agent Loop（响应式/规划式双 loop） · Planner · Router            │
│  SubAgent 运行时（角色实例，每角色独立模型+人格） · 记忆调度        │
│  Reflection · StyleKeeper · 灵感整理管线（聊天接入）              │
└──────────────────────────────┬───────────────────────────────────┘
                               │ 工具调用（带 pre/post 监听器）
┌──────────────────────────────▼───────────────────────────────────┐
│  能力工具层（Service 注册表 + 工具流水线 pre→execute→post）         │
│  world-kb · outline · character-sim · rules-engine · memory(RAG)  │
│  inspiration(灵感整理) · extract/linker/scene/template-gen/        │
│  materials · consistency(pre) · propose                           │
└──────────────────────────────┬───────────────────────────────────┘
                               │ 经审批层写入（提案队列，唯一写入口）
┌──────────────────────────────▼───────────────────────────────────┐
│  数据存储层（纯本地自研）                                          │
│  实体/关系（内存+倒排） · embedding 向量索引（已有）               │
│  大纲树(任意深度) · 沙盘/跑团事件流 · 规则书 · 三级记忆 · 提案队列 │
│  草稿箱(聊天灵感) · 桥接接入日志                                   │
└──────────────────────────────┬───────────────────────────────────┘
                               │ OpenAI 兼容协议
┌──────────────────────────────▼───────────────────────────────────┐
│  模型服务层（已有 aiStore 升级）                                   │
│  多模型适配器（云端 / 本地 Qwen3.5 35B）· 子代理/整理模型路由      │
│  LAN 服务：主进程 WS（跑团多人）                                   │
│  本地桥接 API：主进程 HTTP 回环 + 令牌（聊天灵感）                 │
└──────────────────────────────────────────────────────────────────┘
        ════════════ 插件扩展总线（轻量 Service 注册表）═══════════
```

### 3.1 与参考文档的关系
- **五层骨架沿用**，每层「就地升级」而非重写：编排层与能力工具层是主要新增面；数据层用自研索引替代图库/向量库外部服务；模型服务层复用 aiStore。
- **借鉴 Harness 三件套**（不照搬 Cordis 运行时）：
  1. Service 注册表：能力工具以 `registerTool(name, {pre, execute, post})` 注册，模式切换只换「工具集 + system-prompt + 编排策略」
  2. 工具流水线 waterfall：`consistency.pre` 在写世界库前查冲突；`styleKeeper.post` 在生成后查漂移
  3. 模式 = 配置层：写书 / 沙盘 / 跑团三态共享世界库与记忆，`<1s` 无感切换（TS 配置对象，非 YAML）

### 3.2 三模式配置（模式即配置层）
```ts
// src/features/agent/modes.ts（示意）
const NOVEL_MODE: ModeConfig = {
  persona: '严谨的小说创作助手',
  tools: ['world-kb', 'consistency', 'outline', 'extract', 'materials', 'memory', 'propose'],
  loop: 'responsive',
};
const SANDBOX_MODE: ModeConfig = {
  persona: '中立叙事者（世界模拟器）',
  tools: ['world-kb', 'character-sim', 'consistency', 'memory', 'propose'],
  loop: 'planner',          // 沙盘推演用规划式 loop
  subAgents: { strategy: 'autonomous', pacing: 'auto', steps: 5 },  // 或 pacing:'step' 每步确认
};
const TTRPG_MODE: ModeConfig = {
  persona: '经验丰富的跑团主持人(GM)',
  tools: ['world-kb', 'rules-engine', 'npc-gen', 'consistency', 'memory', 'propose'],
  loop: 'responsive',
  rulesEngine: 'dnd5e',     // 或 coc7 / cyberpunk-red / 用户导入的规则书
  lan: { enabled: true },   // 开启跑团房间与局域网多人
};
```

---

## 4. 核心机制设计

### 4.1 审批层：提案队列补强（Agent 写操作唯一出口）
- 现状：`addProposal/acceptProposal/rejectProposal` + `dispatchProposal` 已闭环。
- 补强：
  1. `Proposal` 增加 `provenance?: { sourceType: 'user'|'agent'|'subagent'|'gm'; actorId?: string; trigger?: string }` —— 满足可溯源
  2. 沙盘/跑团产生的写操作（建 NPC、更新角色经历、记录剧情事实）一律 `addProposal({source:'scene'|'chat', ...})`，批量采纳提供「按来源一键采纳」
  3. `ProposalOp` 扩展 **`addTimelineEvent`**（时间线事件写入，供沙盘时间尺度推演「采纳落时间线」使用，用户已确认走提案队列），对齐现有 Timeline 数据模型
  4. 回滚：实体 `versions` 已支持；沙盘事件流按回合做 checkpoint，可回退
- **红线不变**：Agent/子代理/GM 均无静默写权限。
- **边界**：聊天灵感**只进草稿箱**（用户自己的内容整理，非 AI 生成世界设定，不占用提案额度）；结构化整理中识别到的关联实体仅作为草稿元数据，**不写世界库**——后续若需升级为实体提案，另行开关。

### 4.2 感知层与记忆：世界快照 + 三级记忆
- **世界快照打包器** `buildWorldSnapshot()`：实体(取 topK 高影响)、关系、大纲(树)、时间线、关键文档摘要 → 压缩上下文，供 Planner/子代理初始化使用（预算上限可配）。
- **三级记忆**（参考文档四级简化）：
  - 会话级：现有 `ChatSession`（跑团/沙盘各自的对话）
  - 工作级：当前沙盘/跑团事件流（`SimEvent[]`/`SessionTurn[]`，滚动截断）
  - 长期级：embedding 语义索引（已有）检索世界库事实；重要剧情结论可经提案写入实体备注
- 记忆调度：每角色/每回合的 token 预算，超限自动裁剪（`truncateToBudget`）。

### 4.3 子代理运行时（角色模拟核心）
```ts
interface SubAgent {
  id: string;
  entityId: string;          // 角色卡（复用 WikiEntity + customFields）
  role: 'protagonist' | 'npc' | 'gm' | 'player';
  personaPrompt: string;     // 扮演指令，**用户可在角色卡面板直接编辑**
  memorySlot: string[];      // 该角色的专属经历（回合制追加，上限 N 条）
  strategy: 'autonomous' | 'on-command';  // 观察式 vs 导演式
  modelId?: string;          // **每角色可单独选择模型**（aiStore.models 中选，默认当前模型）
}
```
- **执行模型**：每个子代理一次「行动」= 一次 LLM 调用（输入：世界观快照摘要 + 角色卡 + 人格提示词 + 记忆槽 + 最近事件窗口 + 行动指令）。**串行化队列**执行（避免并发速率限制/成本失控），用户可调并发数。
- **观察式沙盘**：事件循环 = 当前活跃角色按序行动 → 叙事者汇总 → 环境反馈 → 下一轮；用户随时插话/暂停/指定某角色行动。设「最大步数」防止失控。
  - **推进节奏可选**：`pacing:'step'` 每步确认；`pacing:'auto'` 自动连推 N 步后暂停（N 用户可配，默认 5）。
  - **时间尺度推演**：可指定「推演一个时间周期内发生的事」（如一周/一月），沙盘事件带时间戳与时间线联动；推演结果「采纳落时间线」时**走提案队列**（新增 `addTimelineEvent` op，用户确认后写入，不静默改时间线）。
- **导演式**：仅用户指令的角色行动，一次推进一个事件，可让 Agent 对行动做后果推演。
- **一致性护栏**：子代理行动若要写世界库（新增角色经历/关系），走提案队列；行动内容若有设定矛盾，`consistency.pre` 拦截并提示。

### 4.4 全局大纲（树形 · 任意深度）
```ts
interface OutlineNode {
  id: string;
  title: string;
  kind: 'arc' | 'volume' | 'chapter' | 'scene' | 'note';
  parentId: string | null;   // 递归嵌套，**任意深度**（无层级上限）
  order: number;             // 同级排序
  status: 'todo' | 'drafting' | 'done' | 'paused';
  summary?: string;          // 一行为 Agent 可读
  docId?: string;            // 关联正文文档
  timelineId?: string;       // 关联时间线
  entityIds?: string[];      // 关联实体（伏笔/线索可挂实体）
  foreshadow?: { setup: boolean; payoff: boolean };  // 伏笔标记
}
```
- 数据存 `WorldData.outline`（Agent 可经 `outline` 工具读写，属正常数据操作，走提案队列）。
- **Agent 理解大纲**：快照包含大纲树；Planner 续写/沙盘推演时按「当前章节节点 + 状态」约束生成方向；支持「我写到这里，继续」类指令。
- UI：大纲视图递归树渲染（任意深度、拖拽调整、增删改/升降级）+ 与文档/时间线双向跳转；正文编辑器加「当前大纲节点」面包屑。

### 4.5 跑团引擎 + 规则框架
```ts
interface Rulebook {
  id: string; name: string; universe?: string;  // 世界观框架：dnd5e / coc7 / cyberpunk-red / custom
  dice: string;                 // 默认骰子表达式，如 1d20 / 1d100
  stats: string[];              // 属性
  skills: { name: string; base: string }[];     // 技能 + 关联属性
  formula: string;              // **技能检定公式，用户可编辑**，如 "1d20+{attr}+{skill}"、"d100<=({skill}*5)"
  difficulty: Record<string, number>;           // 难度阈值表（可自定义键值）
  meta: string;                 // 规则说明（供 GM 提示词使用）
}
interface TTRPGSession {
  id: string; mode: 'ai-gm' | 'auto';           // AI 主持 / 全自动
  rulebookId: string; gmAgentId?: string;
  players: { name: string; actorId?: string; isRemote?: boolean }[];
  log: SessionTurn[]; state: Record<string, unknown>;   // HP/道具/进度等
  lan?: { roomCode: string; token: string; port: number };
}
```
- **规则框架**：内置**三套骨架**（DND5e 简化 / COC7 简化 / Cyberpunk RED 简化：属性+技能+默认检定公式+难度表），仅覆盖结构与通用数值，**不内置商业 IP 完整规则**；完整规则书由用户导入 `.fugurule` 文件（沿用 fugu* 纯本地格式族），作为**插件与知识库补充**。
- **检定公式用户可编辑**：公式字符串 + 变量（`{attr}`/`{skill}`/`{mod}`），`rules-engine` 解析执行并校验合法性；公式存在 Rulebook 中，规则书导入/编辑面板直接改。
- **规则引擎工具** `rules-engine`：骰子表达式解析（`/roll 1d20+3`）、技能检定（公式+难度判定）、结果落地会话状态。三内置骨架 + 自定义均可新建。
- **AI-GM 模式**：GM 子代理持规则书 meta + 世界观快照主持；用户(们)以玩家身份行动；掷骰/判定走规则引擎。
- **全自动模式**：GM + NPC 全由子代理扮演，事件流落盘，产出剧情素材/剧本草稿（可转大纲或提案入库）。

### 4.6 LAN 多人跑团（Electron 主进程 WS 服务）
- **形态**：房主（创建跑团房间的桌面实例）在**主进程**启动 WS 服务（复用 dev 分支令牌认证/路径穿越防护模式）；**远程玩家安装浮光应用**，通过「加入跑团房间」入口输入 `房主IP:端口 + 房间码 + 令牌` 连接（应用内跑团视图完整可用，无浏览器简化页）。
- **房间协议**：加入/离开、行动广播、场景同步、掷骰结果、回合状态、聊天。
- **安全红线**（沿用 dev 安全基线）：仅监听局域网接口；随机令牌 + 房间码双因子防未授权加入；路径穿越防护已有；`setWindowOpenHandler`/`will-navigate` 防护已有；不做任何公网暴露、不开放任意文件读取。
- **数据一致**：房间状态在主进程同步，房主实例落盘（`WorldData.ttrpgSessions`）；远程端只读同步 + 输入回传，不直接写库。

### 4.7 聊天平台接入（本地 API 桥接）
- **形态（用户已确认）**：浮光**不做平台适配器**，暴露**本地 HTTP API**（主进程，仅回环 + 随机令牌 + 限流）；外部机器人框架（AstrBot 等）写插件把聊天消息转发给浮光，复用其多平台生态（QQ OneBot v11 / 微信 / Telegram / 任意 Webhook）。**第一版参考实现 = 通用 curl 用例**（API 契约文档 + curl 示例即可对接任意框架），AstrBot 专用插件后续视需要再出。
- **API 契约**（平台无关，消息带平台元数据）：
  ```
  POST http://127.0.0.1:{port}/api/v1/inspiration
  Headers: { Authorization: 'Bearer <token>' }
  Body: {
    platform: 'qq' | 'wechat' | 'telegram' | 'webhook',
    chatId: string, userId: string, nickname: string,
    text: string, ts?: number
  }
  → 200 { ok, draftId, mode: 'structured'|'raw', summary?, outlineHint? }
  ```
- **处理管线**：认证 → 限流 → 整理模式选择（**设置可切换**：默认 AI 结构化，可切原文直存）：
  - 结构化：调 LLM 抽 标题/摘要/标签/关联实体，**并顺带推荐应挂载的大纲节点**（`outlineHint`：匹配最相关的大纲节点 id+标题，仅作推荐写入草稿元数据，不自动挂载）→ 生成结构化草稿
  - 原文直存：原文 + 来源标记直接入草稿箱，零 AI 成本
  - 草稿统一带 `source: { platform, userId, nickname, ts }` 标记
- **回执**：处理结果（`draftId` + **AI 摘要 summary** + outlineHint）返回给外部框架，由机器人回复用户（如「已整理到草稿箱：XXX」并展示摘要，可顺带问「是否挂到大纲《XX》节点？」）。
- **桥接管理面板**：设置区「聊天接入」——显示端口/令牌（可轮换）、接入日志（近期灵感消息）、整理模式开关、测试发送。
- **与审批层关系**：灵感只进草稿箱，不占提案；结构化识别出的实体不写库（避免「聊天里提个名字就建实体」的噪音）。后续如需升级为主动提议，加独立开关。

### 4.8 插件扩展总线（轻量）
- `registerTool(name, {pre?, execute, post?})` + `ModeConfig` 声明装配；不引 YAML/Cordis。
- 插件市场 v2：规则书（`.fugurule`） / 世界模板 / 导出（沿用 fugu* 纯本地导入导出，零在线依赖——与既有决策一致）。

---

## 5. 数据模型扩展（WorldData diff）

```ts
interface WorldData {
  /* …既有字段全部保留（folders/docs/timelines/styles/materials/templates/
     entities/relations/drafts/clueBoard/proposals/chats/activeDocId…）… */
  outline: OutlineNode[];              // 新增 4.4（任意深度树）
  simulations: Simulation[];           // 新增：沙盘/角色模拟会话
  ttrpgSessions: TTRPGSession[];       // 新增：跑团会话（含 LAN 房间信息）
  rulebooks: Rulebook[];               // 新增：规则书（含三套内置骨架 + 用户导入）
  bridgeLog: BridgeEntry[];            // 新增：聊天接入日志（灵感消息留痕）
}
interface Simulation {
  id: string; mode: 'sandbox' | 'directed';
  title: string; scenario: string;     // 初始场景描述
  actors: SubAgent[]; events: SimEvent[];
  pacing: 'step' | 'auto';             // 每步确认 / 自动连推
  autoSteps: number;                   // pacing='auto' 时连推步数（默认 5）
  timeScale?: { unit: 'day'|'week'|'month'|'year'; span: number };  // 时间尺度推演
  stepBudget: number;                  // 观察式最大步数（防失控）
  status: 'running' | 'paused' | 'ended'; createdAt: number;
}
interface SimEvent {
  id: string; ts: number; step: number;
  actor: string;                       // actorId | 'narrator' | 'system' | 'user'
  kind: 'action' | 'speech' | 'narrate' | 'system';
  content: string;
}
interface BridgeEntry {
  id: string; ts: number;
  platform: string; userId: string; nickname: string;
  text: string; mode: 'structured' | 'raw';
  draftId: string; summary?: string;   // 结构化时的 AI 摘要
  outlineHint?: { id: string; title: string };  // 推荐挂载的大纲节点（仅元数据）
}
```
兼容策略：旧世界文件无新字段 → 读取时 `?? []` 兜底（与 proposals 同款做法），不破坏既有数据。

---

## 6. 转变路径（增量，Phase 0 → 5）

| Phase | 主题 | 交付物 | 验证标准 | 依赖 |
| --- | --- | --- | --- | --- |
| **0** ✅ | 基座（已有） | 提案队列 / chats / 安全基线 / 主动提议 v1 | — | — |
| **1** | 认知基础 | ① 大纲数据模型 + 大纲视图（任意深度树、关联文档/时间线）② 世界快照打包器 `buildWorldSnapshot` ③ 三级记忆调度 | 大纲任意深度增删改/拖拽；快照可灌入任意 AI 调用且 token 可控 | 0 |
| **2** | 单 Agent 编排 | ① 工具注册表（现有功能收敛为 Service）② Agent Loop（响应式）+ Planner（规划式）③ AI 侧栏升级为「协作者」 | 一个自然语言指令可连续完成「抽取→查重→提案」多步任务 | 1 |
| **3** | 多子代理 · 角色模拟 | ① SubAgent 运行时（每角色独立模型+人格词）+ 串行队列 ② 沙盘视图 ③ 观察式/导演式 + pacing 节奏 + 时间尺度推演 ④ 一致性/预算护栏 | 多角色自主推进 ≥10 步无矛盾；时间尺度推演产出可采纳落时间线 | 2 |
| **3.5** | 聊天接入（可与 3 并行） | ① 本地桥接 API（回环+令牌+限流）② 灵感整理管线（结构化/直存可选）③ 桥接管理面板 + AstrBot 插件参考实现 | 外部框架推一条消息 → 草稿箱出现带来源标记的草稿 | 2 |
| **4** | 跑团引擎 · LAN 多人 | ① 规则引擎 + 三套骨架规则书（检定公式可编辑）② AI-GM / 全自动双模式 ③ LAN WS 服务 + 房间管理（远程玩家装应用加入）④ 跑团视图 | 本地单机跑通 AI-GM 一场；两台机器应用实例同房间参与 | 3 |
| **5** | 质量增强 | ① StyleKeeper（post 漂移检测）② 分歧树/伏笔账本（大纲节点 foreshadow 落地）③ 插件市场雏形（规则书/模板/导出 fugu*） | 长文口吻漂移评分 ≥4/5；伏笔自动回收提醒 | 1–4 任意后 |

**并行说明**：Phase 1 与 0.5 遗留项并行；Phase 3 与 3.5 均依赖 2，可并行；Phase 4 依赖 3。

---

## 7. 风险与红线

| 风险 | 对策 |
| --- | --- |
| 子代理并发调用成本/速率 | 串行执行队列 + 可配并发 + 步数预算 |
| 观察式沙盘自主失控/跑偏 | 最大步数 + 每轮「叙事者汇总」+ 用户随时暂停/插话 + pacing 可选 |
| Agent 擅自写设定 | 提案队列唯一写入口（不可绕过）；provenance 溯源 |
| 大纲/事件流数据膨胀 | 事件流滚动截断 + 摘要沉淀到实体/大纲 |
| **LAN 服务被滥用** | 仅局域网绑定 + 随机令牌 + 房间码 + 无公网暴露（dev 安全基线） |
| **聊天桥接被滥用/注入** | 仅回环绑定 + 令牌 + 限流；聊天文本视作外部输入：进草稿箱前过 sanitizeHtml（已有消毒器）；不做任何网络暴露 |
| **规则书版权风险** | 只内置框架骨架，不内置商业 IP 完整规则；完整规则书由用户导入 |
| 与既有功能回归 | 每 Phase 走 `npx tsc --noEmit` + `npm run build` 零错误；保留性清单（§2）回归验证 |

---

## 8. 待确认问题（已全部确认 ✅）

1. ✅ 聊天桥接参考实现：**先给 curl 通用用例**（AstrBot 插件后续视需要再出）
2. ✅ 结构化整理：**顺带推荐挂载的大纲节点**（outlineHint，仅元数据不自动挂载）
3. ✅ 时间尺度推演落时间线：**走提案队列**（新增 `addTimelineEvent` op，用户确认后写入）
4. ✅ 桥接回执：**把 AI 摘要也回传展示**

> 设计定稿完成。落地顺序待用户指定（建议从 Phase 1 认知基础开始）。

---

*本文档为 v1.1 评审稿，落地细节（组件拆分、IPC 契约、工具 schema、桥接 API 文档）在对应 Phase 启动时另行细化。*
