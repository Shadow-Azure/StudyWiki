# StudyWiki

English | [中文](README.md)

A local library client: read Markdown notes and play local videos, **fully offline, artifacts depend on no runtime environment** (constraint defined in [AGENTS.md](AGENTS.md), mechanics in [docs/environment-independence.en.md](docs/environment-independence.en.md)).

## Development

```sh
pnpm install        # 前端依赖
pnpm tauri dev      # 启动开发模式（自动拉起 Vite）
pnpm tauri build    # 构建发布产物（dmg / nsis / appimage）
```

Prerequisites: Node ≥ 22, pnpm ≥ 10, Rust stable. macOS builds need Xcode CLT, Windows needs MSVC, Linux needs the webkit2gtk dev packages (**build-time only**; for the shipped artifact see the constraint above).

## Docs and gates

- Documentation maintenance mechanics: [docs/README.en.md](docs/README.en.md)
- Bilingual pairing contract: [docs/i18n/README.en.md](docs/i18n/README.en.md)
- Tauri command catalog: [docs/commands.en.md](docs/commands.en.md)
- CI gates: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- Release gates: [.github/workflows/release.yml](.github/workflows/release.yml)
- Design decision records: [.agents/notes/](.agents/notes/README.en.md)

```sh
pnpm lint:docs     # 快速文档门禁（无构建）
pnpm verify:docs   # 全量文档门禁
pnpm verify:release # 发布前全量校验（含环境无关性检查）
```

## Layout

```
src/          前端（TypeScript + Vite，无 UI 框架）
src-tauri/    Rust 侧（Tauri 2 桌面壳 + 两条自定义命令）
docs/         工程文档（分层，见 docs/AGENTS.md）
.agents/notes/ 决策记录（Agent Notes）
scripts/      门禁脚本（node，零依赖）
.github/      CI / 发布流水线
```
