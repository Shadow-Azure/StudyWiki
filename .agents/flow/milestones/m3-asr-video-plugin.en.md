# M3 ASR video-processing plugin

English | [中文](m3-asr-video-plugin.md)

```yaml flow
kind: milestone
id: m3
title: ASR 视频处理插件
status: planned
github:
  number: null
  url: null
```

## Goal

An external plugin turns local video/audio into llm-wiki raw material: ASR transcription, frame screenshots, and image-content summaries, persisted under `.study-wiki/raw-data/<folder named after the video's relative path>/`, with an index mapping and md5 records.

## Acceptance

- Processing produces the raw-data directory: transcripts, frame screenshots, and per image-plus-audio-segment summaries.
- An index file records the mapping between media files and artifacts, with md5 hashes.
- Fully offline: models ship with the plugin or are supplied locally; no runtime downloads.

## Issues

To be decomposed — issues are filed through discussion rounds before this milestone starts.
