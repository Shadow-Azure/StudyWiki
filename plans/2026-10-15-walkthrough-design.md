# Walkthrough 工程讲解站设计

> 状态：设计稿，待维护者审阅。解决"AI 产出代码速度 >> 维护者读码/检视速度"的认知缺口。本文档是 brainstorming 的产出，实施前需先建 flow issue 并走 writing-plans。

## 背景与问题

维护者使用 AI 高速开发本仓，读码与检视速度成为瓶颈。需要的不是更多 diff，而是一个面向人的、可持续保鲜的工程认知界面：打开即可回答"工程做什么、架构怎么组织、某功能在哪些文件里怎么实现、为什么这么写、某 PR 改了什么"。业界对照：DeepWiki 全自动规划被官方证伪（漏目录）；Swimm 代码耦合引用 + CI 漂移门禁验证可行但叙述保鲜判不了；CodeTour pattern 内容寻址锚点抗漂移；CodeRabbit PR 分层叙事可借鉴；CodeSee 停服证明知识必须入库。

## 目标与非目标

目标：① 分层导览（总览/架构/功能/文件/变更史五层）；② 功能 → 散落代码的聚合讲解 + 逐文件注解，双轴互链；③ PR 门禁强制同步，合入即并入；④ 全离线、零运行时依赖、产物双击即开。

非目标：双语（中文单语，显式例外登记）；站内搜索；符号级锚点解析；SaaS/在线服务；运行时 LLM 问答；StudyWiki 产品功能化（纯开发辅助）。

## 已确认决策

1. 混合路线：AI 生成讲解内容为主力，人扫读确认。
2. 生成物入库受门禁管理（不做现场生成不入库）。
3. 顶层目录 `walkthrough/`，中文单语，在 docs/AGENTS.md 层级表登记例外（不进双语配对语料、不进词数预算）。
4. 一次性全量 bootstrap 回填 + 之后门禁强制增量维护。
5. 功能导览轴 + 文件注解轴双轴合并。
6. 源格式 YAML，手写生成器产多页静态 HTML（页间相对链接互跳、可回退，file:// 直开）。
7. 行覆盖率门禁纳入 v1。

## 站点结构（五层）

| 层 | 内容 | 回答的问题 |
|---|---|---|
| 总览 | 产品是什么、给谁用、最终形态（截图/示意）、站点阅读指引 | 这工程做什么的 |
| 架构 | 组成树（构建期嵌入 code-map 生成树）、分层与数据流叙事、关键决策（链 Agent Notes） | 架构是怎样的 |
| 功能页 | 每功能一页：用户可见行为 → 模块地图 → 跨文件关键片段 + 旁注 → 链决策记录 | 功能在架构下怎么实现 |
| 文件页 | 每源文件一页：文件职责（与 code-map 登记对账）→ 逐段注解（真实代码 + AI 讲解） | 这段代码干什么、起什么作用 |
| 变更史 | 每 PR 一页：功能层/架构层/代码细节层三层叙事 + touches 链主站 | 这个 PR 改了什么 |

功能页 ⇆ 文件页双向互链：功能页片段标注来源文件与行号并链到文件页对应段；文件页头部列出被哪些功能页引用。变更史页 touches 链入功能页/文件页。

## 目录布局

```
walkthrough/
  README.md               # 本层级契约：格式、门禁、写作规则（登记进 docs/AGENTS.md 层级表）
  overview.yaml           # 总览页
  architecture.yaml       # 架构叙事
  features.yaml           # 功能清单登记处：slug → 标题 + 一句话 + 关联 issue
  features/<slug>.yaml    # 功能页
  files/<镜像路径>.yaml    # 文件页：files/src/host/files.ts.yaml 镜像源码树
  changes/<issue-slug>.yaml  # PR 变更叙事，与 flow issue 对账
  manifest.json           # 行覆盖率阈值与豁免的唯一登记处
  assets/                 # 截图等静态资源（构建期复制进 dist）
  dist/                   # 构建产物（gitignored）
```

## YAML 子集与 schema

解析器手写（`scripts/walkthrough-yaml.mjs`），零新增依赖。子集在 flow 围栏子集基础上扩展：块标量 `|`、列表项 map（`- key: value` 续行缩进）、两层嵌套。候选方案 `yaml` npm 包被否：保持门禁脚本零依赖文化，避免 dep-allowlist 扩容。正文（note/body 等叙述字段）按 markdown 子集渲染，构建期用仓内既有 markdown-it（html:false 同产品安全策略）。

封闭 kind 集合与各 kind schema：

```yaml
# files/<镜像路径>.yaml
kind: file-page
source: src/host/files.ts           # 必须存在于 code-map.manifest.json
summary: 文件服务：树/读写/选目录……   # 必须与 code-map 登记处逐字一致
segments:                           # 至少一段
  - snippet: |                      # 内容快照锚点
      export class FilesService {
        constructor(private deps: FilesDeps) {}
    note: |
      服务入口。deps 可注入是本仓测试纪律……
```

```yaml
# features/<slug>.yaml
kind: feature
slug: agent-loop                    # 必须登记在 features.yaml
title: Agent 回合
behavior: |                         # 用户可见行为
modules: [src/plugins/agent-core/loop.ts, src/host/llm.ts]
steps:                              # 叙事流：跨文件片段 + 旁注
  - ref:
      file: src/plugins/agent-core/loop.ts
      snippet: |
        for await (const chunk of stream) {
    note: |
      回合的主循环……
related:
  notes: []                         # 相对 markdown 链接，死链门禁校验
```

```yaml
# changes/<issue-slug>.yaml
kind: change
issue: m2-agent-ui-v2               # 必须存在于 .agents/flow/issues/
title: Agent 面板交互 v2
functional: |                       # 功能层
architectural: |                    # 架构层（无变化写"无"）
code: |                             # 代码细节层
touches: [file:src/plugins/app-agent/render.ts, feature:agent-ui]
```

overview.yaml / architecture.yaml 为 `kind: overview|architecture` + `sections`（heading + body + 可选 images/generated 标记）；architecture 的组成树段标 `generated: code-map`，构建期嵌入生成树，与 docs 生成区同源。

## 锚点机制

内容快照锚点（CodeTour pattern 模式）：YAML 中 snippet 只用于**定位**，不用于展示。构建期在目标文件中按"逐行 trim 行尾空白后的子串匹配"定位（大小写敏感，允许片段重叠）；定位成功则渲染**源码中的当前真实代码**（带行号、链文件页），定位失败即门禁红。由此：HTML 中展示的代码永远新鲜，唯一可能陈旧的是讲解文字——其保鲜靠 diff 门禁强制执行。

## 门禁 pnpm verify:walkthrough

静态门禁（本地 + CI 静态 lane，无需 diff 上下文）：

1. **schema 封闭校验**：kind/必填字段/键集合/类型。
2. **锚点定位**：全部 snippet 可在目标文件定位，失败即红。
3. **文件页 ⇆ code-map 对账**：code-map.manifest.json 登记的 `src/`、`src-tauri/src/` 源文件 ⇆ files/ 页一一对应（vendor 豁免）；缺页红、孤儿页红；summary 与登记处逐字一致。
4. **功能登记对账**：features.yaml ⇆ features/ 目录一一对应；slug 合法。
5. **变更对账**：status 为 in-progress/done 的 flow issue 必须有 changes 页；changes 页 issue 字段必须指向存在的 flow issue。
6. **行覆盖率**：文件页 segments 定位到的行区间并集 ÷ 源文件非空行数 ≥ 阈值。阈值与豁免登记唯一 home 是 `walkthrough/manifest.json`（默认 60%，豁免须逐文件登记理由）。低于阈值即红。
7. **构建即校验**：build-walkthrough.mjs 跑通为结构合法的最终证明。

diff 门禁（`verify:walkthrough --diff <base>`，CI on PR，与 verify-flow --diff 同参）：

8. **改码必改页**：PR diff 每个 `src/**`、`src-tauri/src/**` 源文件 ⇒ 对应 files/ 页必须在同 PR diff 有变更。
9. **touches 全量对账**：changes 页 touches 的 file 引用必须覆盖 PR diff 全部源文件。

流程接线：PR 的 issue scope 必须包含本 PR 触碰的 `walkthrough/**`（复用 verify-flow --diff 既有机制）；route:gates 路由表加 `walkthrough/**` 规则；CI 静态 lane 挂 verify:walkthrough，PR lane 挂 --diff 档。

## PR 流程与合入语义

开发：改代码 → 锚点红逼 AI 同 PR 更新文件页/功能页快照与讲解 → 写 changes 页三层叙事 → 门禁绿。Review：维护者 `pnpm walkthrough` 构建，从 changes 页三层叙事入手，经 touches 跳到主站页面看更新后讲解，YAML diff 随 PR 可审。合入：主站页面在同一 PR 内已是新态，changes 页留在变更史区——不做事后合并，做同事提交。

## 渲染管线与产物形态

`scripts/walkthrough-lib.mjs`（schema/锚点/对账，verify 与 build 共用单一事实源）、`scripts/verify-walkthrough.mjs`、`scripts/build-walkthrough.mjs`，各带 spec 自测试（仓规）。产物：`walkthrough/dist/` 多页静态站点——每页一个 HTML，左侧导航 + 面包屑，页间相对链接互跳，file:// 直开；手写模板，内联 CSS，无框架无外链；代码高亮 v1 用简单关键字着色或不着色，不引入依赖。命令：`pnpm walkthrough`（build + open）、`pnpm verify:walkthrough`；同步更新根 AGENTS.md 命令清单。

## Bootstrap 计划

1. 建 flow issue（流程骨架挂 m0 或新 milestone，实施计划阶段定），`pnpm flow:sync` 回填编号。
2. 骨架 PR：README 契约 + yaml 子集解析器 + schema + 门禁 + 生成器 + overview/architecture 初稿 + features.yaml 登记 + manifest.json，门禁先绿。
3. 回填：文件页按"主干链路 → 边缘功能"序生成（bootstrap/装载器/host/agent 回环 → 三格式阅读面 → 其余插件 → Rust 侧），功能页覆盖全部用户可见功能，行覆盖率达标。
4. 维护者按功能页为单位扫读确认，不合格页面就地返工。

## 验证

门禁自测试覆盖七条静态 + 两条 diff 规则的代表路径；bootstrap 完成后 verify:walkthrough 全绿；人工走通"总览 → 架构 → 功能 → 跳文件页 → 返回"回路。

## 风险与欠账

- AI 生成讲解的语义质量机器判不了（Swimm 同坑）：靠锚点红强制重写 + 维护者扫读 changes/文件页 diff 兜底。
- 快照粒度选择影响漂移频率：太粗易红、太细讲解散。初版由 AI 按"语义完整段"截取，bootstrap 后按红的频率复盘调整。
- Bootstrap PR 体量大：按第 3 步顺序拆多个 commit，必要时拆骨架/回填两个 PR。
- 行覆盖率 60% 是拍脑袋起点：bootstrap 完成后按实际分布校准，校准结论记 Agent Note。

## 后续

本 spec 经维护者审阅后，走 writing-plans 出实施计划；实施第一步建 flow issue（本仓硬约束：代码改动挂 issue，提交与 PR 标题含 (#N)）。
