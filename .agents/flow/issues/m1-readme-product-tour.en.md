# README product tour and Chinese video introduction

English | [中文](m1-readme-product-tour.md)

```yaml flow
kind: issue
milestone: m1
priority: P2
status: in-progress
scope:
  - README.*
  - docs/assets/**
  - .agents/notes/implemented/process/2026-10-30-readme-product-tour.*
  - .agents/flow/issues/m1-readme-product-tour.*
  - walkthrough/changes/m1-readme-product-tour.yaml
adr:
  - ../../notes/implemented/process/2026-10-30-readme-product-tour.md
github:
  number: 65
  url: https://github.com/Shadow-Azure/StudyWiki/issues/65
```

## Background

The repository homepage emphasized development instructions, making the product value and real workspace hard for visitors to understand and offering no directly watchable Chinese tour.

## Goals

- Rewrite the bilingual README around the real workspace and four connected experiences.
- Produce a roughly one-minute 1080p Chinese narrated video linked from the homepage image.
- Record media choices, privacy isolation, and future update responsibilities.

## Acceptance

- The README mirrors both languages, refreshes pairing records, and passes documentation budget and link gates.
- Screenshots come from an isolated current main build without user configuration; the video includes Chinese subtitles and MiMo TTS narration.
- Documentation gates, the complete self-test suite, and the application build pass.
