# 开发指南

[English](development.en.md) | 中文

> 类型：教程 | 层级：贡献者上手。CI 与门禁的权威清单在 `package.json` scripts 与 [scripts/run-gates.mjs](../scripts/run-gates.mjs)，本页只讲怎么用。

## 环境

- Node ≥ 22、pnpm ≥ 10、Rust stable（1.77+）
- macOS：Xcode CLT；Windows：MSVC Build Tools；Linux：`libwebkit2gtk-dev` 等（见 Tauri 2 官方前置清单）
- 以上仅**构建**需要；产物的环境无关性约束见 [environment-independence.md](environment-independence.md)

## 日常循环

```sh
pnpm tauri dev     # 开发：改 src/ 或 src-tauri/ 均热更/重编
```

提交前按改动面选门禁（不要默认全量跑，穷尽覆盖归 CI）：

| 改动 | 本地跑 |
|---|---|
| 仅文档 / Agent Note | `pnpm lint:docs` |
| 前端代码 | `pnpm build`（含 tsc） |
| Rust 代码 | `cargo fmt --check && cargo clippy && cargo test`（在 `src-tauri/`） |
| 涉及产物行为的任何代码 | `pnpm verify:docs` + 上述代码检查 |

改配对文档任一侧：同一 PR 内最小修补另一侧并 `pnpm record:i18n -- <pair>` 重录（契约见 [i18n/README.md](i18n/README.md)）；改 `src-tauri/src/lib.rs` 命令后跑 `pnpm gen:commands`。

本地钩子刻意窄：`pnpm install:hooks` 装 pre-commit（暂存区尾随空白）与 pre-push（doc-quick），并注册 `.i18n.yaml` 的 fail-closed merge driver（`.gitattributes` 已引用）；穷尽覆盖归 CI，钩子是提醒不是门禁。门禁脚本自身有 vitest 测试（`pnpm test`），CI 静态 lane 同跑。

普通 ```ts 围栏会被 doc-typecheck 真实编译（import 以仓库根为基准），围栏逐字复制到英文侧：

```ts
import { invoke } from "@tauri-apps/api/core";
import type { FileNode } from "./src/types";

// 侧栏数据源：已按扩展名分类、按名称排序的条目
const root = "/path/to/library";
const entries: FileNode[] = await invoke("read_tree", { root });
```

## 提交与发布

- 每个非平凡变更同一 PR 内带一条 Agent Note（新增或更新 owning note）。
- 发布：打 tag `v*` 触发 [release.yml](../.github/workflows/release.yml)；门禁全绿后出 draft release。发布清单见 [release-checklist.md](release-checklist.md)。
