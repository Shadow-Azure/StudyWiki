# 模型供给定论与推理服务

[English](m2-01-ai-inference-supply.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - src-tauri/**
  - src/host/**
  - src/plugins/**
  - docs/environment-independence.*
  - docs/architecture.*
  - docs/commands.*
  - package.json
  - scripts/dep-allowlist.json
  - .agents/notes/**
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 28
  url: https://github.com/Shadow-Azure/StudyWiki/issues/28
```

## 背景

环境无关性与 AI 推理直接冲突；已定论「可配置远程 endpoint + 自托管闭环」，需落地配置契约并登记豁免。

## 目标

- 落地 LLM/VLM/ASR 三类 endpoint 配置契约（base URL / model / key）。
- 在 environment-independence.md 登记豁免并落 ADR。

## 验收

- 三类 endpoint 可配置、可探测，错误语义明确；产品不内置密钥。
- 豁免与 ADR 已登记，`pnpm verify:env-independence` 绿。
