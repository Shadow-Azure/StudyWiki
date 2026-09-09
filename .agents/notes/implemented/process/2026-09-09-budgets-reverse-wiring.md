# Agent Note: 预算反向对账与次级命令清单钉子

Status: implemented

[English](2026-09-09-budgets-reverse-wiring.en.md) | 中文

## Problem

对照蓝本复盘门禁差距（同源复盘见 [2026-09-09-md-wrap-gate.md](2026-09-09-md-wrap-gate.md)）发现两处元保障缺口：① verify-doc-budgets 只遍历 manifest 内条目——常驻文档不登记就完全免检，#6 的登记补全修了存量却没堵住增量漏洞（新文档落地忘登记，预算护栏静默绕过）；② ci-wiring 只反向钉根 AGENTS.md 命令清单与 package.json 的挂钩，docs/AGENTS.md、docs/development.md、根 README.md 这三个次级命令面写错 pnpm 命令（改名后忘同步、笔误）没有任何门禁会红。

## Decision

- verify-doc-budgets 新增反向对账：发现面 = 存在的 docs/**\/*.md base 侧 + 根 README.md + AGENTS.md（CLAUDE.md 是 symlink 不单列）+ .agents/notes/README.md；排除 .en.md（预算按 base 侧计）与 postmortem 事故件（冻结历史，README.md 才是常驻规则文档）；发现的常驻件不在 manifest 即红，错误消息指明登记即受检。
- 编排层补 fixture spec 六例（createGateRunner，manifest 从 cwd 读）：未登记红（docs 侧与根三件各一例）、事故件未登记绿、.en.md 不登记绿、前向两例（登记文件不存在、超限）钉住既有行为。
- ci-wiring 新增次级清单钉子：三个文档全文提取 `pnpm <token>`（字符集内提取，天然豁免中文标点与反引号），逐个对 package.json scripts 验存在；保留 install 内建豁免；每页断言至少扫到一个命令（防提取器失明）。RED 用临时篡改语料（`lint:docs`→`lint:docz`）观看后还原。
- docs/AGENTS.md 预算规则句补「常驻即须登记（未登记红门禁）」——契约与门禁同步落地（该文件单语豁免，无需配对）。

## Alternatives considered

- 反向对账放进独立叶子而不是 verify-doc-budgets 内：否——正反两向同源（一个 manifest、一套常驻定义），拆开要共享发现逻辑，合并进现有叶子最小。
- postmortem 事故件也强制登记：否——事故件是 append-only 冻结历史，登记预算会随每次事故滚动登记，且它们不受「压缩/搬层」处置约束（历史不改写）。
- 次级清单做反向完备（每个 script 必须在次级页出现）：否——完备方向唯一 home 是根 AGENTS.md 清单（ci-wiring 已钉），次级页按需引用，双向完备会逼着 docs 页长成命令镜像。

## Consequences

- 上线即绿：manifest 与语料树恰好互为镜像（#6 的存量补全此刻还成立）；从下次起新增常驻文档忘登记即在 doc-quick 红。
- 常驻定义与配对语料定义（translation-pairing 的 docs + .agents/notes + 根 README）刻意一致，仅豁免口径不同（postmortem 事故件两边都不管，archived 只有配对管）——两套发现逻辑并存，改目录结构须同步两处。
- `pnpm <token>` 提取对全文生效（含表格行内代码与散文），次级页写新命令自动入网；写非 script 命令（如未来的 `pnpm dlx`）须加豁免。
- docs/README.md 地图表只做索引，词数预算唯一 home 是 manifest——双 home 欠账已删列根治（见 [2026-09-09-budget-map-single-home.md](2026-09-09-budget-map-single-home.md)）。
