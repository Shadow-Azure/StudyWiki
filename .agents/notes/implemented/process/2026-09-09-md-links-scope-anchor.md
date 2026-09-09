# Agent Note: md-links 收编根文件与死锚门禁

Status: implemented

[English](2026-09-09-md-links-scope-anchor.en.md) | 中文

## Problem

对照蓝本（dsh verify-md-links）复盘暴露三处缺口：① 扫描面不含根文件——README 两侧与 AGENTS.md（每会话必读、链接全部指向 docs）的死链无门禁兜底，且与 verify-md-wrap 的扫描面不一致；② `#fragment` 从不校验——两个门禁的正则都直接丢弃 fragment，锚点链接一旦开始使用即裸奔，标题改名静默死链；③ 配对契约要求 fragment 逐字镜像，与"标题两侧各自本地化"结构性冲突——死锚门禁上线即在真实语料抓到一例：architecture.en.md 逐字复制 base 的 `#已知欠账`，而英文侧标题是 `## Known debts`。

## Decision

- verify-md-links 扫描面收编根 README.md / README.en.md / AGENTS.md（CLAUDE.md 是 AGENTS.md 的 symlink，不单列）。
- markdown 目标上的 fragment 必须命中 GitHub 风格标题 slug（重复标题占位计数 `-1`/`-2`）或显式 `<a id="…">`；纯 `#frag` 是同文件锚；query 剥离后参与解析；非 md 目标（如代码行号）的 fragment 不按锚点校验。围栏与 HTML 注释里的标题/id 是示例，不贡献锚点。
- 目标解析与锚点推导抽为纯函数进 translation-pairing-lib（parseLinkTarget / githubSlug / documentAnchors），verify-agent-notes 的互引检查复用——note 里的死锚同样红。
- 契约修订（docs/i18n/README.md 结构镜像节）：md 目标的 fragment 是标题的 locale 投影，退出结构镜像，由死锚门禁按侧校验；query 与非 md 目标的 fragment 照旧逐字镜像。normalizeLinkTarget 相应实现。
- 修复语料死锚：architecture.en.md 的 `#已知欠账` → `#known-debts`，三件套重录。

## Alternatives considered

- 引 mdast（蓝本用其遍历 API）：不引解析依赖是本库既定取舍，手写行扫描覆盖语料全部语法（verify-md-wrap 已有先例）；锚点推导与结构签名共用围栏/注释扫描定义。
- fragment 维持逐字镜像、英文侧豁免死锚校验：把结构性矛盾藏进豁免，英文侧锚点永远死；不如承认 fragment 是 locale 内容、机器按侧验"活"、等价性归评审。
- 复制蓝本行为：dsh 中文侧同样逐字复制英文 fragment（如 `core.zh.md#the-agent-handle` 指向中文标题「Agent 句柄」），同病，不跟进。
- 死锚检查只挂 doc-sync 不进 agent-notes：互引链接是 note 的正文机制，quick 档就应红。

## Consequences

- 全部锚点链接从此有门禁背书；标题改名、锚点手误会红（此前静默）。
- 配对签名不再比对 md fragment：两侧各自合法即绿，"指向同一节"的语义等价归翻译评审——诚实划界，不再假装机器在验它。
- i18n 契约页 +19 词，预算 700 → 725：契约精确化是结构性增长，整页承重、已先压缩无冗可挤。
- 外链探活仍维持缓建（站点投影落地时收编，见 2026-09-08-close-pipeline-gaps）。
