# 开发流程门禁落地

[English](m0-01-dev-flow-gates.en.md) | 中文

```yaml flow
kind: issue
milestone: m0
priority: P0
status: done
scope:
  - scripts/**
  - .agents/flow/**
  - .agents/notes/**
  - .github/**
  - package.json
  - AGENTS.md
  - docs/development.*
  - docs/AGENTS.md
  - docs/i18n/README.*
  - docs/environment-independence.*
adr:
  - ../../notes/implemented/process/2026-09-19-dev-flow-gates.md
github:
  number: 24
  url: https://github.com/Shadow-Azure/StudyWiki/issues/24
```

## 背景

临时起意的开发没有流程约束，需求散落在对话里无法沉淀。需要 roadmap → milestone → issue → ADR 的机械门禁，约束"先立 issue、在 milestone 内、按优先级推进"。

## 目标

- 流程工作文件与契约进 `.agents/flow/`（三件套）。
- verify-flow 离线门禁进 doc-quick / doc-sync / release；--diff 模式与在线 lane 进 CI。
- commit-msg 钩子进 install:hooks。
- flow:sync 与 flow:new-issue 配套工具。

## 验收

- `pnpm verify:flow` 绿；`pnpm verify:docs`、`pnpm test` 绿。
- 流程树包含 roadmap、m0–m4 milestone 与本 issue；原型诉求拆进 m1–m4。
- 编号已回填（#24），bootstrap 标记随之移除；PR 标题带 `(#24)` 引用。
