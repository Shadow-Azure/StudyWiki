# Agent Note: Agent Note 正文骨架门禁与根 README 预算

Status: implemented

[English](2026-09-08-note-structure-gate.en.md) | 中文

## Problem

对照蓝本十步流水线再次复盘（同源复盘见 [2026-09-08-close-pipeline-gaps.md](2026-09-08-close-pipeline-gaps.md)），发现两处残留：README「文件格式」规定正文四段骨架"章节名固定"，但 verify-agent-notes 只查路径、前三行、Status 与链接，骨架是无红脚本的软要求（蓝本 verify-agent-note-format 的正文结构半边未移植）；根 README.md 是常驻门面且在双语语料内，却不在 doc-budgets 预算清单。存量语料即有例证：dynamic-asset-scope（proposed）用 `## Decision（提案）` 标段名，按"章节名固定"已违规，但没有任何门禁会红。

## Decision

- verify-agent-notes 增正文骨架检查（并入现有叶子，不新开）：剔除围栏后首个二级标题逐字 `## Problem`，Problem → Decision → Alternatives considered → Consequences 四段按序齐全（子序列），自由段只许插在骨架段之间（契约"中间可插自由的技术段"的字面执行，末段之后不许再放二级标题）。base 与 .en.md 两侧各自钉住：配对门禁的结构签名只比对标题层级不比段名，段名漂移此前无门禁可红（postmortem 门禁同例）。SKELETON 常量与 README「文件格式」互检，spec 背书。
- 存量违规就地修正：`## Decision（提案）` 与 `## Decision (proposal)` 改逐字 `## Decision`——proposed 状态已由 Status 行与文件夹承载，段名不再复述状态。
- doc-budgets.manifest.json 增 `README.md: 350`（现词数 298，留少量余量）。

## Alternatives considered

- 按 lifecycle 分化骨架（蓝本 proposed 要求 Proposal/Acceptance criteria/Risks）：更贴蓝本，但本库 README 只定义了通用四段骨架，分化须同 PR 改契约并重写全部存量 note，收益不抵；维持通用骨架。
- 移植蓝本 banned headings（implemented 禁 proposal 式标题）与 grandfather 逃生门：本库格式启用即全库合规，无前格式存量可赦；禁用标题清单是另一层裁量，暂不做。
- 新开独立门禁叶子（蓝本 classification/format 分立）：本库 classification 与前三行 format 已合并在 verify-agent-notes 一叶，正文骨架并入同叶避免 run-gates 三档与 ci-wiring 连锁改动。

## Consequences

- 写 note 的机械边界变硬：段名不可变体（后缀、括注、翻译都不行），三种 lifecycle 共用一套骨架；自由段只能插中间，要放宽须改 README 与 spec。
- .en.md 侧新增义务：骨架段名与 base 逐字相同（本就是英文专名，零翻译成本）。
- 根 README 受预算约束：扩写前先想清楚该放哪层。
