# Agent Note: Walkthrough 变更页流程图（dagre 自绘 SVG）

Status: implemented

[English](2026-10-18-walkthrough-flowchart.en.md) | 中文

## Problem

变更页的"架构影响"与"方案设计"两章只有文字：单人维护者检视 PR 时要从散文里自行还原链路与分支，多功能点 PR 尤其吃力。需要图文结合，且图必须像其余讲解源一样可 diff、可门禁、构建期内联、零运行时依赖。

## Decision

变更页 yaml 新增两个结构化字段，构建期渲染为内联 SVG：

- `architecturalFlowchart`：`architectural` 有实质内容（`无`/`无。` 占位除外）时必填，渲染在架构章节末尾。
- `designFlowcharts`：`design` 非空时必填，落地映射每个 `#### ` 功能点小节一条，`feature` 与小节名双向对账（缺/多都红）。

每张图还必须有 `explanation`：先说图表达什么机制或链路，再说为什么用这条主链、分叉或回边来表达。它是图下方的读图入口，与相邻叙事互补，缺失时 schema 直接红。

图本体是封闭 schema 的 nodes/edges（shape 限 rect/rounded/stadium/diamond，direction 限 LR/TB，边端点必须闭合）。渲染器 home 是 `scripts/walkthrough-flowchart.mjs`：**dagre 只做纯图布局，矩形/菱形/箭头/标签全部手写 SVG**；文字宽度用逐字符模型估算（CJK 1em、拉丁 0.55em），超长标签按 token 折行；样式走站点 CSS 令牌，明暗主题自动跟随。

## Alternatives considered

- mermaid-cli（puppeteer/Chromium）：mermaid DSL 生态最成熟，但安装期要下载浏览器二进制，CI 重且违背"无二进制下载"偏好。否。
- mermaid + jsdom：轻量但官方不支持——mermaid 自己的测试工具都声明"布局在 jsdom 不可用"（无渲染引擎），社区方案靠伪造 getBBox 量尺，版本升级是持续风险。否。
- beautiful-mermaid 等零 DOM 渲染器：自称纯 TS 直接出 SVG，但不同来源描述互相矛盾，npm 维护状态无法核实。否。
- 借用力导向/ELK 布局：dagre 的层次布局对流程图更贴，且 mermaid flowchart 底层同为 dagre，视觉习惯一致。

## Consequences

讲解源从"纯文本"扩为"文本 + 结构化图"，walkthrough 的 YAML 子集解析器继续零依赖（流程图字段落在既有的列表/嵌套 map 形状内）。schema 校验多了一块图文配平硬门禁（CI 与构建期同跑），skill `walkthrough-change-metadata-gen` 负责生成时的图质量，并要求每张图的讲解由独立 subagent 研究后由主线程统一收口。代价是表达能力封顶于流程图（DAG + 分支 + 起止/判断形状）；将来若需要时序图/状态图，需另立字段或另选渲染器，届时重开评估。
