# 截图与图片总结

[English](m3-02-frame-summarize.en.md) | 中文

```yaml flow
kind: issue
milestone: m3
priority: P1
status: backlog
scope:
  - src/plugins/**
  - docs/plugins/*
  - docs/architecture.*
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 33
  url: https://github.com/Shadow-Azure/StudyWiki/issues/33
```

## 背景

画面内容化是 P1 增强：关键帧截图 + 多模态总结，与对应音频段结合。

## 目标

- 按间隔抽取关键帧到 frames/。
- 用多模态 endpoint 对「图片 + 音频段文本」生成总结。

## 验收

- frames/ 有截图；summaries.md 内嵌图片并含对应总结。
