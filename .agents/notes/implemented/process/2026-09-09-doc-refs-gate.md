# Agent Note: 源码文档引用防腐门禁

Status: implemented

[English](2026-09-09-doc-refs-gate.en.md) | 中文

## Problem

对照蓝本十步流水线复盘门禁差距（同源复盘见 [2026-09-09-md-wrap-gate.md](2026-09-09-md-wrap-gate.md)），发现 verify-doc-refs 一叶缺位：本库源码注释密度高，契约 home 指针（「契约见 docs/i18n/README.md」）与运行时目标路径（`gen-commands-catalog` 的写入路径）散布在三类源码里，但文档改名/删除后没有任何门禁会对账源码侧——指针腐烂数月无人察觉，恰好打击的是文档工程的可导航性支柱。

## Decision

- 新增 verify-doc-refs 叶子，进 doc-quick/doc-sync/release 三档（读盘即可判，属快速档）。扫描面：scripts/*.mjs（排除 *.spec.mjs——夹具全是合成路径）、src/**/*.ts、src-tauri/src/**/*.rs；全文匹配不区分注释与字符串——运行时路径同样会腐烂；路径字符类含 `\p{L}\p{N}`（note 命名开放中文主题，ASCII 类会静默漏检）。
- 示例口径与其余链接门禁一致：行内代码与围栏里的路径不算数。围栏判定新造源码口径 FENCE_IN_COMMENT_RE——剥掉 `//`、`#`、`*` 单行注释前缀再判围栏标记；markdown 文档口径的 FENCE_OPEN_RE 认不出「`// ```md`」形态，TDD 夹具先撞出这一缺口再补实现。
- 语料修补一处：archive-agent-note.mjs 用法示例的合成路径未裹行内代码，被新门禁当真引用（如实红），按示例惯例修补。
- 接线：ci-wiring 防误删清单新增 verify-doc-refs（删叶即红）；docs/AGENTS.md 的 lint:docs 注释枚举补「源码引用」。spec 六例背书（共 98 例）。

## Alternatives considered

- 只扫注释不扫字符串：否——verify-doc-index、gen-commands-catalog 的校验/写入目标就是字符串字面量，只扫注释会漏掉运行时腐烂。
- 排除 *.spec.mjs 改为白名单逐条登记：否——夹具本来就满是合成路径，按扩展名整类排除一次到位，白名单会随 spec 增长滚动登记。
- 扫描面扩到 .github/workflows 与 docs 自身：否——前者不是文档工程契约的 home，后者死链已由 verify-md-links 管辖，边界写进脚本头注释。

## Consequences

- 上线即绿（一处示例口径修补）；源码注释与运行时路径从此和文档树机械对账，文档改名/删除漏改源码即红。
- verify-doc-refs.mjs 自身也在扫描面：头注释引用的契约与规则文档必须真实存在，正则源文本不匹配自身（`\/` 转义形态），自指安全。
- 围栏口径从此双定义（markdown 文档 FENCE_OPEN_RE / 源码注释 FENCE_IN_COMMENT_RE）：两个域的围栏形态确实不同，不强行共用；若第三种形态出现须同步修订。
- 三类源码根之外的新目录（如未来加 src-tauri/tests）不自动进扫描面，加根时须记得扩 SCAN_SPEC——这是刻意声明的边界，不是自动发现。
