# raw 落盘与索引

[English](m3-03-raw-index.en.md) | 中文

```yaml flow
kind: issue
milestone: m3
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - src-tauri/**
  - docs/architecture.*
  - docs/commands.*
adr: []
github:
  number: 34
  url: https://github.com/Shadow-Azure/StudyWiki/issues/34
```

## 背景

raw 镜像目录只放 markdown 与图片；机器索引记录「源 → 产物」映射、md5 与时间戳，供后续回查。

## 目标

- `.study-wiki/raw/<源相对路径去扩展名>/` 目录布局。
- `.study-wiki/index.md`（yaml 围栏）记录映射 + md5 + 时间戳。

## 验收

- 源 `./xxxx/yyy/zzzz.mp4` 映射到 `.study-wiki/raw/xxxx/yyy/zzzz/`，仅含 markdown 与图片。
- index.md 的机读字段可校验 md5 与时间戳映射。
