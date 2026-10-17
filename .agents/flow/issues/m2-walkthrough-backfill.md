# Walkthrough 全量回填：文件页/功能页/变更页 + bootstrap 摘除

[English](m2-walkthrough-backfill.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - walkthrough/**
  - scripts/build-walkthrough.mjs
  - scripts/build-walkthrough.spec.mjs
  - scripts/walkthrough-lib.mjs
  - scripts/walkthrough-lib.spec.mjs
  - scripts/verify-walkthrough.mjs
  - scripts/verify-walkthrough.spec.mjs
  - scripts/walkthrough-review.mjs
  - scripts/walkthrough-review.spec.mjs
  - package.json
  - AGENTS.md
  - scripts/install-git-hooks.mjs
  - scripts/install-git-hooks.spec.mjs
  - docs/development.md
  - docs/development.en.md
  - docs/development.i18n.yaml
  - .agents/flow/issues/m2-walkthrough-backfill.*
  - .agents/flow/issues/m2-walkthrough-site.*
  - .agents/notes/implemented/process/2026-10-15-walkthrough-site.*
  - plans/2026-10-15-walkthrough-backfill.md
adr: []
github:
  number: 59
  url: https://github.com/Shadow-Azure/StudyWiki/issues/59
```

## 背景

机制骨架已随 PR #58 合入，walkthrough 当前处于 bootstrap 降级期：65 个源文件没有文件页，9 个变更页缺失，讲解行覆盖率为 0。文件页、变更页和覆盖率三档门禁只警告，回填后的讲解保鲜契约尚未真正强制。

## 目标

- 按六批完成 65 个源文件的文件页回填，优先公共出口、状态机、边界与失败处置。
- 补齐 13 个功能页与 10 个变更页，保持源码、流程 issue 与讲解内容可对账。
- 行覆盖率达到 ≥90%，必要时只登记带理由的豁免。
- 摘除 manifest 的 bootstrap 标志，三档降级门禁转全量红。

## 验收

- 全部门禁绿。
- bootstrap 摘除后，文件页、变更页与覆盖率三档由降级警告转全量红并通过。
- 功能页、文件页和变更页 diff 通过维护者扫读，讲解讲“为什么/干什么”而非复述代码。
