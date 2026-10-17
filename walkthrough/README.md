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
| `architectural` | 正文字符串；无架构变化时写 `无`。 |
| `codeMap` | 非空数组的变更地图分组，见下。 |
| `reviewGuide` | map：`order`（非空字符串数组，建议阅读顺序）、`risks`（字符串数组，可为空）、`acceptance`（非空数组，项恰为 `item` 与 `evidence` 两个非空字符串）。 |
| `verification` | 非空字符串数组：实际跑过的门禁/测试。 |

`codeMap` 每项恰为 `group`（非空字符串）、`attention`、`why`（字符串或 `null`，空理由写 `why: null`）、`files`（非空数组，项恰为 `path` 与 `note` 两个非空字符串）。`attention` 是封闭集合：`must-read`（必读者，渲染展开置顶）、`skim`（可扫读，默认折叠灰显）、`skip`（可跳过，默认折叠）。机械路径（`*.i18n.yaml`、`docs/commands.*` 生成区、`pnpm-lock.yaml`；规则的唯一 home 是 `walkthrough-lib.mjs` 导出的 `MECHANICAL_PATTERNS`，`.github/workflows/` 刻意不算机械）不得出现在 `must-read` 组，出现即红。

`features.yaml` 顶层只允许 `features`；每个登记项只允许非空 `slug`、`title`、`summary`、`issue`，并与 `walkthrough/features/` 页一一对应（issue 存在性由变更对账兜底），骨架固定用 `{features: []}`。`manifest.json` 顶层只允许 `bootstrap`（boolean）与 `lineCoverage`；后者只允许 `threshold`（0 到 1）与 `exemptions`（源路径到非空理由的 map）。

## 锚点机制

`snippet` 只是定位器：构建与校验时对源文和锚点逐行 `trimEnd` 后做大小敏感子串匹配，取首次命中，允许多个 segment 重叠。展示内容永远读取构建期目标文件的真实代码并带行号；命中失败红，多处命中取首次并可在构建日志观察，讲解文字本身靠变更门禁保鲜。

## 十条门禁

`node scripts/verify-walkthrough.mjs` 执行静态 1-6，diff 模式追加 8-10，规则 7 由构建成功单独证明：

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

PR 还须让 flow issue scope 包含触到的 `walkthrough/**`；正式接线后命令与 CI 路由由根 `AGENTS.md` 和 `docs/AGENTS.md` 登记。

## Bootstrap 降级

`manifest.json` 当前置 `bootstrap: true`：规则 3 文件页对账、规则 5 变更对账、规则 6 行覆盖率的失败只输出 `WARN`，不改变 verify 结果；schema、锚点、功能登记、构建与 diff 规则仍硬红。移除条件是五层内容完成回填且维护者扫读合格；随后删除 `bootstrap` 标志或置 `false`，三条欠账立即转红，新增源文件不再能靠降级通过。

## 机械与语义分工

机械门禁负责形状封闭、锚点命中、登记对账、覆盖率、diff 同步和可构建性；人扫读负责讲解是否准确、边界是否讲清、决策链是否可信，审阅以变更页三层叙事入口、经 touches 跳主站页面、再检查 YAML diff 为准。AI 不得把绿灯当作语义合格证据；内容回填期间每页都要能回答“用户看到什么、代码怎么组织、为什么这样写”。
