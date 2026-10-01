# agent 宿主能力

[English](m2-02-agent-host.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - src/host/**
  - src/plugins/**
  - src/ui/**
  - src/loader/**
  - src-tauri/**
  - src/styles.css
  - tests/**
  - package.json
  - .agents/notes/**
  - .agents/plans/**
  - scripts/code-map.manifest.json
  - scripts/doc-budgets.manifest.json
  - scripts/dep-allowlist.json
  - docs/architecture.*
  - docs/commands.*
  - docs/plugins/*
adr:
  - ../../notes/proposed/architecture/2026-10-01-agent-host-streaming.md
github:
  number: 29
  url: https://github.com/Shadow-Azure/StudyWiki/issues/29
```

## 背景

外置插件接入 AI agent 需要宿主提供推理、chat UI 槽位与上下文取材接口；现宿主只有文件/窗口/工作区/插件服务，缺 agent 面。

## 目标

- 宿主推理服务（走可配置 endpoint，OpenAI 兼容）。
- chat UI 槽位与上下文取材接口（读活动文件、raw、wiki index）。

## 验收

- 外置插件可经宿主服务发起推理、渲染 chat、读取上下文，不触达 `@tauri-apps/*`。
- `pnpm verify:layering`、`pnpm verify:env-independence` 绿。

落地记录（2026-10-01）：

- 链路：外置插件经 guard 白名单调用 `ctx.llm.chatStream`；host `src/host/llm-stream.ts` 持有 FIFO 队列与 chunk→message 组装，消费端只读 `ChatStreamHandle.snapshot()`；Rust 手写 SSE 解析后经 `ipc::Channel` 推送，`llm_chat_abort` 显式置停，send 失败兜底。
- 命令与错误：命令生成区登记 `llm_chat_stream` / `llm_chat_abort`；`llm` 外置面为 `listEndpoints`/`probe`/`chat`/`chatStream`；错误词表新增 `STREAM_CLOSED` / `UNSUPPORTED_CONTENT`。
- UI：`sidebar.right` 作为第四个槽位注册 `app-chat`，支持 rAF 流式 Markdown/reasoning、停止、失败重试、模型选择；粘贴/拖拽 image/audio 转 inline；llm-settings 新增 audio 能力勾选。
- 附件与上下文：媒体 source 联合 path（Rust 出口读盘转 base64）/inline（不落盘）/url（透传 provider）；workspace facade 暴露 activeFile/events/openFile/guardSwitch，chat 显示活动文件名，wiki index 留给 m2-04。首版 📎 因宿主尚无文件对话框缝而停用。
- 门禁：`vitest run` 63 个文件 / 461 例全绿；`cargo test` 76/76 全绿；`verify:layering` / `verify:env-independence` / `verify:dep-audit` / `verify:flow` / `verify:commands` 全绿；issue 重录后再跑 `lint:docs` 与 `verify:docs` 确认。
