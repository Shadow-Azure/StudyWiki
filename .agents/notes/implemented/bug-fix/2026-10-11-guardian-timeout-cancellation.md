# Agent Note: Guardian 审批超时必须取消底层请求

Status: implemented

[English](2026-10-11-guardian-timeout-cancellation.en.md) | 中文

## Problem

Guardian 原实现用 `Promise.race` 等待模型响应，30 秒到期只让审批层不再等待；底层 chat promise 和可能的重试请求继续运行。这会浪费资源、延迟释放连接，并让“超时拒绝”看起来像请求已经停止，实际上没有。

## Decision

Guardian 改为共享 90 秒 review deadline，默认最多三次尝试。每次尝试都收到同一个可取消信号；deadline 到期先 abort 当前请求，再最多等 5 秒让取消传播。宿主 `chat` 在携带 signal 时通过可 abort 的流式 IPC 执行，并把结果收敛为非流式形状。解析失败和 408/429/5xx 只能在共享 deadline 内重试；超时与最终失败保持 fail-closed 拒绝。

## Alternatives considered

继续只改短超时不能取消底层调用；给非流式 IPC 新增请求注册表和 abort 命令会扩大 Rust 面，而流式通道已经有 `llm_chat_abort`。每轮重试重置 deadline 会让慢模型产生无上限等待，也偏离 Codex 的共享预算语义。

## Consequences

停止 guardian 审批后不会主动遗留新的底层请求；重试和退避共享同一预算。测试覆盖 deadline abort、重试共享 deadline、`cancelAll` abort 以及宿主 chat signal 触发 `llm_chat_abort`。guardian 专用模型、取消传播的可观测指标和后端硬取消能力仍是后续欠账。
