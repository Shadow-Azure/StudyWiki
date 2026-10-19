# m3-01 音视频转录设计

> 状态：设计稿，待维护者审阅。本文档是 brainstorming 的产出，实施前需走完 writing-plans。Issue：m3-01-asr-transcription（#32）。

## 背景与问题

m3 要把本地音视频化为 llm-wiki 原料，第一步是 ASR 转录（#32，P0）：agent 增加转录工具，调用户配置的 OpenAI 兼容 endpoint，产出带时间戳段的 transcript.md，且"时间戳可回查对应文本段"。配置契约（`kind: asr` 的 endpoint）在 m2-01 已落地但标注"本期仅契约与探测"，本期第一次真正接通。

调研结论（2026-10-19，多来源交叉确认）：`/v1/audio/transcriptions`（multipart 上传 + Bearer + `verbose_json` 带 `segments[{start,end,text}]`）是事实标准，OpenAI/Groq/Azure/硅基流动/FunASR/whisper.cpp/Speaches（原 faster-whisper-server）同形；但小米 MiMo ASR 等新一代模型走另一种形状——聊天口 `chat/completions` + `input_audio` base64，无契约时间戳。托管服务普遍有 25MB 上限；自托管 Speaches 服务端解码、可收 mp4/mkv 原文件、无硬上限。长音频通行的客户端分片依赖 ffmpeg，与本仓环境无关性硬约束冲突，本期不做。

## 目标与非目标

目标：① agent 新增 `transcribe` 工具，产出确定性带时间戳的 transcript.md；② ASR endpoint 双协议（转录口 / 聊天口）显式可配；③ 无 ASR 配置时 agent 行为零变化；④ 上传动作纳入审批体系可追溯。

非目标：客户端音频分片/转码/抽音频（要 ffmpeg，违反环境无关性）；word 级时间戳；说话人分离；本地 ASR 小模型（m3-04）；raw 索引登记（m3-03）；截图与画面总结（m3-02）。

## 已确认决策

1. **ASR 模型独立成户**：`kind: asr` endpoint 新增可选字段 `protocol`（`transcriptions` 缺省 / `chat`）。chat 类模型（如 dpsk-v4-flash）纯聊天，路由双侧结构隔离：聊天只认 kind=chat（现有 `#route` 已强制），转录只认 kind=asr。
2. **预设仅两条可选模板**：Speaches（baseUrl `http://localhost:8000`、模型 `whisper-large-v3`、protocol=transcriptions）与小米 MiMo ASR（baseUrl `https://api.xiaomimimo.com/v1`、模型 `mimo-v2.5-asr`、protocol=chat）。模板只预填表单，不含密钥，不预置任何配置。
3. **无 ASR 不挂工具**：每回合组工具清单时现查 settings，存在至少一条带模型的 asr endpoint 才追加 `transcribe` 声明；否则模型完全不知道它存在。配置/删除 ASR 下一回合自动生效。配置引导由设置面板与文档承担（模型不会主动说"请去配置"）。
4. **歧义报错不设隐式默认**：多个 asr endpoint 且未指定 `model` 时报 `MODEL_AMBIGUOUS`，复用现有路由错误词表（MODEL_UNKNOWN/AMBIGUOUS/UNSPECIFIED）。
5. **审批单列一族**：新增审批 kind `transcribe`，卡片明示文件 + 大小 + 目标 endpoint/模型；ask 弹卡，auto 走现有 guardian。
6. **产物程序格式化**：时间戳排版由代码完成（模型抄时间戳是幻觉高发区），工具内生成 transcript.md 并经审批原子落盘；模型只收到段数/时长摘要。
7. **产物位置**：`.study-wiki/raw/<源库相对路径去扩展名>/transcript.md`（与 m3-03 目录布局约定对齐，索引登记留给 m3-03）。重复转录覆盖同路径（仍过审批）。
8. **传输原文件**：不做客户端解码；视频容器原样上传（A 路），依赖服务端解码；B 路受聊天口现实约束只接 wav/mp3 且沿用 20MB 附件上限。
9. **降级不伪造**：服务端不返回结构化时间戳（或 B 路文本解析失败）时产物降级为单段全文 + frontmatter `timestamps: none`，绝不编造时间戳。

## 配置层

`src-tauri/src/config.rs`：`Endpoint` 增加 `protocol: Option<String>`（serde 缺省 None 即 transcriptions 语义；settings 版本号不动，存量文件兼容）。校验规则（fail-loud）：protocol 只允许 `transcriptions`/`chat`；chat kind 的 endpoint 带 protocol → `INVALID_CONFIG`（显式拒绝而非静默忽略）。脱敏投影 `RedactedEndpoint` 与 wire `EndpointInput` 同步带 protocol，key 规则不变。

`src/plugins/llm-settings/`：kind 选 asr 时显示"协议"下拉（两项）；`EndpointDraft`/`validateDraft` 与 Rust 同规则；预设表由 Rust `llm_list_presets` 扩展两条 asr 模板（厂商下拉新增项），chat 预设不动。

## Rust 传输层

新增命令 `llm_transcribe(app, req)`，req = `{ endpointId, model, path, language? }`：

- 路由：按 endpointId 取 endpoint，kind 必须为 asr 否则 `INVALID_CONFIG`；path 必须位于库根内（与附件 root_check 同规则），越界 `UNAUTHORIZED_PATH`。
- **protocol=transcriptions**：ureq 手构 multipart/form-data 流式 body（字段：`file`（文件名取 basename）、`model`、`response_format=verbose_json`、`timestamp_granularities[]=segment`、可选 `language`），POST `{baseUrl}/audio/transcriptions`；独立超时 30 分钟（转录长视频分钟级，不可复用 chat 300s）。解析 verbose_json → `{ text, segments[] }`；segments 缺席/为空 → segments 置空数组由上层降级。
- **protocol=chat**：读文件（上限 20MB 与 MAX_ATTACHMENT_BYTES 同值同语义），mime 白名单 wav/mp3（复用 `audio_format` 门禁），base64 进 `input_audio`；POST `{baseUrl}/chat/completions`，非流式，复用聊天超时。messages = user 一条，content = [指令文本 + input_audio part]；指令要求逐行输出 `[HH:MM:SS] 文本`，只输出转录内容。解析 `choices[0].message.content` 为 text，segments 恒空（解析在 TS 工具层）。
- 返回统一 `TranscriptionResult { text, segments: [{ start, end, text }] }`；服务端 4xx/5xx 与网络错误按现有 LlmError 词表透传（UNAUTHORIZED/TIMEOUT/UNREACHABLE/BAD_RESPONSE 等）。

## 宿主层（src/host/llm.ts）

`LlmService` 新增：

- `transcribe(req: { path: string; language?: string; model?: string }): Promise<TranscriptionResult>`——按 model 在全部 `kind === "asr"` endpoint 中解析归属（词表 MODEL_UNSPECIFIED/UNKNOWN/AMBIGUOUS，与 `#route` 同构但方向相反），交 Rust 执行。
- `hasAsrCapability(): Promise<boolean>`——存在至少一条带模型的 asr endpoint；供 agent 每回合组工具清单。

`EndpointInput`/`RedactedEndpoint` 投影带 `protocol`；guard 外置白名单不加 transcribe（先内置独占，与 revealKey 同待遇——外置插件暴露面另行定论）。

## agent 工具层（src/plugins/agent-core）

- 第 5 个内置工具 `transcribe`，参数 `path`（必填，库根内音视频绝对路径）、`language?`（ISO 码，缺省自动检测）、`model?`（缺省路由解析）。声明不并入静态 `TOOL_DECLARATIONS`，由 service 每回合按 `hasAsrCapability()` 动态追加。
- 执行序：参数校验（扩展名白名单 mp4/mkv/mov/webm/mp3/wav/m4a/flac/ogg）→ 审批卡（kind=transcribe，预览含文件大小（经宿主 files 探测）+ endpoint 名 + 模型 + 产物落点；**一次审批同时覆盖上传与落盘**，不再叠加 write 审批）→ 调宿主 transcribe → 格式化 → 原子写落盘 → 回模型摘要（产物路径、段数、总时长、是否降级）。
- 格式化（TS 纯函数，直接可测）：B 路/A 路纯文本降级路径先做 `[HH:MM:SS] 文本` 行解析，确定性规则：匹配行 ≥3 且匹配行文本总长占原始文本 ≥80% 时采用解析结果，否则整体降级为单段。产物格式：

```markdown
---
source: courses/lecture-01.mp4
endpoint: nas-speaches
model: whisper-large-v3
language: zh
generated: 2026-10-19T22:30:00+08:00
timestamps: segment
---

# 转录：lecture-01.mp4

[00:00:00] 今天我们讲二叉树
[00:00:04] 它的定义是……
```

- 时间戳为整数秒 HH:MM:SS（与 app-wiki schema 的 `00:03:20-00:07:45` 位置格式同源）。frontmatter 的 `source` 为库相对路径，`timestamps` 取 `segment`/`none`。
- 审批体系：`ApprovalRequest.kind` 增 `"transcribe"`；approval.ts guardian 与 app-agent 渲染卡同步支持新族；审批日志照常落会话 JSONL（可追溯"哪个文件上传到了哪里"）。

## 设置 UI（src/plugins/llm-settings）

kind=asr 时出现协议下拉：「转录接口 /v1/audio/transcriptions（默认）」/「聊天接口 input_audio（MiMo ASR 等）」；厂商下拉接入两条 asr 预设；其余表单、校验、key 揭示规则不变。

## 错误与边界

- 未配置 ASR：工具不挂载，agent 行为与现状完全一致（零开销、零报错面）。
- 格式不支持/超限：B 路 20MB 与 wav/mp3 门禁在 Rust 明确报错；A 路依赖服务端 4xx 透传，工具结果如实回模型。
- 无时间戳：降级单段 + `timestamps: none`，frontmatter 明示，不假装。
- 大文件/长音频：A 路 30 分钟超时内交给服务端；超时按 TIMEOUT 透传。客户端分片本期不做（ffmpeg 冲突环境无关性）。
- 越界路径：库根外一律拒绝（UNAUTHORIZED_PATH），不走 read-outside 授权升级——transcribe 审批卡本身已是知情同意，授权面不再叠加。

## 测试策略

- Rust：config protocol 序列化/校验；multipart body 构造与字段完整性；verbose_json 解析（含 segments 缺席降级）；chat 路请求构造与响应解析；沿用 llm.rs 现有本地测试服务器模式。
- TS：`host-llm.test.ts` 同款 fake-invoke 测 transcribe 路由三错与 hasAsrCapability；`agent-tools.test.ts` 测工具执行（审批流、格式化、降级、错误透传）与**动态挂载**（有无 ASR 配置两态）；`llm-settings.test.ts` 测协议下拉与预设实例化。
- 门禁：verify:layering（插件不直接 import @tauri）、verify:dep-audit（零新增依赖）、verify:docs、verify:flow、pnpm test 全绿。

## 流程事项

- issue #32 scope 补 `src-tauri/**`（现状漏登，转录必须过 Rust），三件套重录。
- 文档：docs/plugins/agent.md 工具表 + 审批族；docs/plugins/contract.md llm 面方法清单；docs/architecture.md 命令目录与 config 字段；中英配对重录。
- Agent Note：`.agents/notes/proposed/architecture/` 新增一条（双协议 ASR 供给的取舍）。
- 状态机：开工时 #32 backlog → in_progress（flow:sync）。
