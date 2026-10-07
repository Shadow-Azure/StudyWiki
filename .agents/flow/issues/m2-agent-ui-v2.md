# Agent 面板交互 v2：过程折叠与审批接管输入区

[English](m2-agent-ui-v2.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P1
status: ready
scope:
  - .agents/flow/issues/m2-agent-ui-v2.*
  - .agents/notes/implemented/feature/2026-10-07-agent-ui-v2.*
  - docs/architecture.*
  - scripts/code-map.manifest.json
  - src/plugins/app-agent/**
  - src/styles.css
  - tests/app-agent*.ts
  - plans/2026-10-07-agent-ui-*.md
  - plans/agent-ui-preview-v2.html
adr:
  - ../../notes/implemented/feature/2026-10-07-agent-ui-v2.md
github:
  number: 52
  url: https://github.com/Shadow-Azure/StudyWiki/issues/52
```

## 背景

agent 面板当前把全部工具调用平铺在 transcript，头部堆叠会话/模式/模型配置，审批以大卡片插入对话流。实测（MiniMax 真实回合）确认信息噪声淹没结论、审批视觉弱、控件归属混乱。交互定稿见 plans/2026-10-07-agent-ui-dsh.md（dsh 回合折叠 + codex/claude 审批接管输入区）。

## 目标

- 工具调用按回合折叠：运行中显示当前动作，回合结束自动收为一条摘要，可展开时间线。
- 审批接管 composer：输入区切换审批态（摘要 + 查看详情浮层 + 批准/拒绝 + 快捷键），决策后原地降级并恢复草稿；多个审批排队。
- header 单行化：标题 + 新建/历史/更多；历史浮层可搜索；模型选择移入 composer 座位并按厂商分组。
- 错误改为可关闭 toast；附件禁用态改 hint；composer 增加状态行。

## 验收

- tests/app-agent-render.test.ts、tests/app-agent.test.ts 覆盖过程组折叠、决策行、审批接管/浮层/排队/草稿恢复、历史搜索、模型分组、toast。
- pnpm test、verify:layering、route:gates 全绿。
- 视觉与 plans/agent-ui-preview-v2.html 定稿一致（token 不新增）。

- <待补>
