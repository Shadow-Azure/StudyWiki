# M4 Study interaction loop

English | [中文](m4-study-interaction.md)

```yaml flow
kind: milestone
id: m4
title: 学习交互闭环
status: planned
github:
  number: 5
  url: https://github.com/Shadow-Azure/StudyWiki/milestone/5
```

## Goal

The study loop while watching video: a question automatically carries the current timestamp, and the agent answers from the transcript and frames at that timestamp; the interaction is written to the source folder's AI-chat-note.md and backfilled into llm-wiki.

## Acceptance

- A question automatically carries the playback timestamp, and the answer is based on the corresponding transcript and frames.
- The interaction lands in the source folder's AI-chat-note.md and is backfilled into llm-wiki.

## Issues

- [Timestamp-context Q&A](../issues/m4-01-timestamp-qa.en.md)
- [Interaction note persistence](../issues/m4-02-chat-note.en.md)
