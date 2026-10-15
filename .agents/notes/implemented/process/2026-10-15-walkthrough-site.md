# Agent Note: Walkthrough 工程讲解站

Status: implemented

[English](2026-10-15-walkthrough-site.en.md) | 中文

## Problem

AI 产出代码的速度远超维护者读码与检视速度，仓库缺少面向人的工程认知界面：功能散落多文件时没有聚合讲解入口，逐文件实现没有注解层，PR 只有 diff 没有功能/架构/代码细节的分层叙事。现有层级各管一段——docs 记现状、Agent Note 记决策、flow 记流程——但"怎么读这套代码"没有 home。

## Decision

建立 `walkthrough/` 顶层目录（中文单语，显式例外层级）：五层站点（总览/架构/功能页/文件页/变更史）双轴互链；源为 YAML，手写 yaml 子集解析器渲染成多页静态 HTML，file:// 直开。代码块用内容快照锚点只做定位，展示构建期从真实源码拉取的当前代码，代码展示层因此不可能陈旧。九条门禁保鲜：schema 封闭、锚点定位、文件页⇆code-map 对账、功能登记对账、changes⇆flow issue 对账、行覆盖率（阈值与豁免登记 walkthrough/manifest.json）、构建即校验，加 PR diff 档"改码必改页"与 touches 全量对账；PR 的讲解更新与代码在同一 PR 提交，合入即并入，不做事后合并。骨架期 manifest 的 bootstrap 标志把文件页/变更/覆盖率三档降级为警告，全量回填完成后移除转红。设计全文：plans/2026-10-15-walkthrough-design.md；调研四借鉴点：Swimm 漂移门禁语义、CodeTour pattern 内容寻址、DeepWiki 声明式页面清单、CodeRabbit PR 分层叙事与 linked-issue 对账。

## Alternatives considered

- DeepWiki 式全自动生成：官方文档说明其漏目录漏组件，讲解不可信且无人工确认状态。否。
- Swimm SaaS：私有格式 + 在线依赖，违反离线硬约束；只借鉴其门禁语义。否。
- CodeTour（VS Code 扩展）：锚点机制优秀但形态绑定 IDE、无站点聚合与 PR 叙事层。否。
- 现场生成不入库：不可复现、无确认状态，AI 速度问题原样复制到讲解层。否。
- 符号级锚点：需 TS/Rust 双语解析器，成本高；内容快照子串定位已满足抗漂移。否。
- 单文件 HTML：功能页↔文件页互链在多页结构下更自然，且避免单文件体积膨胀。否。

## Consequences

每个代码 PR 需同步维护 walkthrough 源（改码必改页由门禁强制），AI 承担生成与漂移修补、人只扫读 changes 页与文件页 diff；讲解语义质量机器判不了，是本机制的持续欠账，靠"锚点红即强制重写"与人审兜底。行覆盖率 60% 是未校准的起点，回填后按实际分布复盘。bootstrap 回填是一次性大扫读成本，按功能页分批消化。
