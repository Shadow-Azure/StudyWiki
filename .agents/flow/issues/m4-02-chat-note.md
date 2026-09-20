# 交互笔记落盘

[English](m4-02-chat-note.en.md) | 中文

```yaml flow
kind: issue
milestone: m4
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - docs/architecture.*
adr: []
github:
  number: 37
  url: https://github.com/Shadow-Azure/StudyWiki/issues/37
```

## 背景

交互内容需沉淀到该源目录的 AI-chat-note.md，并回填 llm-wiki，形成知识复利。

## 目标

- 将问答追加写入 `.study-wiki/raw/<源>/AI-chat-note.md`。
- 有价值的结论回填 wiki 层并更新 index/log。

## 验收

- 交互落盘 AI-chat-note.md；回填更新 wiki index/log。
