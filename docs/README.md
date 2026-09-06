# 文档索引与维护机制

本库把文档当与代码同级的工件：每条"应保持一致"的软性要求背后有一个会红的门禁脚本，人只做判断（取舍、归档），一致性归机器。机制蓝本源自 deepseek-harness 的 docs-as-code 流水线，按本项目体量裁剪。

## 文档地图

| 文档 | 职责 | 预算（词） |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | 常驻指令（根） | 550 |
| [architecture.md](architecture.md) | 架构地图 | 480 |
| [environment-independence.md](environment-independence.md) | 环境无关约束 + 豁免登记 | 720 |
| [development.md](development.md) | 贡献者上手 | 320 |
| [AGENTS.md](AGENTS.md)（docs 子树标准） | 层级分工、写作规则、门禁 | 650 |
| [release-checklist.md](release-checklist.md) | 发布门禁清单 | 350 |
| [postmortem/README.md](postmortem/README.md) | 事故复盘层级说明 | 170 |

新增 `docs/**/*.md` 必须同步登记进本表，否则索引门禁红（`scripts/verify-doc-index.mjs`）。词数预算由 `scripts/doc-budgets.manifest.json` 执行，本表只做索引。

## 生命周期十步（裁剪版）

规则注入（AGENTS 分层）→ 决策落档（Agent Note）→ 现状文档（docs/）→ 索引登记（本表）→ 本地验证（run-gates 分档）→ CI 裁决（ci.yml 静态 lane 内嵌 doc-sync）→ 发布投影（release-checklist）→ 归档复盘（postmortem）。

与蓝本的差异（有意裁剪）：不做双语配对（单语库）；不做 type-equiv 围栏（类型量小，`src/types.ts` 单一形状直接读源码）；不设 VitePress 投影站（无发布站需求）。裁剪若失效（如文档数 >20 或引入双语），以 Agent Note 记录后恢复对应机制。

## Agent Notes

决策记录（为什么、放弃了什么）不在 docs/，在 [.agents/notes/](../.agents/notes/README.md)——路径即状态机的独立体系。
