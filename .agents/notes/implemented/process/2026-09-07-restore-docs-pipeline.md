# Agent Note: 恢复蓝本文档流水线（双语/type-equiv/生成目录）

Status: implemented

[English](2026-09-07-restore-docs-pipeline.en.md) | 中文

## Problem

初始化时按单语小库假设裁剪了蓝本文档流水线的三块机制（见 [2026-09-06-docs-as-code-gates.md](2026-09-06-docs-as-code-gates.md) 的历史）。项目即将进入持续开发期，代码与文档都会增长，裁剪假设失效；恢复条件（引入双语）实质触发。

## Decision

按蓝本移植三块机制（脚本零依赖，type-equiv/doc-typecheck 借用已有 typescript devDep）：`verify-translation-pairing`（blob hash + 结构签名 + 切换行 + 链接 locale + 生成区，契约 home 在 [docs/i18n/README.md](../../../../docs/i18n/README.md)）、`verify-type-equiv`（围栏与源码结构+JSDoc 等价，manifest 1:1）、`gen-commands-catalog`（lib.rs 命令面 → 两侧生成区，verify 即 `--check`）与 `doc-typecheck`（普通 ts 围栏真实编译）。方向决策：**中文为 base（`foo.md`）+ 英文侧（`foo.en.md`）**，与蓝本相反（en base + `.zh.md`）——本库提交信息与既有文档全中文，母语写源摩擦最小，配对机制两侧对称故移植成本不变。AGENTS.md（根 + docs 子树）保持单语、显式豁免（蓝本同款）；Agent Notes 双语（蓝本同款）。VitePress 投影站仍缓建。

## Alternatives considered

- **照搬蓝本方向（en base + .zh.md）**：脚本同构度最高，但本库以中文为一等语言、英文才是翻译侧；方向反过来后机制完全对称。
- **只恢复 type-equiv/生成目录，维持单语**：省一半翻译义务，但"两侧说同一件事"的公证缺席——蓝本把翻译一致性与代码一致性当同级不变量。
- **等代码长出来再恢复**：文档欠账先滚大，且恢复动作迟早要做，越晚迁移成本越高。

## Consequences

- 每个 PR 的文档义务翻倍：改任一侧 → 最小修补另一侧 → `pnpm record:i18n` 重录；围栏与生成区逐字复制，不翻译。
- 翻译质量归评审：门禁只公证结构一致与未漂移，不判语义忠实（契约页已声明边界）。
- 结构签名解析器是自写的极简行扫描（零依赖约束的代价）；语料引入新 Markdown 语法时先扩展解析器再写文档。
- 投影站恢复条件：需要对外发布文档站时，以新 Note 记录后建 `website/` 投影层（仓库无第二份内容）。
