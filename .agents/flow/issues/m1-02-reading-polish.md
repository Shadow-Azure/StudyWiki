# 阅读体验统一

[English](m1-02-reading-polish.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P1
status: backlog
scope:
  - src/plugins/app-shell/**
  - src/plugins/view-filetree/**
  - src/plugins/doc-markdown/**
  - src/plugins/doc-video/**
  - src/plugins/doc-excel/**
  - src/styles.css
  - src/ui/**
adr: []
github:
  number: 27
  url: https://github.com/Shadow-Azure/StudyWiki/issues/27
```

## 背景

三格式查看器各自可用，但切换、空态、快捷键与视觉仍有不一致，尚未达到「用户体验不错」的原型目标。

## 目标

- 统一 markdown / excel / 视频的打开、切换、空态与键盘交互。
- 打磨视觉细节，不引入 UI 框架。

## 验收

- 三格式在同一窗口内切换一致，未打开文档与已开库未选文档的空态明确。
- `pnpm verify:layering`、`pnpm verify:env-independence` 绿。
