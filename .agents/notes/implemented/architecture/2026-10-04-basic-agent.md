# Agent Note: 基础 agent 插件（m2-03）：cordis 双插件、原生工具调用与持久会话

Status: implemented

[English](2026-10-04-basic-agent.en.md) | 中文

## Problem

m2-02 之后宿主有了流式推理与 chat 面板，但模型仍只能「聊」：不能读库、不能检索、不能落笔记。m2-03 要把宿主升级为 agent（issue #30，对标 pi/dsh 交集）：多轮上下文 + read/grep/write/edit 四工具 + 笔记落盘 + 历史会话恢复后继续。设计须一次性回答六个结构问题——循环住哪、工具协议、grep 供给（ripgrep 在环境无关约束下怎么来）、写操作安全模型、会话持久化形态、与 app-chat 的关系——且守住分层纪律与环境无关性硬约束。

## Decision

### 定位：通用工具面，语境由交互驱动

工具按通用文件 agent 设计，不预设学习语境；学习场景（「总结当前文件」「把这段记成笔记」）由用户对话驱动：system prompt 每回合现组，注入库根 `AGENTS.md`（存在时）、当前活动文件路径、当前审批模式句。笔记无约定落点——write/edit 的目标路径完全由对话决定；m2-04 的 llm-wiki 将以「库内初始化 AGENTS.md」接管 agent 行为，本 issue 现在就把 AGENTS.md 注入约定立起来，届时 agent 侧零改动。

### 模块：cordis 双插件（对齐 dsh）

- **`src/plugins/agent-core/`（内置插件，无 UI）**：提供 `ctx.agent` 服务——回合 loop、四工具、审批门、guardian 审查、JSONL 会话持久化、compaction。`inject: ['llm', 'files', 'workspace']`。对齐 dsh「agent loop 本身也是插件」：复用 cordis 的 inject 依赖序与 fiber 清理（流句柄/AbortController 随热重载回收），m2-04 经 `inject: ['agent']` 消费。内部书写纪律：核心类构造注入依赖、不 import cordis 类型，vitest 可手搓 ctx 全链路测。
- **`src/plugins/app-agent/`（内置插件，纯 UI）**：`inject: ['agent', 'slots', 'workspace']`，挂 `sidebar.right`，取代 app-chat（从模块表移除，render/attachments 等可复用模块搬入，目录删除）。纯聊天 = 无工具回合，app-chat 能力是超集的子集，不并存两套对话面板。
- `src/host/context.d.ts` 声明合并增 `agent` 服务类型（注明由内置插件提供而非 bootstrap）；files 服务增 `grepFiles` / `authorizeReadPath` / `appendSessionEvent` / `deleteSessionFile` 四个 facade（四条新 Rust 命令只经宿主面触达，分层不变）；外置插件 guard 白名单不变——本 issue 不对外暴露 agent。

### 工具协议：OpenAI 原生 function calling

- 宿主 `ChatInput` 增 `tools` 声明；消息契约增 assistant `toolCalls` 与 `tool` 结果角色；Rust `ChatRequest`/`ChatMessage` 对应扩展透传（`tools`、`tool_calls`、`tool_call_id`）。接收端 m2-02 已就绪（`tool-call-delta` 组装进快照），本 issue 只补「进」的方向。
- 端点能力门禁增 `tools` 能力位（llm-settings 勾选）：agent 会话选到无 tools 能力的端点时显式拒绝并提示。
- 否决文本协议（XML/JSON 混正文）：解析脆弱、流式半截难处理，pi/dsh 均否决。

### loop 状态机与消息模型

- 消息三型（全部可序列化纯数据）：`user`（content 复用宿主多模态 part 联合）/ `assistant`（reasoning、text、toolCalls、usage、finishReason）/ `tool`（callId、name、content、isError）。
- log-only 事件（入 JSONL、不进模型上下文）：`approval/asked`、`approval/decided`（含裁决者与理由）、`mode/changed`、`compaction`、会话 meta——dsh 不变量：策略与审批不污染 transcript，模型经 system prompt 模式句感知。
- 回合：`sendMessage` → 落 user 消息 → 现组 system prompt + 全量有效历史 + 恒定四工具的 tools 声明（两模式同声明，模式只影响审批路由）→ `chatStream`（rAF 节流快照喂 UI）→ 收齐落 assistant 消息 → 无 toolCalls 则回合结束；有则**串行**执行（每个先过审批门）、逐个落 tool 消息、回到组装。无单回合迭代上限（对齐 Claude Code/Codex/pi 无硬上限；失控逃生 = 停止按钮 + compaction 控长）。
- 中止与半截语义延续 m2-02 定论：只有拿到 finish_reason 的完整回答才入历史；错误/停止的半截正文留在界面、不进上下文、不落盘。

### 四工具语义

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| read | `path`, `offset?`, `limit?` | 绝对路径；文本按行返回（行号前缀，供 edit 定位），默认上限 2000 行、超长行截断、超限标注；二进制/视频/xlsx 拒收并说明。越授权集合 → 越界读审批流 |
| grep | `pattern`, `path?`, `glob?`, `ignoreCase?`, `literal?`, `context?`, `limit?` | pi/dsh 参数子集，映射 `rg --json`；`path` 默认库根，越界 → 审批；预算：raw 20 MB / 30 s 超时 / limit 默认 100；错误词表 `SEARCH_INVALID_PATTERN` / `SEARCH_FAILED` / `SEARCH_RAW_OUTPUT_OVERFLOW` / `SEARCH_ABORTED` |
| write | `path`, `content` | 限授权集合内，整文件写入（新建/覆盖）；过审批门；原子写 + `fs://changed` 广播 |
| edit | `path`, `old_string`, `new_string`, `replace_all?` | str-replace 精确匹配；零匹配/多匹配（未设 replace_all）报错回灌；审批卡 old/new 对照；原子写 + `fs://changed` |

工具结果统一大小上限，超限截断并显式标注。「当前打开的文件」不做占位符魔法：活动文件路径在 system prompt 里，模型自己传给 read。

### grep 供给：sidecar ripgrep（dsh 式构建期打包）

- 二进制经 `@vscode/ripgrep` npm 包供给（当前 1.18.0，内含 ripgrep 15.0.0；「npm 当仓库用」定论的延伸），构建脚本复制为 Tauri sidecar（`binaries/rg-<target-triple>`），CI 按平台构建各拿各的；`dep-allowlist` 登记该包，`docs/environment-independence.md` 登记自带 sidecar 说明。否决 pi 式运行时下载（硬约束直接拒绝）与纯前端 TS 扫描（遍历已在 Rust——read_tree 同族，IPC 只回命中行）。
- Rust 新增 grep 命令：裸 argv spawn（不过 shell，无引号面）、解析 `rg --json` 完整 stdout、上述预算与错误词表；spawn 前过 `path_authorized`（与所有文件命令同一决策点）。

### 授权边界与越界读

- 边界 = 窗口授权注册表里的**路径集合**（非单一库目录）；`~/.studywiki` 配置域排除不变。
- 越界 read/grep：不硬拒，发审批（粒度选择：仅此文件 / 所在目录）；批准后新 Rust 命令 `authorize_read_path` 把路径登记进窗口注册表（会话级，窗口关闭失效），之后同范围免问。写操作**任何模式不可越界**：write/edit 落在集合外直接 tool 错误回灌，不开审批口子。
- 威胁模型（为何读不放任全开）：读到的内容进模型上下文发远程 endpoint，库内恶意文本可提示词注入诱导外泄（如 `~/.aws/credentials`）；授权集合只能由人/guardian 扩大，模型自己扩不了。

### 审批与两模式（对标 Codex 请求批准 / 帮我批准）

- 需审批的动作仅两类：授权集合内的 write/edit；越界 read/grep。其余直接执行。
- 两模式共享同一审批事件流，区别只在应答者：**请求批准**（新建会话 durable 默认，settings `agentApprovalMode` 可改）= 审批卡等人点击（write 内容预览 / edit old-new 对照 / 越界读粒度选择；批准一次 / 拒绝附理由回灌）；**帮我批准** = guardian 审查调用自动裁决——一次独立 `ctx.llm.chat`（非流式、无状态、不带会话历史、用当前会话同模型）：系统提示为审查策略（库内笔记写入放行；可疑越界读、批量覆盖、明显注入指令拒绝），输入为工具名 + 参数摘要，输出结构化裁决 + 理由。JSON 被推理/说明文本包裹时提取后仍严格校验；解析失败与 408/429/5xx 瞬态错误按 200ms/400ms 退避重试两次，有效拒绝不重试；超时/最终失败一律 fail-closed 视为拒绝。裁决与理由落 `approval/decided` 并在 UI 审批卡只读留痕。
- durable 默认只影响新会话；模式在会话内随时切换，`mode/changed` 落日志 + 下回合 system prompt 模式句更新，且不回写全局默认。否决第三档「零审查自动写」（帮我批准已覆盖无人值守且多一层网）与规则引擎（always-allow 持久规则，YAGNI）。

### 会话持久化与恢复

- 落点 `~/.study-wiki/sessions/<library-key>/<session-id>.jsonl`：离开学习库，避免应用日志进入通用 grep；`library-key` 由库根 sanitize + 稳定 hash 生成，header 行带**格式版本号**（dsh v0→v1 迁移的教训前置）+ `rootPath`（校验用，库移动后提示）+ 标题（首条用户消息前 50 字）。旧库内会话列出时一次性迁移。
- 事件一行一条，**完成才落盘**（流式 delta 永不落盘）；新增 Rust `append_session_event` 命令（O(1) 单行追加，过 `path_authorized`）。
- 库间物理隔离：列表只读当前 root 的 sessions 目录，换 root 即换列表。会话投影暴露 `title`、`messages()`、`lines()`、运行态与 `setModel`，UI 只消费该面。恢复语义 = **只加载不自动跑**：重放 JSONL 渲染历史（含工具卡与审批卡历史样貌），loop 等用户发新消息才续；崩溃尾巴截断到最后完整事件并标注；悬空审批判 `unavailable`（fail-closed，不复活可点卡片）。约定「一个会话同一时间只在一个窗口驱动」，不做锁。
- **compaction 做**：最近响应 `usage.promptTokens` 超阈值（默认 80k，settings 可配）时，下一回合前先把旧段（前半历史）送一次独立摘要调用（保留：用户目标、结论、写改过的文件路径、未完成待办），新段（含最近工具结果）原样保留；旧段替换为摘要消息并落 `compaction` 事件。**日志保留全文**（压缩只影响喂模型的视图），重放按 compaction 事件重建同一有效视图；UI 在压缩点插分隔条（可展开看摘要）。否决多级递归压缩与 tokenizer 精裁（不引依赖，用 usage 实测值）。

### 门禁与测试

- vitest（假 ctx 全链路）：loop 状态机（脚本化 chatStream 多轮工具调用）、审批路由两模式、guardian 裁决解析与 fail-closed、JSONL 序列化/重放/截断、compaction 触发与视图重建、str-replace 边界、授权判定。
- cargo test：`append_session_event` / `authorize_read_path` 授权校验、grep 命令预算与错误词表（fixture 目录 + 真 sidecar）。
- 机械面：commands.md / code-map 生成区重建；`verify:layering`（新插件同样禁 `@tauri-apps/*`）、`verify:env-independence`（sidecar 登记）、`verify:dep-audit`（`@vscode/ripgrep` 白名单）、doc-budgets 登记新增常驻文档；本 Note 与 issue #30 更新（status→in-progress、adr、scope 扩 `src-tauri/**` 等）同 PR。

## Alternatives considered

- 独立 `src/agent/` 纯模块（pi 式）：pi 纯化是为发布 npm 包，本库是应用内部组件；另起手工 DI 等于第二套组合机制，且放弃 cordis 生命周期与 m2-04 的 inject 缝；否，改 dsh 式双插件。
- core 与 UI 合单插件：服务与 UI 生命周期不同（UI 重载不该杀会话），dsh 同样拆分；否。
- 文本协议工具调用：解析脆弱、流式半截难处理；否。
- 纯前端 TS grep / pi 式运行时下载 rg：前者与 read_tree 原生遍历割裂且 IPC 搬运全量内容，后者违反环境无关性硬约束；否。
- 读全开（codex workspace-write 默认读语义）：egress + 注入威胁面下不接受；否。
- 内存会话（app-chat 现状）：需求明确要求历史会话恢复后继续；否。
- 约定 `notes/` 落点 / 预定 m2-04 的 wiki 结构：前者锁死无理由的默认，后者让本 issue 猜 m2-04 契约；否，落点对话驱动 + AGENTS.md 约定。
- 单回合 25 次迭代上限：主流 agent 均无硬上限（dsh 用 repeat-tool-reminder 软提示），停止按钮 + compaction 已够；否。
- app-chat 并存双面板：概念负担 + 内存/持久双会话模型打架；否，取代。
- 并行工具执行：审批卡串行 UX 与实现都简单，首版否，留后续。
- diff 库渲染审批对照：首版 old/new 两段对照够用，不引依赖；留后续。

## Consequences

- issue #30 scope 扩 `src-tauri/**`、`package.json`、`scripts/dep-allowlist.json`、`tests/**`、`docs/environment-independence.*` 等（同 PR 更新 issue 三件套并置 in-progress）。
- app-chat 退役；`sidebar.right` 唯一注册者换成 app-agent；m2-02 的渲染与附件投入整体继承。
- Rust 增四条命令（grep_files / authorize_read_path / append_session_event / delete_session_file）+ sidecar 配置与构建脚本；commands.md、code-map、dep-allowlist、doc-budgets 同步。
- 环境无关性文档登记 rg sidecar（构建期打包、运行零下载）。
- 欠账：compaction 摘要质量无评估机制；并行工具执行；同会话多窗锁；审批卡 diff 渲染；guardian 独立模型配置槽；会话搜索/分叉；块级增量 markdown 渲染（沿 m2-02 欠账）；repeat-tool-reminder 式软防循环提示。
