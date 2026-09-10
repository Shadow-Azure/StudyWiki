# AGENTS.md

StudyWiki 是一个本地 Markdown + 视频学习客户端（Tauri 2 桌面应用）。改代码前先读 [docs/architecture.md](docs/architecture.md)；写文档前先读 [docs/AGENTS.md](docs/AGENTS.md)。

## 环境无关性（硬约束）

**发布的客户端必须完全不依赖运行环境**：用户机器上不需要预装 Node、Python、浏览器、解码器或任何运行时；产物完全离线可用，不访问网络；同一版本在任意机器上行为一致。细则与豁免登记见 [docs/environment-independence.md](docs/environment-independence.md)（唯一 home）。发布门禁会机械校验此约束；任何违反它的改动（CDN 引用、外置运行时、运行时下载、环境变量分支）直接拒绝，除非先在该文档登记豁免并说明理由。

## 命令

```sh
pnpm install             # 依赖
pnpm tauri dev           # 开发
pnpm tauri build         # 发布构建
pnpm lint:docs           # 快速文档门禁（无构建）
pnpm verify:docs         # 全量文档门禁
pnpm verify:env-independence  # 环境无关性单项（doc-sync 已含）
pnpm verify:dep-audit     # 依赖白名单精确 diff + node: 引用扫描（doc-sync 已含）
pnpm verify:release      # 发布前校验（含环境无关性）
pnpm verify:commands     # 命令目录新鲜度 --check（doc-sync 已含）
pnpm record:i18n -- <pair>  # 双语配对重录（契约见 docs/i18n/README.md）
pnpm gen:commands        # 重建命令目录生成区（改 lib.rs 命令后）
pnpm gen:code-map        # 重建架构组成树生成区（源文件或职责变更后）
pnpm route:gates         # 按改动面推荐门禁组合（默认工作树，--base <ref> 看区间）
pnpm archive:note -- <base.md>  # 冻结归档一条 implemented note
pnpm test                # 门禁自测试（vitest）
pnpm install:hooks       # 装 git 钩子并注册 i18n merge driver（每 clone 一次）
```

## 惯例

- 每个非平凡变更在同一 PR 内新增或更新至少一条 Agent Note（[规则](.agents/notes/README.md)）。
- 前端不加 UI 框架；依赖只进 `dependencies` 且必须是构建期可打包的库，禁止任何 CDN/运行时加载。
- 本地文件访问只走 `src-tauri/src/lib.rs` 的两条命令 + asset protocol，扩展名分派在 Rust 侧完成。
- 文档现状优先：写"现在是什么"，不写"以前是什么"；变更史进 Agent Note 或 commit。
- TS 导出与 Tauri 命令必须带文档注释（契约语义，命令目录的原料）；门禁校验。
- 常驻文档中英成对（三件套）：改任一侧须最小修补另一侧并重录，围栏与生成区逐字复制不翻译；契约见 [docs/i18n/README.md](docs/i18n/README.md)。
- 提交信息用中文，正文说明动机；门禁脚本改动要同步更新本文件的命令清单。

## 密钥

仓库不存任何密钥；`.env` 已被 gitignore 且产品不得读取它。
