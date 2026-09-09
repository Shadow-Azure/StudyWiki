# Agent Note: 预算数字单一 home（地图表词数列删除）

Status: implemented

[English](2026-09-09-budget-map-single-home.en.md) | 中文

## Problem

[md-wrap-gate](2026-09-09-md-wrap-gate.md) 在 Alternatives/Consequences 登记的欠账：docs/README.md 地图表的「预算（词）」列与 scripts/doc-budgets.manifest.json 构成双 home——门禁只读 manifest，表格数字纯靠人眼同步，2026-09-08 上调预算时漂移 5 处才被人眼发现。蓝本 dsh 的同型复述（其 docs/AGENTS.md 散文 Targets 句）至今仍列着已删除的 examples/AGENTS.md 310，同样没有任何门禁会红。docs/README.md 的散文早已宣称「本表只做索引」，表格却保留数字列，文档自相矛盾。

## Decision

- 删除地图表「预算（词）」列，中英两侧同删，最小修补英文侧后重录。词数预算唯一 home 即 manifest，散文既有指引句（「词数预算由 manifest 执行……本表只做索引」）已如实，无需改动。
- 就地重写两条已失真的活文档事实：[md-wrap-gate](2026-09-09-md-wrap-gate.md) 与 [budgets-reverse-wiring](2026-09-09-budgets-reverse-wiring.md) 的 Consequences 中「双 home 欠账仍在/仍待根治」改为现状并链到本 note。

## Alternatives considered

- 同步门禁（解析表格列与 manifest 对拍，数字不等即红）：约 30 行可行，但它是一台永久机器，保护一个不该存在的冗余——与「一个事实一个 home」（docs/AGENTS.md 层级表）反着走；预算反向对账（budgets-reverse-wiring）选择的正是逼登记进唯一 home，而非维护两份清单的同步。
- 学 gen:commands 把预算列做成生成区：手写职责列 + 生成数字列的混合表格做标记区很别扭，为几个数字引入 gen/verify 成对脚本不成比例。
- 保留数字列靠人眼同步：本库漂过一次、蓝本正漂着，已验证必漂移。

## Consequences

- 此后调预算只改 manifest 一处；docs/README.md 词数下降，预算 570 不动（远离上限）。
- 读者失去打开 README 一眼看到各文档体量的视图，需要数字时读 manifest（本库 verify-doc-budgets 无 `--list`；蓝本有，未来想要可顺手补）。
