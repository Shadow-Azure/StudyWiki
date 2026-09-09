# Agent Note: 段落一行门禁与预算登记补全

Status: implemented

[English](2026-09-09-md-wrap-gate.en.md) | 中文

## Problem

对照蓝本 verify-md-wrap 复盘门禁差距（同源复盘见 [2026-09-08-note-structure-gate.md](2026-09-08-note-structure-gate.md)），发现三处残留：docs/AGENTS.md 写作规则「段落一行到底」是无红脚本的软要求，硬换行段没有任何门禁会红，而它恰恰污染 translation-pairing 的最小修补 diff 与结构签名；.agents/notes/README.md 是常驻规则文档却不在 doc-budgets 清单（门禁只查 manifest 内条目，未登记即免检）；docs/README.md 地图表词数列有 5 处与 manifest 脱节（2026-09-08 上调预算未同步），现状文档失真。

## Decision

- 新增 verify-md-wrap 叶子，进 doc-quick/doc-sync/release 三档（蓝本定位 quick）：手写行扫描不引 mdast 依赖，围栏/生成区标记复用 translation-pairing-lib 唯一定义并新导出 REGION_BEGIN/REGION_END/FENCE_OPEN_RE；散文段跨物理行即红、报起始行、一段一次，列表项折行与引用内段落同理；扫描面 = 根 README 双侧 + AGENTS.md + docs/** + .agents/notes/**（中英两侧都查），archived/ 冻结件豁免（sha256 封存，改须解封），CLAUDE.md 是 AGENTS.md 的 symlink 不单列。spec 五例背书（共 92 例）。
- docs/AGENTS.md 该条规则尾接「红门禁：verify-md-wrap」，门禁 sh 注释枚举补「段落换行」。
- 预算三笔：.agents/notes/README.md 登记 980（现词数 968）；docs/AGENTS.md 670→690（规则接线新增常驻内容）；docs/README.md 地图表 5 处词数对齐 manifest 并重录配对。

## Alternatives considered

- 引 mdast 走 AST 对齐蓝本：否——本库门禁一律手写结构扫描零依赖，且行扫描语义已覆盖蓝本核心（段落跨行、列表折行、引用内段落），语料结构简单足够。
- 缩进 4 空格代码块按代码豁免：否——本库代码示例一律走围栏（写作规则），出现缩进代码块本身就是风格漂移，值得被看见；边界在脚本头注释声明。
- 把词数列从 docs/README.md 地图表删掉（预算唯一 home 是 manifest，双 home 必再漂移）：方向对但超出本次改动面，本次先对齐数字，欠账见 Consequences。

## Consequences

- 存量语料零硬换行，门禁上线即全绿，无迁移成本；i18n 哈希仅 docs/README.md 一对重录。
- ci-wiring 防误删清单新增 verify-md-wrap，删叶即红。
- 若未来引入 YAML frontmatter 或缩进代码块风格，扫描语义须同步修订（现行边界见脚本头注释）。
- 地图表词数列与 manifest 的双 home 欠账仍在：下次调预算若再漏同步只能靠人眼，根治须删列，另立 note。
