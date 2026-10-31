# README 产品化导览与中文介绍视频

[English](m1-readme-product-tour.en.md) | 中文

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

## 背景

仓库首页偏开发说明，访客难以快速理解产品价值、看到真实工作区，也缺少可直接观看的中文导览。

## 目标

- 以真实工作区与四类连续体验重写中英 README。
- 制作约一分钟的 1080p 中文旁白介绍视频，并从首页图片进入。
- 记录媒体选型、隐私隔离与后续更新责任。

## 验收

- README 中英结构镜像、配对记录新鲜且通过文档预算与链接门禁。
- 截图来自当前 main 的隔离实例，不含用户配置；视频含中文字幕与 MiMo TTS 旁白。
- 文档门禁、完整自测试与应用构建通过。
