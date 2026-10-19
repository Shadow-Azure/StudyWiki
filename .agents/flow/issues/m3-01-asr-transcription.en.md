# Audio/video transcription

English | [中文](m3-01-asr-transcription.md)

```yaml flow
kind: issue
milestone: m3
priority: P0
status: in-progress
scope:
  - src/plugins/**
  - src/host/**
  - src-tauri/**
  - src/preview.ts
  - tests/**
  - docs/plugins/*
  - docs/architecture.*
  - docs/commands.*
  - plans/**
  - scripts/**
  - walkthrough/**
  - .agents/flow/**
  - .agents/notes/**
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 32
  url: https://github.com/Shadow-Azure/StudyWiki/issues/32
```

## Background

Turn local audio/video into timestamped text as raw material; ASR is integrated into the agent and goes through the configurable self-hosted endpoint.

## Goals

- An ASR tool calls the OpenAI-compatible `/v1/audio/transcriptions` to transcribe.
- The output is timestamped markdown (transcript.md).

## Acceptance

- Video/audio produces a timestamped transcript.md; a timestamp can be looked up to the corresponding text segment.
