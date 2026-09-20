# Agent Note: 开发流程门禁（roadmap → milestone → issue → ADR）

Status: implemented

[English](2026-09-19-dev-flow-gates.en.md) | 中文

## Problem

临时起意的开发没有流程约束：需求散落在对话里无法沉淀，改动没有任务边界，阶段目标没有承诺面。需要一套 roadmap → milestone → issue → ADR 的流程，并且像文档工程一样由门禁机械执行——临时想开发的东西必须立在当前 milestone 内、优先级够格，才能动工与合入。

## Decision

- 三层工作文件住 [.agents/flow/](../../../flow/README.md)：`roadmap.md`（愿景 + milestone 有序序列）+ `milestones/` + `issues/`，契约 home 是 `.agents/flow/README.md`。ADR 层复用 Agent Notes，issue 以 `adr` 字段关联，不另起平行体系。
- 机读字段放 yaml flow 围栏：配对门禁要求围栏两侧逐字节一致，机读面天然不漂移；围栏内是 yaml 子集（实现见 `scripts/flow-lib.mjs`）。
- issue 编号耦合 GitHub issue 编号（提交与 PR 标题用 `(#N)` 引用）；允许 `github.number: null` 的 draft 过渡态（仅 backlog）；`bootstrap: true` 是自举豁免，全库至多一个且限第一个 milestone。
- 优先级推进：跨 milestone 同档串行；档内并行不限；最高未清档仅剩 1 个未 done 时下一档解锁。规则约束 in-progress / done 资格。
- 无豁免通道：机械修复同样挂 issue。
- 门禁分三层：`verify-flow`（离线状态机，进 doc-quick/doc-sync/release）、`verify-flow --diff <base>`（CI on PR：commit/PR 标题引用 + 被引 issue 状态（按 base 评估——收口提交把 issue 翻成 done，其自身必须仍能挂引用，否则 issue 永远无法经 PR 关闭）+ scope 覆盖；base 无 roadmap 时跳过，流程自举前的 PR 不绑人）、`verify-flow-online`（CI 在线 lane：与 GitHub 双侧一致，只校验不修改）。本地 commit-msg 钩子是提醒级。
- 配套工具：`pnpm flow:sync`（流程树 → GitHub 的唯一写入口，回填编号并重录配对记录）、`pnpm flow:new-issue`（三件套脚手架）。
- flow 语料纳入双语三件套；roadmap / README / milestones 登记词数预算，issue 不登记（工作文件随讨论膨胀，预算是常驻文档的约束）。

## Alternatives considered

- GitHub 原生（Projects/Milestones/Issues）为唯一事实源：本地门禁依赖网络与 gh，违背"门禁离线可验"；否，改为文件 home + CI 在线 lane 校验双侧一致。
- 新建 docs/adr/ 平行体系：与 Agent Notes 双轨，边界难划、理由散两处；否。
- 本地 flow-N 编号与 GitHub 解耦：多一个命名空间与映射表，commit 引用无法直接跳转 GitHub；否，耦合 + draft 过渡态已覆盖离线建单场景。
- `[flow-exempt]` 豁免标签：豁免会成为默认路径，违背强约束意图；否（用户明确砍掉）。

## Consequences

- `flow:sync` 与在线 lane 以 gh 已登录为前提；真机首跑已回填 milestone m0–m4 → #1–#5、issue #24 / #25，首个 PR #26 挂 m0-01 + milestone + project。
- 首跑暴露的两处实现缺陷已修：`flow:sync` 没把 milestone 编号写回内存树（首次同步一轮跑不完）；`gh pr view --json projectItems` 给的是数组而非 `{nodes}`（真挂 project 也被判未关联）。
- 在线 lane 的 project 关联读的是用户级 Projects v2，app token 恒见空列表、区分不了"没挂"与"没权限"：配 `FLOW_TOKEN`（PAT，`project` scope）时 CI 强校验，未配则该项降级提醒、由本地 `pnpm verify:flow-online` 把关。
- 状态翻转要改两侧围栏并重录配对记录；回填场景由 flow:sync 代劳，手工流转走 record:i18n。
- AGENTS.md / docs/development.md / docs/AGENTS.md 的预算随本变更上调（门禁清单与流程惯例入列）。
- 欠账：m1–m4 的 issue 细化拆分待逐轮讨论；m2 的模型推理供给方式须在 environment-independence.md 定论后才能开工。
