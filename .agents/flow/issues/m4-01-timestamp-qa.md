# 时间戳上下文问答

[English](m4-01-timestamp-qa.en.md) | 中文

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

## 背景

看视频时提问需自动携带时间戳，agent 据此定位转录与画面，给出更准的上下文回答。

## 目标

- 提问消息自动附带当前播放时间戳。
- 按时间戳从 transcript.md / index.md 取对应转录与画面作答。

## 验收

- 提问带时间戳；回答引用对应时间段的转录/画面内容。
