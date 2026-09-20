# 本地 ASR 辅助

[English](m3-04-local-asr-helper.en.md) | 中文

```yaml flow
kind: issue
milestone: m3
priority: P2
status: backlog
scope:
  - src/plugins/**
  - src-tauri/**
  - docs/environment-independence.*
  - .agents/notes/**
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 35
  url: https://github.com/Shadow-Azure/StudyWiki/issues/35
```

## 背景

可选辅助：帮助用户下载并快速启动本地 ASR 小模型；对环境有要求，需环境探测。

## 目标

- 下载 + 启动本地 ASR 服务，带环境探测与明确失败提示。
- 运行时形态（WASM vs 宿主原生运行时）在此定论。

## 验收

- 探测到可用环境才启用；不可用时给出可操作指引；不纳入离线保证。
