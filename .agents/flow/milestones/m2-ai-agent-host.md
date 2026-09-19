# M2 AI agent 宿主

[English](m2-ai-agent-host.en.md) | 中文

```yaml flow
kind: milestone
id: m2
title: AI agent 宿主
status: planned
github:
  number: null
  url: null
```

## 目标

外置插件接入 AI agent 的宿主能力，以及一个具备基础功能的 agent 插件：对话、上下文取材、笔记落盘。

## 前置定论

模型推理的供给方式（本地模型 / 外部 API）与环境无关性硬约束存在张力；进入本 milestone 前必须在 [environment-independence.md](../../../docs/environment-independence.md) 定论并登记豁免或约束。

## 验收

- agent 插件只经宿主服务触达系统能力（分层纪律不破）。
- 基础对话与笔记落盘可用。

## Issues

待拆分——进入本 milestone 前逐轮讨论立项。
