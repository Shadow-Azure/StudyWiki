# Agent Note: AI 推理供给：可配置远程 endpoint + 自托管闭环

Status: proposed

[English](2026-09-19-ai-inference-supply.en.md) | 中文

## Problem

环境无关性是硬约束：发布产物运行期完全不依赖环境、不访问网络。但 m2 起的 AI agent、m3 的 ASR 与视觉总结都需要模型推理，二者直接冲突。必须现在定论供给方式并登记豁免，否则 m2/m3/m4 无法开工。

## Decision

- 主供给 = 用户显式配置的远程 endpoint：`base URL + model + key`，采用 OpenAI 兼容协议；支持自托管（vLLM / Ollama / LM Studio 等 LLM/VLM，faster-whisper-server 等 ASR），内网可闭环、信息不外泄。这是唯一联网点，登记环境无关豁免。
- LLM 与 VLM 走同一 OpenAI 兼容 `chat/completions`（多模态）；ASR 走 OpenAI 兼容 `/v1/audio/transcriptions`，作为 agent 的一个工具暴露，而非独立流程。
- 本地 ASR 小模型是可选辅助：下载并快速启动本地服务，带环境探测，P2，不纳入离线保证；其运行时形态（WASM vs 宿主原生运行时）后续单独定论。
- 产品不内置任何 API key；endpoint 配置只存用户侧。

## Alternatives considered

- 随插件安装阶段下载模型、运行离线：最贴合「运行全程离线」，但 LLM/VLM/ASR 三套权重体积大、质量受限、工程重，且本地运行时与「单文件零依赖 JS」插件契约冲突；否，仅把本地 ASR 降级保留为可选辅助。
- 纯外部 API（写死供应商）：违背环境无关性、无法内网闭环；否。
- 纯本地打包小模型：包体与质量折中不可接受；否。

## Consequences

- [environment-independence.md](../../../../docs/environment-independence.md) 登记一条豁免：AI 推理经用户显式配置的远程 endpoint。
- endpoint 配置契约（LLM/VLM/ASR 三类、base URL/model/key、探测与错误语义）在 m2-02 落地；ASR 工具在 m3-01。
- 内网闭环依赖用户自建 endpoint；客户端自身的离线能力不因此回退为「必须联网」。
