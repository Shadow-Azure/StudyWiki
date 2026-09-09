# AGENTS.md — 文档标准

本文件定义 `docs/` 树的结构、层级分工与门禁。规则放在能被机械校验的地方，人只做判断。

## 层级：一个事实一个 home

| 层 | 职责 | 不许放 |
|---|---|---|
| 根 `AGENTS.md` | 常驻指令：每条一两行 + 链接到 home | 故事、示例、从 home 复述的任何内容 |
| `docs/architecture.md` | 有序地图：组成、数据流、关键决策点 | 决策理由（→ Agent Note）、逐 API 细节 |
| `docs/environment-independence.md` | 环境无关约束的可验证定义、豁免登记 | 一般性安全议题 |
| `docs/development.md` | 贡献者上手、日常流程、CI/门禁摘要 | 会漂移的逐项清单（→ `package.json` scripts） |
| `docs/i18n/README.md` | 双语配对契约（三件套、镜像、豁免） | 翻译教程 |
| `docs/postmortem/` | 事故复盘——全库唯一允许叙事的层级 | — |
| Agent Notes（`.agents/notes/`） | 决策记录：为什么、放弃了什么 | 现状描述（→ docs） |
| 代码内文档 | 契约语义（何时触发/边界/失败处置） | 推理过程、代码复述 |

放置口诀：bug → postmortem；理由 → Agent Note；步骤 → development.md；现状 → 对应 docs 页；常驻规则 → 根 AGENTS.md（附理由链接）。

## 写作规则

- **写现状，不写变更史**：避免"以前/现在/不再"；变更故事进 commit、Agent Note 或 postmortem。
- **双语成对**：常驻文档中英三件套成对合并，改任一侧最小修补另一侧并重录，围栏与生成区逐字复制不翻译（契约：[i18n/README.md](i18n/README.md)）。
- 段落一行到底（soft-wrap），表格与代码块保持原样（红门禁：verify-md-wrap）。
- 文档内代码示例必须可用；贴类型声明用 ` ```ts type-equiv ` 围栏（源码漂移即红）；命令面走生成区（`pnpm gen:commands`），标记之间不手编。导出面须带文档注释（verify-export-docs）。
- 每个非平凡变更在同一 PR 内新增或更新至少一条 Agent Note。
- 常驻文档受词数预算约束（[scripts/doc-budgets.manifest.json](../scripts/doc-budgets.manifest.json)），常驻即须登记（未登记红门禁）；超限处置顺序：搬层 → 压缩 → 提预算（须在 PR 说明）。

## 门禁

```sh
pnpm lint:docs    # doc-quick：索引、Note、预算、段落换行、配对、type-equiv、导出注释、postmortem 结构（秒级）
pnpm verify:docs  # doc-sync：上述 + ts 围栏编译 + 生成区新鲜度 + 死链 + 环境无关
```

叶子清单与组合见 [scripts/run-gates.mjs](../scripts/run-gates.mjs)；CI 的静态 lane 内嵌 doc-sync（见 [.github/workflows/ci.yml](../.github/workflows/ci.yml)），不存在"CI 忘配文档门禁"的路径。
