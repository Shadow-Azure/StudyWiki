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

外置插件把本地视频/音频转成 llm-wiki 原料：ASR 转录、画面截图、图片内容总结，落盘 `.study-wiki/raw-data/<视频相对路径同名文件夹>/`，含索引映射与 md5 记录。

## 验收

- 处理后生成 raw-data 目录：转录文本、画面截图、按图片加音频段的内容总结。
- 索引文件记录媒体文件与产物的映射及 md5。
- 全程离线：模型随插件打包或本地供给，无运行时下载。

## Issues

待拆分——进入本 milestone 前逐轮讨论立项。
