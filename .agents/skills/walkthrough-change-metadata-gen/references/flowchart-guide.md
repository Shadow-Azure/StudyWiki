# 流程图（结构化字段）写法

变更页的两类流程图是 **yaml 结构化字段**，不是手写 SVG：构建期由 `scripts/walkthrough-flowchart.mjs`（dagre 布局 + 手写 SVG）渲染成内联矢量图。渲染器零 DOM 依赖、零外部资源，文字宽度用逐字符模型估算（CJK 1em、拉丁 0.55em），超长标签自动折行。

## 何时必填

- `architectural` 有实质内容（非空且不是 `无`/`无。` 占位）→ `architecturalFlowchart` 必填，渲染在"架构影响/架构变化"章节末尾。
- `design` 非空 → `designFlowcharts` 必填且非空：落地映射（`### 落地映射：功能点 → 变更文件`）里每个 `#### ` 功能点小节**各配一条**，`feature` 值与小节标题逐字一致。门禁做双向对账：缺一条红，多一条（feature 名对不上小节）也红。
- 没有落地映射小节、design 是整段散文时，配一条整体方案的 `designFlowcharts` 即可。

## 字段形状（键集合封闭）

```yaml
architecturalFlowchart:
  title: 数据流            # 可选，渲染为题注
  direction: LR           # 可选：LR（缺省，自左向右）| TB（自上而下）
  nodes:
    - id: load             # 图内唯一，非空
      label: 装载 YAML 源   # 非空；支持显式 \n；超长自动折行
      shape: stadium       # 可选：rect（缺省）| rounded | stadium（起止）| diamond（判断）
    - id: verify
      label: 校验封闭 schema
  edges:
    - from: load           # 必须引用已声明的节点 id
      to: verify
      label: 逐页          # 可选
designFlowcharts:
  - feature: 变更页机制与门禁   # 必填：对应 design 的 #### 小节名
    title: 门禁事实源
    nodes: [...]
    edges: [...]
```

## 写作标准

- 一张图讲一条链路：3-8 个节点为宜；起点/终点用 `stadium`，判断/分支用 `diamond`，中间步骤用 `rect`/`rounded`。
- `label` 写模块名/动作名，不写代码、不写文件名堆砌；与正文术语一致（同一东西不写两个名字）。
- 分支边必须带 `label`（是/否、成功/失败），让读者不猜箭头语义。
- 单向主链优先 `LR`；层级解剖或回边多的图可用 `TB`。
- 不确定能不能画成流程图时，宁可先写文字；配错的图比缺图更误导。

## 与手写 SVG 配图的关系

流程图字段管"架构变化 + 方案设计"两个章节的程序化配图；`diagram-guide.md` 的手写 SVG 管其余场景（组件图、时序图、泳道图等复杂图示），两者可同时存在。

## 门禁语义（自检用）

- `nodes` 至少 2 项、`edges` 非空；节点 id 唯一；边端点必须闭合。
- `architecturalFlowchart`/`designFlowcharts` 在正文无实质内容时不得出现。
- 形状/方向/引用错误都是红门禁（`node scripts/verify-walkthrough.mjs`）。
