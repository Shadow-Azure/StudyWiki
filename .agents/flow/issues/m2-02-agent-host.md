# agent 宿主能力

[English](m2-02-agent-host.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - src/host/**
  - src/plugins/**
  - src/loader/**
  - docs/architecture.*
  - docs/commands.*
  - docs/plugins/*
adr: []
github:
  number: 29
  url: https://github.com/Shadow-Azure/StudyWiki/issues/29
```

## 背景

外置插件接入 AI agent 需要宿主提供推理、chat UI 槽位与上下文取材接口；现宿主只有文件/窗口/工作区/插件服务，缺 agent 面。

## 目标

- 宿主推理服务（走可配置 endpoint，OpenAI 兼容）。
- chat UI 槽位与上下文取材接口（读活动文件、raw、wiki index）。

## 验收

- 外置插件可经宿主服务发起推理、渲染 chat、读取上下文，不触达 `@tauri-apps/*`。
- `pnpm verify:layering`、`pnpm verify:env-independence` 绿。
