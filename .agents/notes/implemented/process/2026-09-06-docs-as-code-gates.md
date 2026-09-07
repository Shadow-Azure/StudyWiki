# Agent Note: docs-as-code 门禁体系

Status: implemented

[English](2026-09-06-docs-as-code-gates.en.md) | 中文

## Problem

工程初期没有文档维护纪律，知识会随代码漂移腐化。需要一个与体量匹配、可随体量生长的机制，核心原则来自蓝本（deepseek-harness）："每条一致性要求背后站一个会红的脚本，人只做判断"。

## Decision

落地门禁叶子 + 调度器（零依赖 node 脚本，`scripts/run-gates.mjs`），当前九叶：

- `verify-agent-notes`：lifecycle × class 封闭集合、前三行格式、Status 与文件夹互检、互引链接可达（.en.md 侧由配对门禁管辖）。
- `verify-doc-index`：`docs/**/*.md`（postmortem 事故件与 `.en.md` 侧除外）必须登记进 `docs/README.md` 地图表。
- `verify-doc-budgets`：常驻文档词数上限（manifest 登记，只挂 base 侧），超限红。
- `verify-md-links`：docs 与 Note 内相对链接可达。
- `verify-env-independence`：环境无关约束的源/配置/产物检查。
- `verify-translation-pairing`：双语三件套（hash + 结构签名 + 切换行 + 链接 locale + 生成区）。
- `verify-type-equiv`：type-equiv 围栏与源码逐字等价，manifest 1:1。
- `doc-typecheck`：普通 ts 围栏真实编译。
- `verify-commands-catalog`：命令目录生成区新鲜度（gen --check）。

分档组合：`doc-quick`（秒级）与 `doc-sync`（全量）与 `release`；CI 静态 lane 内嵌 doc-sync，杜绝"CI 忘配"。初始化时曾按单语小库假设裁剪双语/type-equiv/生成目录，2026-09-07 恢复（决策与方向见 [2026-09-07-restore-docs-pipeline.md](2026-09-07-restore-docs-pipeline.md)）。VitePress 投影站仍缓建。

## Alternatives considered

- **只写约定不设门禁**：约定必然漂移，蓝本已证明机械化是唯一能长期维持一致性的路径。
- **用现成工具（markdownlint / vale）**：可作未来补充，但不覆盖"索引登记""Note 状态机"这类项目特定不变量。

## Consequences

- 新增文档类型时须同步改 `verify-doc-index` 的例外清单与 `docs/README.md`。
- 门禁脚本自身是 Rust+TS 之外的第三种语言，保持零依赖 node 以免污染约束（构建工具可以依赖环境，产物不可以——边界见 [docs/environment-independence.md](../../../../docs/environment-independence.md)）。type-equiv/doc-typecheck 例外借用已有的 typescript devDep。
- 文档规模触发 `docs/README.md` 所列恢复条件（如需要发布站）时，须以新 Agent Note 记录并恢复对应机制。
