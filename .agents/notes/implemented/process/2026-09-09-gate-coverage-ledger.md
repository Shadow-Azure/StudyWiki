# Agent Note: 门禁自测全叶对账与三处补漏

Status: implemented

[English](2026-09-09-gate-coverage-ledger.en.md) | 中文

## Problem

meta-guards note 宣称"自测试补齐到全叶覆盖"，但这条不变量自己没有会红的门禁背书——补漏的过程恰好证明了它会失守：verify-release（release 档的真实叶子，版本一致性是发布闸门）与 i18n-merge-driver（全库唯一自动改写配对记录的组件）都没有 spec；配对 CLI（verify-translation-pairing）的编排层——checkPair、切换行、链接 locale、语料发现——只测了纯逻辑层。补齐 spec 时立刻撞出两处真 bug：① localeViolations 用 `path.resolve` 产出**绝对路径**喂给期望仓库相对路径的 `isScopeFile`，语料判定恒假、整段 continue——链接 locale 检查自落地（PR #2）起就是死代码；② 复活后在真实语料上误报——i18n README 在行内代码里引用切换行格式原文，示例"链接"被当成真链接。

## Decision

- 新增 `scripts/gate-coverage.spec.mjs`（对账 spec）：scripts/ 下每个非 spec 脚本必须有同名 spec，或进 `COVERED_BY` 显式映射表（run-gates → ci-wiring、install-merge-driver → install-git-hooks、配对 CLI → 纯逻辑层 + CLI 编排双 spec）；映射表指向的 spec 必须真实存在，防映射表自己腐烂；spec-fixture 登记为非门禁测试基建。
- verify-release 重构为导出 `checkVersions` + main guard（纯重构，CLI 输出不变），补子进程 e2e spec：三处一致过、Cargo.toml 漂移红且报差异、`--tag` 匹配/不匹配。
- i18n-merge-driver 抽出纯函数 `decideMerge` + main guard，补四分支 spec：两侧相同、单侧未动（×2）、两侧各自重录 → 冲突交还 git。
- 配对 CLI 补 fixture spec（createGateRunner，default() 无参即全库检查）：完整三件套过、单侧改动未重录红、缺英文侧红、locale 违规红、切换行形状不精确红（重录后 hash 过账、切换行独立暴露）、豁免件携带英文侧红、行内代码与围栏内示例链接不违规。
- locale 两处修复：`path.resolve` → `path.join`（保持仓库相对，`../` 归一）；逐行清洗行内代码与围栏（行号按原文保留），示例链接与其余链接门禁口径一致。

## Alternatives considered

- 用覆盖率工具/导入分析做对账：对 .mjs 门禁脚本过重且产出难评审；"同名 spec + 显式映射表"是可读的最小机制，新增无 spec 脚本即红，映射表变更随 PR 可见。
- verify-release 走 fixture import 测 `checkVersions`：留子进程 e2e——退出码就是 CI 消费的裁决面，CLI 路径本身值得被测。
- locale 误报改成在豁免 manifest 登记 i18n/README：把检查器缺陷写进白名单，下次别处引用示例还得再登记；清洗行内代码/围栏是口径修正，一次到位。
- 死代码修复单独成 PR：补 spec 与修它暴露的 bug 是同一次"门禁的门禁"工作的因果整体，拆开反而要为死代码状态写过渡说明。

## Consequences

- "每个门禁有自测试"从此有门禁背书：新增无 spec 的脚本在 `pnpm test` 即红，meta-guards 的宣称不再悬空。
- 链接 locale 检查首次真正生效；当前语料无违规（绿），此后英文侧误用 `.md` 链接会红。
- 自测试 92 → 108 用例（16 → 20 个 spec 文件）；merge-driver 与 verify-release 变为可导出 + main guard 结构，与其余门禁一致。
- gate-coverage 的映射表是新的双宿主契约（加 CLI 包装型脚本须登记），由其存在性断言背书。
