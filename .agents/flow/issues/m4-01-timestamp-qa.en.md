# Timestamp-context Q&A

English | [中文](m4-01-timestamp-qa.md)

```yaml flow
kind: issue
milestone: m4
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - docs/architecture.*
  - docs/commands.*
adr: []
github:
  number: 36
  url: https://github.com/Shadow-Azure/StudyWiki/issues/36
```

## Background

Asking while watching video must carry the timestamp automatically, so the agent locates the transcript and frames and answers with more accurate context.

## Goals

- A question message automatically carries the current playback timestamp.
- Use the timestamp to fetch the corresponding transcript and frames from transcript.md / index.md and answer.

## Acceptance

- Questions carry a timestamp; answers cite the transcript/frame content of the corresponding segment.
