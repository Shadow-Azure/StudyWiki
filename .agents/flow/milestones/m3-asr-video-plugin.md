# M3 ASR 视频处理插件

[English](m3-asr-video-plugin.en.md) | 中文

```yaml flow
kind: milestone
id: m3
title: ASR 视频处理插件
status: planned
github:
  number: 4
  url: https://github.com/Shadow-Azure/StudyWiki/milestone/4
```

## 目标

外置插件把本地视频/音频/其他来源内容化为 llm-wiki 原料：ASR 转录、画面截图与图片总结，落盘 `.study-wiki/raw/<源相对路径去扩展名>/`，全部为 markdown 与图片，带机器索引（md5 + 映射 + 时间戳）。

## 验收

- ASR 经 agent 工具调用可配置 endpoint 完成转录，产物为带时间戳的 markdown。
- raw 镜像目录只含 markdown 与图片；`index.md` 记录映射、md5 与时间戳。
- 全程经用户配置 endpoint 闭环；本地 ASR 小模型为可选辅助。

## Issues

- [音视频转录](../issues/m3-01-asr-transcription.md)
- [截图与图片总结](../issues/m3-02-frame-summarize.md)
- [raw 落盘与索引](../issues/m3-03-raw-index.md)
- [本地 ASR 辅助](../issues/m3-04-local-asr-helper.md)
