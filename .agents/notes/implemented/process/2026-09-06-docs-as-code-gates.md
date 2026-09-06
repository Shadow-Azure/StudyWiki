# Agent Note: 裁剪版 docs-as-code 门禁体系

Status: implemented

## Problem

工程初期没有文档维护纪律，知识会随代码漂移腐化；但完整照搬蓝本（deepseek-harness 的十步双语流水线）对单应用仓库是过度工程。需要一个与体量匹配、可随体量生长的机制。

## Decision

采用蓝本的核心原则——"每条一致性要求背后站一个会红的脚本，人只做判断"——落地四个门禁叶子 + 一个调度器（均为零依赖 node 脚本，`scripts/run-gates.mjs`）：

- `verify-agent-notes`：lifecycle × class 封闭集合、前三行格式、Status 与文件夹互检、互引链接可达。
- `verify-doc-index`：`docs/**/*.md`（postmortem 事故件除外）必须登记进 `docs/README.md` 地图表，图上条目必须存在。
- `verify-doc-budgets`：常驻文档词数上限（manifest 登记），超限红。
- `verify-md-links`：docs 与 Note 内相对链接可达（doc-sync 档）。

两档组合：`doc-quick`（秒级，无构建）与 `doc-sync`（全量）；CI 静态 lane 内嵌 doc-sync，杜绝"CI 忘配"。有意裁剪：双语三件套、type-equiv 围栏、生成目录、VitePress 投影站——恢复条件写在 [docs/README.md](../../../../docs/README.md) 的差异表。

## Alternatives considered

- **照搬完整蓝本**：单语小库跑不动 30 叶门禁；维护门禁的成本会超过文档本身。
- **只写约定不设门禁**：约定必然漂移，蓝本已证明机械化是唯一能长期维持一致性的路径。
- **用现成工具（markdownlint / vale）**：可作未来补充，但不覆盖"索引登记""Note 状态机"这类项目特定不变量。

## Consequences

- 新增文档类型时须同步改 `verify-doc-index` 的例外清单与 `docs/README.md`。
- 门禁脚本自身是 Rust+TS 之外的第三种语言，保持零依赖 node 以免污染约束（构建工具可以依赖环境，产物不可以——边界见 [docs/environment-independence.md](../../../../docs/environment-independence.md)）。
- 文档规模增长到触发 `docs/README.md` 所列恢复条件时，须以新 Agent Note 记录并恢复对应机制。
