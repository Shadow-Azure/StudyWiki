# 基础 agent 插件

[English](m2-03-basic-agent.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - docs/plugins/*
  - docs/architecture.*
adr: []
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
