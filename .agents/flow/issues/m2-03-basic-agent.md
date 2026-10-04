# 基础 agent 插件

[English](m2-03-basic-agent.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - .agents/flow/issues/m2-03-basic-agent.*
  - src/plugins/**
  - src/host/**
  - src/ui/**
  - src/styles.css
  - src-tauri/**
  - tests/**
  - package.json
  - .agents/notes/**
  - scripts/code-map.manifest.json
  - scripts/doc-budgets.manifest.json
  - scripts/dep-allowlist.json
  - docs/architecture.*
  - docs/commands.*
  - docs/plugins/*
  - docs/environment-independence.*
adr:
  - ../../notes/proposed/architecture/2026-10-04-basic-agent.md
github:
  number: 30
  url: https://github.com/Shadow-Azure/StudyWiki/issues/30
```

## 背景

需要一版具备基础能力的 agent 插件（对标 pi/dsh 交集）：多轮上下文 + read/grep/write/edit + 笔记落盘。

## 目标

- 多轮会话状态机（不丢历史）。
- read/grep/write/edit 四个工具 + 笔记写入 wiki。

## 验收

- 与 agent 多轮对话可用；read/grep 能检索库与 wiki，write/edit 能落笔记。
- 会话落盘为 JSONL，历史会话可恢复加载，发送新消息后继续。
- 写操作经「请求批准 / 帮我批准」两模式审批；越授权集合的读取经审批动态授权（会话级），写入任何模式不可越界。
