# 音视频转录

[English](m3-01-asr-transcription.en.md) | 中文

```yaml flow
kind: issue
milestone: m3
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - docs/plugins/*
  - docs/architecture.*
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 32
  url: https://github.com/Shadow-Azure/StudyWiki/issues/32
```

## 背景

把本地音视频经 ASR 转成带时间戳文本，作为 raw 原料；ASR 集成进 agent，走可配置自托管 endpoint。

## 目标

- ASR 工具调 OpenAI 兼容 `/v1/audio/transcriptions` 完成转录。
- 产物为带时间戳段的 markdown（transcript.md）。

## 验收

- 视频/音频能产出带时间戳的 transcript.md；时间戳可回查对应文本段。
