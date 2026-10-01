# 修复原生关窗退出丢脏稿

[English](m1-native-close-guard.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P0
status: done
scope:
  - .agents/flow/issues/m1-native-close-guard.*
  - .agents/flow/issues/m1-serial-quit.*
  - plans/2026-09-30-pr46-review.md
  - .agents/flow/milestones/m1-prototype-shell.*
  - .agents/notes/**
  - src/host/windows.ts
  - src/bootstrap.ts
  - src-tauri/**
  - tests/**
  - docs/architecture.*
  - docs/commands.*
  - scripts/code-map.manifest.json
  - package.json
  - pnpm-lock.yaml
adr:
  - ../../notes/implemented/architecture/2026-09-29-native-close-guard.md
github:
  number: 45
  url: https://github.com/Shadow-Azure/StudyWiki/issues/45
```

## 背景

macOS 原生关窗与退出路径会绕过前端 `CloseRequestedEvent.preventDefault()`，脏 Markdown / Excel 文稿会被静默丢弃；切文件与换库守卫有效，说明守卫状态机本身可用，风险集中在原生生命周期。

## 目标

- 原生关窗与应用退出统一进入主进程同步取消 + 显式销毁流程。
- 一个窗口聚合多个文档插件守卫，任一脏稿取消即不销毁；无脏稿不弹窗直接关闭。

## 验收

- 前端单测覆盖无脏、确认丢弃、取消丢弃与多守卫竞争。
- Rust 单测覆盖守卫就绪注册表；前端测试证明未就绪 / 全退订窗口不启用原生同步取消。
- `pnpm test`、`cargo test` 与相关文档 / 流程 / 分层门禁通过。
