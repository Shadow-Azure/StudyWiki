# AGENTS.md

StudyWiki 是一个本地 Markdown + 视频学习客户端（Tauri 2 桌面应用）。改代码前先读 [docs/architecture.md](docs/architecture.md)；写文档前先读 [docs/AGENTS.md](docs/AGENTS.md)。

## 环境无关性（硬约束）

**发布的客户端必须完全不依赖运行环境**：用户机器上不需要预装 Node、Python、浏览器、解码器或运行时；产物完全离线可用，不访问网络；同一版本 + 同一插件集行为一致。细则与豁免见 [docs/environment-independence.md](docs/environment-independence.md)（唯一 home）。发布门禁机械校验此约束；违反它的改动（CDN、外置运行时、运行时下载、环境变量分支）直接拒绝，除非先在该文档登记豁免并说明理由。

## 命令

```sh
pnpm install             # 依赖
pnpm tauri dev           # 开发
pnpm tauri build         # 发布构建
pnpm lint:docs           # 快速文档门禁
pnpm verify:docs         # 全量文档门禁
pnpm verify:env-independence  # 环境无关性单项
pnpm verify:dep-audit    # 依赖白名单 diff + node: 扫描
pnpm verify:layering     # 分层纪律 + 装载缝扫描
pnpm verify:native-links # 发布产物动态链接扫描（需先 build）
pnpm verify:release      # 发布前校验
pnpm verify:commands     # 命令目录新鲜度
pnpm record:i18n -- <pair>  # 双语配对重录（契约见 docs/i18n/README.md）
pnpm gen:commands        # 重建命令目录生成区
pnpm gen:code-map        # 重建架构组成树生成区
pnpm gen:plugin -- <name>  # 生成外置插件脚手架（plugins-dev/<name>，gitignored）
pnpm route:gates         # 按改动面推荐门禁组合
pnpm archive:note -- <base.md>  # 冻结归档 note
pnpm test                # 门禁自测试
pnpm install:hooks       # 装 git 钩子并注册 i18n merge driver
```

## 惯例

- 每个非平凡变更在同一 PR 内新增或更新至少一条 Agent Note（[规则](.agents/notes/README.md)）。
- 前端不加 UI 框架；依赖只进 `dependencies` 且须是构建期可打包的库，禁止任何 CDN/运行时加载。
- 插件只经宿主服务触达系统能力（`src/plugins/` 禁 import `@tauri-apps/*`，`pnpm verify:layering` 机械校验）。
- 本地文件访问只走 `src-tauri/src/lib.rs` 的命令 + asset protocol，扩展名分派在 Rust 侧。
- 文档现状优先：写"现在是什么"，不写"以前是什么"；变更史进 Agent Note 或 commit。
- TS 导出与 Tauri 命令必须带文档注释（契约语义，命令目录原料）；门禁校验。
- 常驻文档中英成对（三件套）：改任一侧须最小修补另一侧并重录，围栏与生成区逐字复制不翻译；契约见 [docs/i18n/README.md](docs/i18n/README.md)。
- 提交信息用中文，正文说明动机；门禁脚本改动同步更新本文件命令清单。

## 密钥

仓库不存密钥；`.env` 已 gitignore 且产品不得读取。
