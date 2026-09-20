# M3 ASR video processing plugin

English | [中文](m3-asr-video-plugin.md)

```yaml flow
kind: milestone
id: m3
title: ASR 视频处理插件
status: planned
github:
  number: 4
  url: https://github.com/Shadow-Azure/StudyWiki/milestone/4
```

## Goal

An external plugin turns local video/audio/other sources into llm-wiki material: ASR transcription, frame screenshots and image summaries, landing in `.study-wiki/raw/<source-relative-path-without-extension>/`, all markdown and images, with a machine index (md5 + mapping + timestamps).

## Acceptance

- ASR completes via the configurable endpoint through an agent tool, producing timestamped markdown.
- The raw mirror folder contains only markdown and images; `index.md` records mapping, md5, and timestamps.
- The whole loop runs through user-configured endpoints; a local small ASR model is an optional helper.

## Issues

- [Audio/video transcription](../issues/m3-01-asr-transcription.en.md)
- [Screenshots and image summarization](../issues/m3-02-frame-summarize.en.md)
- [Raw landing and index](../issues/m3-03-raw-index.en.md)
- [Local ASR helper](../issues/m3-04-local-asr-helper.en.md)
