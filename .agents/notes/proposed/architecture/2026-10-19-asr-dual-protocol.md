# Agent Note: ASR 供给双协议：transcriptions 口与聊天口统一收编

Status: proposed

[English](2026-10-19-asr-dual-protocol.en.md) | 中文

## Problem

m3-01 要落地 ASR 转录，但 OpenAI 兼容 ASR 存在两种 wire 形状：转录口 `/v1/audio/transcriptions`（multipart + verbose_json 契约时间戳，Speaches/whisper.cpp 系）与聊天口 `chat/completions` + `input_audio`（小米 MiMo ASR 等，无契约时间戳）。同时要求：不配 ASR 时 agent 零变化；聊天模型（如 deepseek-v4-flash）不被转录误用。

## Decision

- ASR 模型独立成户：只在 `kind: asr` 的 endpoint 上配置，新增可选 `protocol` 字段（`transcriptions` 缺省 / `chat`）；聊天路由只认 kind=chat、转录路由只认 kind=asr，结构性隔离。
- 双协议统一返回 `TranscriptionResult { text, segments[] }`；chat 路无契约时间戳，由 TS 工具层按确定性规则（匹配行 ≥3 且覆盖 ≥80%）解析，失败降级单段 + `timestamps: none`。
- `transcribe` 工具按回合动态挂载：无 asr endpoint 时工具不进入声明清单，agent 行为零变化。
- 上传动作单列审批族 `transcribe`，一次审批同时覆盖上传与落盘。
- 客户端不做解码/分片/转码（ffmpeg 与环境无关性冲突）；视频容器原样上传，依赖服务端解码。

## Alternatives considered

- 借用 chat endpoint 的 audio 能力模型做 ASR：模糊聊天天职、模型清单互相污染；否。
- 只支持 transcriptions 口：MiMo ASR 等聊天口模型不可用；否。
- 无 ASR 时仍挂载工具并返回引导：模型空转一轮才能说出"请去配置"；由设置面板与文档承担引导，否。
- 客户端 ffmpeg 分片：违反环境无关性硬约束；否，本期超限明确报错。

## Consequences

- settings.json 兼容：protocol 为可缺省字段，版本号不动。
- chat 路 input_audio 采用 MiMo 文档形（data 为 data URL + format 双带），与仓内聊天附件的 raw base64 形不同——附件路不变。
- 审批前的大小探测走轻量 `file_size`（只 stat，不算哈希）；审批卡展示 endpoint 名称、模型与协议，批准后的上传绑定同一个 target。
- m3-03 的 raw 索引、m3-04 的本地 ASR 辅助不受本期约束。
