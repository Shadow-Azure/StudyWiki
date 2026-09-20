# llm-wiki 知识层

[English](m2-04-llm-wiki.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - docs/architecture.*
  - .agents/notes/**
adr: []
github:
  number: 31
  url: https://github.com/Shadow-Azure/StudyWiki/issues/31
```

## 背景

llm-wiki 是构建在 agent 上的编译式知识层（raw 不可变 + wiki 由 LLM 维护 + schema），是知识复利的关键能力。

## 目标

- `.study-wiki/wiki/` 结构：index/log/overview/concepts/entities/sources。
- ingest/query/lint 工作流 + schema 契约。

## 验收

- ingest 更新 index 与相关页并追加 log；query 先读 index；lint 查矛盾/孤儿/缺口。
