# 文档索引与维护机制

[English](README.en.md) | 中文

本库把文档当与代码同级的工件：每条"应保持一致"的软性要求背后有一个会红的门禁脚本，人只做判断（取舍、翻译取舍、归档），一致性归机器。机制蓝本源自 deepseek-harness 的 docs-as-code 流水线。语料内文档一律中英双语成对（契约见 [i18n/README.md](i18n/README.md)）。

## 文档地图

| 文档 | 职责 | 预算（词） |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | 常驻指令（根） | 660 |
| [architecture.md](architecture.md) | 架构地图（含 type-equiv 围栏） | 560 |
| [environment-independence.md](environment-independence.md) | 环境无关约束 + 豁免登记 | 720 |
| [development.md](development.md) | 贡献者上手 | 460 |
| [commands.md](commands.md) | Tauri 命令目录（生成区） | 150 |
| [i18n/README.md](i18n/README.md) | 双语配对契约 | 780 |
| [i18n/terminology.md](i18n/terminology.md) | 术语对齐表（禁用替写受门禁背书） | 300 |
| [i18n/translation-prompt.md](i18n/translation-prompt.md) | 补英文侧的操作模板 | 320 |
| [AGENTS.md](AGENTS.md)（docs 子树标准） | 层级分工、写作规则、门禁 | 690 |
| [release-checklist.md](release-checklist.md) | 发布门禁清单 | 350 |
| [postmortem/README.md](postmortem/README.md) | 事故复盘层级说明 | 170 |

新增 `docs/**/*.md` 必须同步登记进本表，否则索引门禁红（`scripts/verify-doc-index.mjs`；英文侧 `.en.md` 随 base 登记，不单列）。词数预算由 `scripts/doc-budgets.manifest.json` 执行（只挂 base 侧），本表只做索引。

## 生命周期十步

规则注入（AGENTS 分层）→ 决策落档（Agent Note）→ 现状文档（docs/，双语三件套）→ 类型进文档（type-equiv 围栏 + manifest，门禁公证与源码逐字等价）→ 目录生成（`pnpm gen:commands`，verify 即 `--check`）→ 双语配对（verify-translation-pairing，hash + 结构签名）→ 本地验证（run-gates 分档）→ CI 裁决（ci.yml 静态 lane 内嵌 doc-sync）→ 发布投影（release-checklist）→ 归档复盘（postmortem）。

与蓝本的差异：不设 VitePress 投影站（无对外发布需求；需要时以 Agent Note 记录后恢复）。双语方向与蓝本相反——中文为 base（`foo.md`）+ 英文侧（`foo.en.md`），配对机制两侧对称。

## Agent Notes

决策记录（为什么、放弃了什么）不在 docs/，在 [.agents/notes/](../.agents/notes/README.md)——路径即状态机的独立体系，同样双语成对。
