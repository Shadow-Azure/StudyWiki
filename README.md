# StudyWiki

[English](README.en.md) | 中文

本地资料库客户端：阅读 Markdown 笔记 + 播放本地视频，**完全离线、产物不依赖运行环境**（约束定义见 [AGENTS.md](AGENTS.md)，机制见 [docs/environment-independence.md](docs/environment-independence.md)）。

## 开发

```sh
pnpm install        # 前端依赖
pnpm tauri dev      # 启动开发模式（自动拉起 Vite）
pnpm tauri build    # 构建发布产物（dmg / nsis / appimage）
```

前置：Node ≥ 22、pnpm ≥ 10、Rust stable。macOS 构建需要 Xcode CLT，Windows 需要 MSVC，Linux 需要 webkit2gtk 开发包（仅**构建**需要；产物见上文约束）。

## 文档与门禁

- 文档维护机制：[docs/README.md](docs/README.md)
- 双语配对契约：[docs/i18n/README.md](docs/i18n/README.md)
- Tauri 命令目录：[docs/commands.md](docs/commands.md)
- CI 门禁：[.github/workflows/ci.yml](.github/workflows/ci.yml)
- 发布门禁：[.github/workflows/release.yml](.github/workflows/release.yml)
- 设计决策记录：[.agents/notes/](.agents/notes/README.md)

```sh
pnpm lint:docs     # 快速文档门禁（无构建）
pnpm verify:docs   # 全量文档门禁
pnpm verify:release # 发布前全量校验（含环境无关性检查）
```

## 结构

```
src/          前端（TypeScript + Vite，无 UI 框架）
src-tauri/    Rust 侧（Tauri 2 桌面壳 + 两条自定义命令）
docs/         工程文档（分层，见 docs/AGENTS.md）
.agents/notes/ 决策记录（Agent Notes）
scripts/      门禁脚本（node，零依赖）
.github/      CI / 发布流水线
```
