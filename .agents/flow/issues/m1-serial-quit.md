# 多窗口串行退出状态机

[English](m1-serial-quit.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P2
status: backlog
scope:
  - .agents/flow/issues/m1-serial-quit.*
  - .agents/flow/milestones/m1-prototype-shell.*
  - src-tauri/src/**
  - tests/**
  - docs/architecture.*
  - docs/commands.*
  - scripts/code-map.manifest.json
  - .agents/notes/**
adr: []
github:
  number: 47
  url: https://github.com/Shadow-Azure/StudyWiki/issues/47
```

## 背景

PR #46 修复 macOS 原生关窗 / 退出绕过前端守卫的问题后，`Cmd+Q` 的跨窗编排仍有两个缺口：`terminate:` hook 对所有已武装窗口**并发** eval，确认框同时弹出，先确认的窗口先销毁且不可挽回；未武装窗口（如欢迎态第二窗）不在关闭名单里，全部确认后应用仍挂在剩余窗口上，需再按一次 `Cmd+Q`。产品明确不做自动保存（见 plugin-architecture Note），大量未保存窗口是正常状态，退出编排必须可靠收口。

## 目标

- `Cmd+Q` 逐窗**串行**确认：窗口 1 确认放弃并销毁后才轮到窗口 2。
- 任一窗口取消：退出流程立即停止，**聚焦该窗口**，后续窗口不再询问。
- 未武装窗口进入关闭队列收尾；全队列完成后应用正常退出，覆盖混合 armed/unarmed 场景。
- 退出会话状态机明确竞态语义：会话中重复 `Cmd+Q`、单窗红点与退出会话并发、等待确认时窗口被其它途径销毁，行为可预期且幂等。
- 支撑大量未保存窗口的队列处理。

## 验收

- Rust 状态机单测钉住：建队、逐窗推进、取消停止 + 聚焦调用、未武装收尾、重复退出与窗口中途销毁的幂等语义。
- 前端桥区分退出会话与单窗关闭；取消回执路径有测试覆盖。
- 新增回执命令进 commands 生成区；owning Note 三件套记录退出编排决策与竞态取舍。
- macOS 人工验收：多窗口混合 armed/unarmed 下 `Cmd+Q` 逐窗串行、取消聚焦、全确认后应用退出、未武装窗口被收尾。
