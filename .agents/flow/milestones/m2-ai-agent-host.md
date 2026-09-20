# M2 AI agent 宿主

[English](m2-ai-agent-host.en.md) | 中文

```yaml flow
kind: milestone
id: m2
title: AI agent 宿主
status: planned
github:
  number: 3
  url: https://github.com/Shadow-Azure/StudyWiki/milestone/3
```

## 目标

外置插件接入 AI agent 的宿主能力与一个基础 agent 插件：多轮对话、read/grep/write/edit 工具，以及 llm-wiki 编译式知识层（完整复利）。

## 前置定论

模型供给 = 用户可配置的远程 endpoint（含自托管闭环），已定论并登记豁免，见 [AI 推理供给 ADR](../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md)。

## 验收

- agent 插件只经宿主服务触达系统能力。
- 多轮对话、read/grep/write/edit 与笔记落盘可用。
- llm-wiki 的 index/log/concepts 随 ingest/query/lint 自动维护。

## Issues

- [模型供给定论与推理服务](../issues/m2-01-ai-inference-supply.md)
- [agent 宿主能力](../issues/m2-02-agent-host.md)
- [基础 agent 插件](../issues/m2-03-basic-agent.md)
- [llm-wiki 知识层](../issues/m2-04-llm-wiki.md)
