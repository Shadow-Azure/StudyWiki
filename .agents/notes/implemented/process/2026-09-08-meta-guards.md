# Agent Note: 门禁的门禁——自测试补全与接线自保护

Status: implemented

[English](2026-09-08-meta-guards.en.md) | 中文

## Problem

蓝本对照（dsh 文档工程十步流水线）暴露三层缺口，且没有任何**功能**叶子能兜住它们：① 复杂门禁（compiler-API 三件：export-docs / type-equiv / doc-typecheck）无自测试，回归只能靠真实语料撞出来；② CI 静态 lane、run-gates 模式数组、AGENTS.md 命令清单三处接线一旦被误删或漂移，全库静默失明——"改门禁须同步命令清单"本身是一条没有门禁背书的软性要求；③ install-merge-driver.mjs 是孤儿脚本：`.gitattributes` 引用了 `merge=studywiki-i18n`，但没有任何命令、文档或安装入口指向它，新 clone 永远装不上。

## Decision

- 自测试补齐到全叶覆盖。夹具机制：临时仓库根 + chdir 窗口同时罩住 import 与调用（门禁在 import 时锚定 cwd，`path.relative("")` 又在调用时取 cwd），公用层抽到 `scripts/spec-fixture.mjs`；CLI 型脚本（gen-commands-catalog、archive-agent-note）走子进程端到端。gen-commands-catalog 为可测导出纯函数并加 main guard，run-gates 导出 `LEAVES`/`MODES`——均为纯重构，CLI 行为不变。
- 新增 `ci-wiring.spec.mjs` 钉死接线：模式完整性（doc-quick ⊆ doc-sync、release = doc-sync + verify-release、关键叶子在列）、ci.yml / release.yml 内嵌步骤、AGENTS.md 命令清单 ↔ package.json 双向一致——门禁类 script（`verify:`/`lint:`/`gen:`/`record:`/`archive:`/`install:`/`test`）必须列进清单，软性要求从此有会红的门禁背书。
- `pnpm install:hooks` 顺带注册 merge driver：install-merge-driver 重构为导出 `registerMergeDriver()` + main guard，钩子脚本调用之；安装漏斗收拢回一条命令。

## Alternatives considered

- 所有门禁测试走子进程（而非 chdir + 动态 import）：更黑盒，但每个用例起一个 TS 编译进程，慢一个量级；vitest forks 池按文件隔离进程，chdir 窗口安全。
- 命令清单搬进 docs/development.md、AGENTS.md 只留链接：省词数，但命令清单是每会话都要用的 standing order，搬层得不偿失——改为压缩新增行注释 + 提预算（见下）。
- merge driver 内联进 install-git-hooks：驱动串两处重复；保留独立脚本、导出函数复用。

## Consequences

- `pnpm test` 从 4 个 spec 增至 12 个（70 用例）；"改门禁先动它的 spec"成为可行纪律。
- AGENTS.md 预算 600→660：命令清单结构性增长（三条门禁命令补列 + merge driver 提示），已先压缩，余量在此说明理由。docs/development.md 两侧补一句 driver 说明并重录。
- 遗留（显式登记，见 [2026-09-08-close-pipeline-gaps.md](2026-09-08-close-pipeline-gaps.md) 同轮分析）：postmortem 结构门禁推迟到首篇事故件出现时再立；站点投影整步缺席，等产品决策。
