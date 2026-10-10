# 基础 agent 插件

[English](m2-03-basic-agent.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - .agents/flow/issues/m2-03-basic-agent.*
  - .agents/notes/**
  - .agents/plans/**
  - .gitignore
  - .github/workflows/ci.yml
  - docs/README.*
  - docs/architecture.*
  - docs/commands.*
  - docs/environment-independence.*
  - docs/plugins/*
  - package.json
  - pnpm-lock.yaml
  - scripts/code-map.manifest.json
  - scripts/dep-allowlist.json
  - scripts/doc-budgets.manifest.json
  - scripts/install-git-hooks.*
  - src/host/**
  - src/loader/**
  - src/plugins/**
  - src/preview.ts
  - src/styles.css
  - src-tauri/**
  - src/ui/**
  - tests/**
adr:
  - ../../notes/implemented/architecture/2026-10-04-basic-agent.md
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

## 落地记录

- 2026-10-05（CI 修复）：scope 扩 `.agents/plans/**`（实施计划文件）、`.gitignore`（sidecar 产物忽略）、`docs/README.*`（agent 插件页索引挂链）、`pnpm-lock.yaml`（@vscode/ripgrep 安装）、`src/loader/**`（模块表 +app-agent/−app-chat）、`src/preview.ts`（预览 harness 去 app-chat 引用）、`scripts/install-git-hooks.*`（pre-push 增 src-tauri rustfmt 提醒）、`.github/workflows/ci.yml`（rust lane 补 pnpm 安装——sidecar 落位依赖 node_modules）——均为实现的自然伴生面。
