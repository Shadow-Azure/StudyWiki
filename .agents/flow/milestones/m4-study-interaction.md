# M4 学习交互闭环

[English](m4-study-interaction.en.md) | 中文

```yaml flow
kind: milestone
id: m4
title: 学习交互闭环
status: planned
github:
  number: 5
  url: https://github.com/Shadow-Azure/StudyWiki/milestone/5
```

## 目标

看视频时的学习闭环：提问自动携带当前时间戳，agent 结合该时间戳对应的转录与画面作答；交互写入该源目录的 AI-chat-note.md 并回填 llm-wiki。

## 验收

- 提问自动附带播放时间戳，回答基于对应转录与画面。
- 交互内容落盘到该源目录的 AI-chat-note.md，并回填 llm-wiki。

## Issues

- [时间戳上下文问答](../issues/m4-01-timestamp-qa.md)
- [交互笔记落盘](../issues/m4-02-chat-note.md)
