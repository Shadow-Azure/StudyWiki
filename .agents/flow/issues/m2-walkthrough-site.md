# Walkthrough 工程讲解站：机制骨架

[English](m2-walkthrough-site.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: done
scope:
  - .agents/flow/issues/m2-walkthrough-site.*
  - walkthrough/**
  - scripts/walkthrough-lib.mjs
  - scripts/walkthrough-yaml.mjs
  - scripts/verify-walkthrough.mjs
  - scripts/build-walkthrough.mjs
  - scripts/*walkthrough*.spec.mjs
  - scripts/run-gates.mjs
  - scripts/route-gates.mjs
  - scripts/route-gates.spec.mjs
  - scripts/gate-coverage.spec.mjs
  - scripts/ci-wiring.spec.mjs
  - package.json
  - docs/AGENTS.md
  - docs/commands.md
  - AGENTS.md
  - .gitignore
  - .github/workflows/ci.yml
  - plans/2026-10-15-walkthrough-*
  - .agents/notes/**/2026-10-15-walkthrough-site.*
adr:
  - ../../notes/implemented/process/2026-10-15-walkthrough-site.md
github:
  number: 57
  url: https://github.com/Shadow-Azure/StudyWiki/issues/57
```

## 背景

AI 产出代码的速度远超维护者读码与检视速度。仓库已具备 docs-as-code 门禁与流程状态机，但缺少面向人的工程认知界面：功能散落多文件时没有聚合讲解入口，逐文件实现细节没有注解层，PR 只有 diff 而没有功能/架构/代码细节的分层叙事。调研与目标态见 plans/2026-10-15-walkthrough-design.md，本 issue 只做机制骨架，全量内容回填另行建档。

## 目标

- yaml 子集解析器（零新增依赖）与 walkthrough-lib 纯函数库：schema 校验、内容快照锚点定位、四类对账（文件页⇆code-map、功能登记、changes⇆flow issue、行覆盖率）、PR diff 检查。
- verify:walkthrough 九条门禁：静态七条（schema/锚点/文件页对账/功能对账/变更对账/行覆盖率/构建即校验）+ diff 两条（改码必改页、touches 全量对账）；骨架期 manifest 的 bootstrap 标志把文件页/变更/覆盖率三档降级为警告。
- build-walkthrough 生成器：YAML → 多页静态 HTML（总览/架构/功能/文件/变更史互链，file:// 直开；快照只用于定位，展示构建期真实代码）。
- walkthrough/ 目录契约（README）与骨架内容（overview/architecture 初稿、features 空清单、manifest）。
- 接线：pnpm walkthrough 与 pnpm verify:walkthrough 命令、run-gates/route-gates/CI 挂载、根 AGENTS.md 命令清单与 docs/AGENTS.md 层级表登记。

## 验收

- walkthrough-yaml、walkthrough-lib、verify-walkthrough、build-walkthrough 各带 vitest spec，九条门禁规则各有代表路径用例（含 Review Focus 五条钉子用例）。
- pnpm test、pnpm verify:docs、pnpm verify:flow 全绿。
- pnpm walkthrough 构建成功，产物 file:// 下总览→架构→导航互链走通。
- 文档登记完成且 verify:commands 绿。
- 骨架已随 PR #58 合入，全量回填与覆盖率达标见 walkthrough-backfill。
