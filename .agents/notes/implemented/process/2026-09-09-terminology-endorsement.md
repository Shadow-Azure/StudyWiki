# Agent Note: 翻译供给链机械背书（术语表 + 提示词模板 + 门禁）

Status: implemented

[English](2026-09-09-terminology-endorsement.en.md) | 中文

## Problem

对照蓝本复盘的最后一项决策缺口：dsh 的翻译供给链有机械背书（术语表 + 翻译提示词 + 校验脚本），本库此前没有——结构层一致性（镜像/生成区/hash）已由 verify-translation-pairing 公证，但**用词层**完全靠译者自觉：同一术语两篇译成两个词（门禁 gate/checkpoint），没有任何门禁会红。用户拍板选机械背书（放弃登记豁免方案）。

## Decision

- 蓝本做减法移植：dsh 是完整 LLM 编排（prompt-v4 渲染器 + 三段响应解析器 + 双向语言），本库译者就是 agent、方向固定（中文 base → 英文侧），只取骨架——两个常驻工件 + 一叶门禁。
- `docs/i18n/terminology.md` 三件套：数据行（中文 | English | 禁用替写）是**语言中立数据，两侧逐字一致**，只本地化表头；禁用替写刻意登记不穷举——`guard` 不禁用，因 main guard（CLI 入口卫兵模式）占用该词。首批 13 条术语，禁用替写 2 条（checkpoint、sentinel、switching line——先扫语料确认零误伤才入表）。
- `docs/i18n/translation-prompt.md` 三件套：补英文侧的操作模板，围栏逐字两侧一致；三个占位符 `{{terminology}}`/`{{source_document}}`/`{{source_basename}}`。
- 新叶 `verify-terminology`（doc-quick/doc-sync/release 三档）：① 术语表数据行两侧对拍；② 禁用替写出现在英文侧活语料散文即红——围栏/行内代码/生成区不算数（示例或机器写），base 侧不查，**术语表自身豁免**（数据行本来就要写禁用词）；③ 模板围栏内占位符集合精确（已知各恰一次、未知即红）。spec 八例（TDD，含术语表自豁免与三区豁免边界）。
- 接线：i18n/README 新增「术语与提示词」契约节（预算 700→780）；docs/README 地图表登记两新文档（预算列同步 manifest，README 540→570）；ci-wiring 防误删清单加 verify-terminology；门禁头注释即 doc-refs 的校验对象。

## Alternatives considered

- 登记豁免（本 note 前我的推荐）：用户否决——机械背书与蓝本对齐，且禁用替写机制成本可控（只有确有混淆史的词才入表）。
- 完整移植 dsh 的渲染器/解析器（render request + parse 三段响应）：否——本库没有"调外部模型翻译"的运行时，翻译在 agent 会话内完成，渲染/解析层没有消费方（YAGNI）；模板作为文档工件保留，未来接外部译者时再补渲染层。
- 术语表进 i18n/README 一节而不独立成文档：否——README 已 780 词近上限，且术语表要被提示词整体引用（`{{terminology}}` = 全文），独立文件是干净的供给单元。
- 禁用替写全词大小写敏感匹配：否——英文侧术语小写为主，大小写不敏感更稳（Checkpoint/checkpoint 同罪）；全词 `\b` 边界防 guardrail→guard 误伤。

## Consequences

- 翻译供给链从"译者自觉"变"机械背书"：禁用替写登记即受门禁执行，英文侧新语料自动入网；术语表数据行两侧逐字一致由对拍保证，表内容漂移即红。
- 上线零迁移：13 条术语全部取自现行语料实际用词（gate 46 次、pairing 21 次、corpus 13 次……），禁用替写零误伤——门禁上线当场抓到本 note 英文侧散文两处裸写禁用词（解释规则时的元提及），按口径裹行内代码修复：第一批真实捕获就是作者本人。
- 新增常驻文档两件——地图表登记、预算登记、双语三件套三条约束全部当场满足（doc-index/预算反向对账/配对三道门禁验证过）。
- 禁用替写只查英文侧散文：中文侧出现英文替写词（如引用代码名）不违规；生成区（命令目录）如真出现替写属源注释问题，会先在 doc-refs/locale 层暴露，属刻意边界。
- 术语表是滚动登记工件：新术语须同 PR 补数据行（两侧一致），忘记补只是缺背书不红——「术语表该收而未收」仍靠评审。
