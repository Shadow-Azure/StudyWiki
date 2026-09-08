# Agent Notes

[English](README.en.md) | 中文

一种设计文档住在这里。**Agent Note 记录影响本库的决策**——为什么、放弃了什么——代码与文档装不下的那部分。本文件定义它住哪、何时写、什么格式（见下文）。

## 布局与命名

每条 Note 的两个坐标都编码在**路径**里——`{lifecycle}/{class}/yyyy-mm-dd-主题.md`：

- **Lifecycle**（顶层文件夹）即状态，Note 随状态变化在文件夹间移动：
  - **`proposed/`** —— 实施前评审的提案，尚未（或只部分）落地。
  - **`implemented/`** —— 决策已发布。文件记录决定了什么、否决了什么，并**随实际落地保持同步**：代码挪文件、改名、改默认值时，同一变更就地更新 Note 中的事实（只改事实，不改决策本身）。
  - **`rejected/`** —— 提案被否。只在理由能阻止一个有诱惑力的错误时保留，否则整个文件删除。
- **Class**（嵌套文件夹）是决策种类（见下）。
- 文件名日期 = 主题**首次提出**的日期（以 git 为准）；其余历史归 git。

Note 之间的互引用用相对 markdown 链接，不用裸描述或编号——可机械校验、移动不失效。不设集中式 INDEX.md，目录树即清单。

## 分类（封闭集合）

| Class | 覆盖 |
|---|---|
| `feature` | 新的用户可见能力 |
| `bug-fix` | 修正缺陷或补 postmortem 暴露的缺口 |
| `simplification` | 不加能力地删代码/行为/表面积 |
| `architecture` | 关于**发布源码**的结构决策 |
| `process` | 代码周边的工具/策略/流程——门禁、包管理、发布 |
| `testing` | 测试设施与策略 |

`architecture`/`process` 的分界：前者关于我们发布的源码，后者围绕它的工具与流程。加 class 须同时改 `scripts/verify-agent-notes.mjs` 的集合与本表。

## 何时写

**每个非平凡变更必须在同一 PR 内新增或更新至少一条 Agent Note。** 非平凡 = 改动行为、架构、跨文件契约、流程/工具、测试策略，或维护者可能 revisit 的任何决策。更新已有 owning Note 即满足，不建重复。纯机械的局部编辑豁免。

归档：低未来价值的 implemented note 可冻结移入 `archived/{class}/`。**语义判断归人**——逐条判断，字数与年龄只是发现辅助，不是归档标准；不向配额归档。机械部分走 `pnpm archive:note -- <base.md>`：三件套整体移动、`Status` 改 `archived`、每文件 sha256 记入 append-only 的 `.agents/notes/archived/manifest.json`（只增不改不删；删除或解封须在 PR 显式说明理由）。冻结件不再参与配对、围栏编译、链接等活语料检查——改一个字节即红。

## 文件格式

前三行固定，随后空行：

```markdown
# Agent Note: <标题>

Status: <status>
```

`Status` 三选一，且必须与所在文件夹互检（门禁校验）：

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <一行理由>`

正文骨架：`## Problem`（动机，离开解决方案也要立得住）→ `## Decision`（决定）→ `## Alternatives considered`（被否方案及原因——本层存在的核心理由）→ `## Consequences`（后果与欠账）。章节名固定，中间可插自由的技术段。

## 门禁

`pnpm lint:docs` 运行 [scripts/verify-agent-notes.mjs](../../scripts/verify-agent-notes.mjs)：路径合法（lifecycle × class 封闭集合）、前三行格式、`Status` 与文件夹一致、互引链接可达；归档件另由 [scripts/verify-archived-agent-notes.mjs](../../scripts/verify-archived-agent-notes.mjs) 冻结校验（sha256 + append-only，同在 lint:docs）。
