# Screenshots and image summarization

English | [中文](m3-02-frame-summarize.md)

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

## Background

Frame content processing is a P1 enhancement: key-frame screenshots plus multimodal summaries, combined with the corresponding audio segment.

## Goals

- Extract key frames into frames/ at intervals.
- Use the multimodal endpoint to summarize "image + audio-segment text".

## Acceptance

- frames/ holds screenshots; summaries.md embeds the images with the corresponding summaries.
