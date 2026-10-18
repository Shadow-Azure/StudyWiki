# walkthrough 目录契约

本目录是 StudyWiki 的工程讲解站源：中文单语、离线构建、不进翻译配对语料；`walkthrough/dist/` 是本地产物并已忽略。

## 站点结构

| 层 | 源位置 | 作用 |
| --- | --- | --- |
| 总览 | `walkthrough/overview.yaml` | 回答产品是什么，并给出站点阅读顺序与当前回填状态。 |
| 架构 | `walkthrough/architecture.yaml` | 给出分层叙事、同源组成树和关键决策链。 |
| 功能 | `walkthrough/features.yaml` 与 `walkthrough/features/*.yaml` | 登记处与功能页一一对应，聚合用户可见行为、模块地图和实现步骤。 |
| 文件 | `walkthrough/files/*.yaml` | 按 `scripts/code-map.manifest.json` 的源路径镜像命名，承载文件职责 summary 与逐段锚点注解。 |
| 变更史 | `walkthrough/changes/*.yaml` | 以 flow issue slug 命名，写功能、架构、代码细节三层叙事和 `touches` 覆盖。 |

资源放 `walkthrough/assets/`，构建器只复制非空资源目录，`.gitkeep` 占位文件也会被复制进产物但无害；生成入口是 `node scripts/build-walkthrough.mjs`，产物可直接以 `file://` 打开。

## YAML 子集

解析器 home 是 `scripts/walkthrough-yaml.mjs`：只接受顶层 map、一层 map 嵌套、裸标量、非负整数、`true`/`false`/`null`、行内标量列表、块列表和 `|` 块标量；块列表项可以是标量或一维 map。缩进必须用空格并保持固定两格层级，注释和空行在块标量外忽略，块标量内原样保留。引号 key/value、锚点、tag、alias、负整数、flow map、多文档和更深层嵌套都会 fail-loud；`#` 开头行与空行在块标量内是内容，不得依赖它们表达注释。

## Kind schema

所有 YAML 页的键集合封闭；写未知键直接红。

| kind | 必填键 | 可选键与约束 |
| --- | --- | --- |
| `overview` / `architecture` | `kind`、`sections`（非空数组） | section 允许 `heading`、`body` 与可选非空相对路径数组 `images`；`generated` 仅 architecture 支持，且只能取 `code-map`。 |
| `feature` | `kind`、`slug`（kebab-case 且等于文件名）、`title`、`behavior`、`modules`（非空字符串数组）、`steps`（非空数组） | step 必填 `note` 与 `ref.file`、`ref.snippet`；`related.notes` 可选为字符串数组。 |
| `file-page` | `kind`、`source`（等于去 `.yaml` 的镜像路径）、`summary`（逐字等于 code-map 登记值）、`segments`（非空数组） | segment 必填 `snippet` 与 `note`。 |
| `change` | `kind`、`issue`（等于 flow slug 与文件名）、`title`、`scale`、`feature`、`userFlow`、`architectural`、`codeMap`、`reviewGuide`、`verification`、`touches`（字符串数组） | 旧三段字段 `functional`/`code` 已移除，出现即红（未知键）；各字段形状见下表。写作规范建议 `touches` 用 `file:<repo-relative-source>` 或 `feature:<slug>`；前缀封闭校验在回填计划中收紧。 |

`change` 页字段形状（键集合全部封闭）：

| 字段 | 形状与约束 |
| --- | --- |
| `scale` | map，恰为 `files`/`additions`/`deletions` 三个非负整数；描述整个 PR 的实际规模，--diff 档与 `git diff --numstat` 对账。 |
| `feature` | 正文字符串：实现了什么功能，缺了什么、现在是什么。 |
| `userFlow` | 非空字符串数组：用户操作路径，按序渲染为有序列表。 |
| `architectural` | 正文字符串；无架构变化时写 `无`（`无`/`无。` 占位视为无实质内容，不需要流程图）。 |
| `architecturalFlowchart` | `architectural` 有实质内容时必填：结构化流程图，构建期渲染为内联 SVG 紧随架构影响章节。形状见下表。 |
| `design` | 可选 markdown 方案设计；非空时 `designFlowcharts` 必填。 |
| `designFlowcharts` | `design` 非空时必填且非空：每个落地映射功能点一条，`feature` 与 design 的 `#### ` 小节名双向对账。 |
| `codeMap` | 非空数组的变更地图分组，见下。 |
| `reviewGuide` | map：`order`（非空字符串数组，建议阅读顺序）、`risks`（字符串数组，可为空）、`acceptance`（非空数组，项恰为 `item` 与 `evidence` 两个非空字符串）。 |
| `verification` | 非空字符串数组：实际跑过的门禁/测试。 |

**流程图形状**（`architecturalFlowchart` 与 `designFlowcharts` 项共用）：图本体键封闭为 `title`（可选）/`direction`（可选，`LR` 缺省|`TB`）/`nodes`/`edges`。node 恰为 `id`（非空、图内唯一）、`label`（非空）、`shape`（可选：`rect` 缺省|`rounded`|`stadium` 起止|`diamond` 判断）；edge 恰为 `from`、`to`（必须引用已声明节点）、`label`（可选）。`designFlowcharts` 每项额外必填 `feature`（对应 design 落地映射小节名）。渲染器 home 是 `scripts/walkthrough-flowchart.mjs`（dagre 布局 + 手写 SVG，构建期内联，零 DOM 依赖）。

`codeMap` 每项恰为 `group`（非空字符串）、`attention`、`why`（字符串或 `null`，空理由写 `why: null`）、`files`（非空数组）。file 项恰为 `path` 与 `note` 两个非空字符串；`changes` 可选，必须是 `{snippet, note}` 列表。`attention` 是封闭集合：`must-read`（必读者，进入逐段注解骨架）、`skim`（可扫读，只给规模与文件级注解）、`skip`（可跳过）。must-read 组中的 reviewable 源码文件必须带非空 `changes`；机械路径（`*.i18n.yaml`、`docs/commands.*` 生成区、`pnpm-lock.yaml`；规则的唯一 home 是 `walkthrough-lib.mjs` 导出的 `MECHANICAL_PATTERNS`，`.github/workflows/` 刻意不算机械）不得标 must-read。

`features.yaml` 顶层只允许 `features`；每个登记项只允许非空 `slug`、`title`、`summary`、`issue`，并与 `walkthrough/features/` 页一一对应（issue 存在性由变更对账兜底），骨架固定用 `{features: []}`。`manifest.json` 顶层只允许 `bootstrap`（boolean）、`lineCoverage` 与 `reviewCoverage`。`lineCoverage` 只允许 `threshold`（0 到 1）与 `exemptions`（源路径到非空理由的 map）；`reviewCoverage` 是 0 到 1 的数字，缺省 `0.9`。

## 锚点机制

`snippet` 只是定位器：构建与校验时对源文和锚点逐行 `trimEnd` 后做大小敏感子串匹配，取首次命中，允许多个 segment 重叠。展示内容永远读取构建期目标文件的真实代码并带行号；命中失败红，多处命中取首次并可在构建日志观察，讲解文字本身靠变更门禁保鲜。

## Review 路径树

`--review` 变更区先渲染 must-read/skim/skip 的分组图例（组名、attention 与 why），再渲染源码目录嵌套的纯 HTML `<details>` 路径树；目录与文件初始都收起。must-read 组中处于 diff 内的 reviewable 源码文件展开为 changes snippet 锚定的逐段 diff，区间外 diff 行折叠到“其余变更行”；skim/skip 文件只显示统计与文件级 note，不渲染 hunk。

## 变更页叙事质量

变更页的叙事层（功能/用户操作路径/架构变化/方案设计 `design` 字段/图示/逐段注解的写法）**质量唯一 home 是 skill**：[.agents/skills/walkthrough-change-metadata-gen/SKILL.md](../.agents/skills/walkthrough-change-metadata-gen/SKILL.md)。门禁只看护机械面（锚点/覆盖率/schema/对账）；写得通不通俗、图配得好不好，由该 skill 的生成纪律约束。生成或更新 changes 页元数据时必须使用该 skill。

## 保鲜门禁

变更页带 `skill_gen_commit_id`（上次由生成 skill 对齐时的分支最新 commit）。pre-push 检查：分支关联 PR 时，diff 内变更页的该字段必须等于最新提交，或其后的提交仅触碰 `walkthrough/changes/**`（纯元数据对账放行）；落后则拦截并提示调用生成 skill 增量更新。实现：`scripts/check-review-freshness.mjs`。

## 门禁

`node scripts/verify-walkthrough.mjs` 执行静态 1-7，diff 模式追加 8-12：

1. schema、kind、必填字段、类型和键集合封闭校验。
2. 全部 feature/ref 与 file segment 锚点定位。
3. code-map 登记源文件与 `files/` 页一一对应，且 summary 逐字一致。
4. `features.yaml` 登记处与 `features/` 页一一对应，slug 合法唯一。
5. `in-progress`/`done` flow issue 有变更页，且变更页 issue 指向真实 flow slug。
6. 每个 non-exempt 文件页锚点覆盖的非空行比例达到 `manifest.json` 阈值。
7. `node scripts/build-walkthrough.mjs` 成功产出 `walkthrough/dist/`。
8. PR diff 中每个 `src/**` 或 `src-tauri/src/**` 源文件，其文件页必须在同一 diff 更新。
9. PR diff 中全部强制源文件必须被某个变更页 `touches` 的 `file:` 引用覆盖。
10. scale 与语义路径对账只约束本 PR 新建的变更页（`--diff-filter=A`，base 无该文件），且 scale totals 对账仅在恰好新增一个变更页时执行——`scale.files` 必须恰好等于 `git diff --numstat` 行数，`scale.additions`/`deletions` 允许相对实际值 ±10% 容差（单页 PR 是未来常态，反过期目的保住；bootstrap 型多页大 PR 的页面各自描述历史 PR，totals 结构上不可满足，退化为仅覆盖检查）。codeMap 语义覆盖对所有新增变更页全局生效：`codeMap.files` 必须覆盖 diff 中全部语义路径（命中 `MECHANICAL_PATTERNS` 的机械路径与 `walkthrough/` 站点源自身豁免覆盖义务）。仅被修改的历史变更页只做 schema 静态检查——它们描述的是自己的历史 PR，scale 与本 diff 无关也不该相等。
11. must-read 组 reviewable 源码文件的每条 changes snippet 锚定的 after 区间不超过 20 行；目标是把注解压回可逐段扫读的骨架。
12. must-read 组 reviewable 源码文件集合的注解覆盖率达到 `reviewCoverage`：分母是 numstat 中这些文件的 additions 合计，分子是 changes snippet 在当前源码中锚定 after 区间的并集行数；无注解文件计入分母，定位失败由锚点门禁红且此处按 0 计。

PR 还须让 flow issue scope 包含触到的 `walkthrough/**`；正式接线后命令与 CI 路由由根 `AGENTS.md` 和 `docs/AGENTS.md` 登记。

## Bootstrap 降级

`manifest.json` 当前置 `bootstrap: true`：规则 3 文件页对账、规则 5 变更对账、规则 6 行覆盖率的失败只输出 `WARN`，不改变 verify 结果；schema、锚点、功能登记、构建、diff 规则与 review 逐段/覆盖率规则仍硬红。移除条件是五层内容完成回填且维护者扫读合格；随后删除 `bootstrap` 标志或置 `false`，三条欠账立即转红，新增源文件不再能靠降级通过。

## 机械与语义分工

机械门禁负责形状封闭、锚点命中、登记对账、覆盖率、diff 同步和可构建性；人扫读负责讲解是否准确、边界是否讲清、决策链是否可信，审阅以变更页三层叙事入口、经 touches 跳主站页面、再检查 YAML diff 为准。AI 不得把绿灯当作语义合格证据；内容回填期间每页都要能回答“用户看到什么、代码怎么组织、为什么这样写”。
