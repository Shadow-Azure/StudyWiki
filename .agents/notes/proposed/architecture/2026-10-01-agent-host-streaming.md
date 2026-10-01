# Agent Note: agent 宿主流式推理链路与 chat 槽位

Status: proposed

[English](2026-10-01-agent-host-streaming.en.md) | 中文

## Problem

m2-01 落地的推理服务只有非流式 chat：整段回答到齐才返回。学习场景的回答普遍很长（讲题、总结、整理笔记），非流式意味着几十秒白等；且 m2-02 承诺给外置插件的 agent 面还缺两块：chat UI 槽位与上下文取材接口。多模态输入（截图、板书照片、讲课音频）是学习场景的自然输入，消息模型必须原生承载。

## Decision

### 流式链路

- Rust 手写 SSE 行解析（ureq 阻塞读，`data:` 行 + 空行分派 + 多 data 行拼接 + `[DONE]` 哨兵），不引新依赖。EOF 之前无 `[DONE]` = `STREAM_CLOSED` 截断错误（截断不能当正常结束）。
- chunk 经 `tauri::ipc::Channel` 推到前端：每次 invoke 一条独立通道，多窗口天然隔离；前端 drop Channel → Rust send 失败即中断读取。用户主动中止由 `llm_chat_abort(streamId)` 置位，读循环在下一 chunk 前停止。
- `llm_chat_stream(req, channel)` 命令起 worker 线程读流；invoke 的 Promise 在流终结时 resolve——channel 给增量，await 给结算。

### chunk 词表与组装

取主流 agent 实现共识的最小集：`text-delta` / `reasoning-delta` / `tool-call-delta` / `usage` / `finish` / `error`。`tool-call-delta` 本期只定义不消费（m2-03 工具循环要用，协议不留返工）。reasoning 按 `reasoning_content` → `reasoning` → `reasoning_text` 取第一个非空字段（各家兼容端点词形不一）；请求带 `stream_options: {include_usage: true}`，容忍 usage 落在 choice 上。宿主流服务为每条流持有一个前端组装器，并经 `ChatStreamHandle.snapshot()` 暴露唯一 chunk → 消息快照；消费者只读渲染，不碰裸 delta，也不得复制组装器；中断时半截 tool-call 丢弃（无法补伪造结果），text/reasoning 部分保留。

### 多模态消息模型

消息 content 从纯字符串扩为 part 数组；媒体 wire tag 直接是 `image` / `audio`（Rust enum 结构化分派，不用自由字符串 kind），source 是联合类型：`path`（本地文件，Rust 出口读盘转 base64 注入请求体，路径 canonicalize 一次后对同一路径做 root 校验并读取）/ `inline`（剪贴板粘贴与拖拽的 base64，不落盘）/ `url`（远程 URL 原样透传，由 provider 端拉取，客户端不下载）。模型能力门禁前置：endpoint 的 `capabilities` 增 `audio`，消息带图/音频而模型无对应能力时发送前报 `UNSUPPORTED_CONTENT`。

### chat 槽位与渲染

- 新增通用右栏槽位 `sidebar.right`；内置插件 `app-chat` 是其第一个注册者，后续 agent 插件与外置插件共用该槽位。宿主共享 markdown 渲染器住 `src/ui/markdown.ts`。
- 流式渲染走 rAF 合帧 + markdown-it 全量重解析（`html: false` 不变）：一帧内多个 delta 只重渲一次。reasoning 块默认折叠，流完自动收起；中断保留部分内容并标注「已中断」。
- 快照消费走 `handle.snapshot()`；plugin 层只持有 UI 循环与渲染，不复制组装状态。
- 上下文取材接口：activeFile / 工作区快照经 workspace facade 提供（wiki index 归 m2-04）。
- 首版 📎 停用：宿主还没有文件选择对话框面，附件只走粘贴/拖拽的 inline 通道，按钮明示该限制。

## Alternatives considered

- 前端 fetch + SSE 直连 endpoint：绕开 Rust egress 层，破坏「Rust = 持久化 + egress 薄层」定论；否。
- Tauri `emit` 事件广播代替 Channel：广播制需自建流 id 过滤，有多窗口串台风险，背压与 drop 语义都不如 Channel；否。
- 块级增量 markdown 渲染（只重渲尾部未闭合块）：省 CPU 但引入「已闭合块不再重解析」的不变量管理；chat 体量下全量重解析是毫秒级，否，留作后续优化。
- durable 附件存储（内容寻址 + 跨会话重放 + offload 策略）：m2-02 会话是内存态，无重放需求，整套机制过重；否，inline 附件不落盘。
- 纯 path 或纯 inline 单源：path 覆盖不了剪贴板/拖拽，inline 让大音频文件在 JS 堆与 IPC 间翻两倍；联合类型各取所长。

## Consequences

- guard 白名单 `llm` 增 `chatStream`；`SlotName` 增 `sidebar.right`；commands.md 生成区增 `llm_chat_stream` / `llm_chat_abort`；归一错误词表增 `STREAM_CLOSED` / `UNSUPPORTED_CONTENT`。
- 欠账：`tool-call-delta` 本期无消费方；会话不持久化（重开即清）；块级增量渲染留作性能优化；远程 url 来源依赖 provider 可达性，自托管 endpoint 够不到公网时按传输错误语义报错。
