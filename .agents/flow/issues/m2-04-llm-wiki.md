# llm-wiki 知识层

[English](m2-04-llm-wiki.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - .agents/flow/issues/m2-04-llm-wiki.*
  - .agents/flow/issues/m3-03-raw-index.*
  - plans/2026-10-18-llm-wiki-*.md
  - walkthrough/assets/m2-04-llm-wiki/**
  - src/plugins/**
  - src/host/**
  - src/loader/**
  - src-tauri/**
  - tests/**
  - docs/architecture.*
  - docs/commands.*
  - package.json
  - pnpm-lock.yaml
  - scripts/code-map.manifest.json
  - scripts/dep-allowlist.json
  - walkthrough/files/**
  - walkthrough/features/**
  - walkthrough/changes/**
  - .agents/notes/**
adr:
  - ../../notes/implemented/architecture/2026-10-18-llm-wiki.md
github:
  number: 31
  url: https://github.com/Shadow-Azure/StudyWiki/issues/31
```

## 背景

llm-wiki 是构建在 agent 上的编译式知识层（raw 不可变 + wiki 由 LLM 维护 + schema），是知识复利的关键能力。

## 目标

- schema v1 归 `app-wiki` 插件，经 agent prompt 贡献缝注入。
- `.study-wiki/llm-wiki/` 由 agent 用通用文件工具维护；`.study-wiki/index.yaml` 由程序独占物化。
- 文本源 ingest/query/lint 闭环；视频源仅提示等待 m3 转录。

## 验收

- agent 更新 wiki 页面并追加 log，不手改机器索引；query 先读 `llm-wiki/index.md`；lint 按 schema 查矛盾、孤儿与缺口。
- `index.yaml` 记录源路径、kind、SHA-256 内容哈希、size、分析时间与 artifact，并由现存产物证据确定性重建。
- `probe_source_file` 提供授权内 size/mtime/SHA-256；状态判定按同路径、同内容哈希、unknown 的顺序输出 fresh/stale/moved/unknown。
- moved 在 prompt 上下文构建时直接重指索引行；写文本文件自动创建父目录。
- Windows/POSIX 文件树路径统一规范化，索引 path、sources page 与活动源状态在三种桌面平台语义一致。
