# 环境无关性

[English](environment-independence.en.md) | 中文

> 类型：参考 | 层级：约束唯一 home。本文件定义"客户端完全不依赖环境"的可验证含义，AGENTS.md 只放一句摘要并链接到这里。

## 约束定义

发布的客户端（安装包/可执行产物）满足以下全部条款，即视为"完全不依赖环境"：

1. **零运行时预装**：用户机器不需要预装 Node、Python、JRE、浏览器、ffmpeg/解码器包或本项目任何开发依赖。
2. **完全离线**：安装与运行全程不访问网络；前端资源全部在构建期打包进产物，禁止 CDN、外链脚本/样式、运行时下载。
3. **行为一致**：功能不受环境变量、全局配置文件影响；同一版本产物在任意满足 OS 最低版本的机器上行为一致。
4. **自包含安装**：安装器自带其全部前置（见下"系统 webview 边界"）。

## 系统 webview 边界（唯一的平台依赖）

Tauri 不内嵌浏览器引擎，依赖 OS webview：macOS WKWebView（系统集成，无额外动作）、Linux webkit2gtk（由 AppImage 打包携带）、Windows WebView2（仅 Windows 10/11 预装；老系统由安装器内嵌 offlineInstaller 补齐，`tauri.conf.json` 已配置）。这是体积与工程量的有意取舍（备选：内嵌 Chromium，代价 100MB+，见 Agent Note）。此边界**不视为违反约束**，但仅此一项。

## 机械门禁

- `pnpm verify:env-independence`（[scripts/verify-env-independence.mjs](../scripts/verify-env-independence.mjs)）：
  - `tauri.conf.json` 的 Windows `webviewInstallMode` 必须为 `offlineInstaller`；
  - 检查 `dist/` 构建产物中的脚本/样式引用不含外部 URL；
  - 检查 `src/` 与 `index.html` 无 `http(s)://` 资源引用（`docs/` 链接不受限）。
- 发布流水线在产物上运行上述脚本，红即中止（见 [release.yml](../.github/workflows/release.yml)）。

## 豁免登记

引入新豁免须在本表登记并附 Agent Note 链接，未登记的违反会红门禁：

| 豁免 | 理由 | 依据 |
|---|---|---|
| 系统 webview 边界（见上） | 体积/维护取舍 | [.agents/notes/implemented/architecture/2026-09-06-tauri-2-shell.md](../.agents/notes/implemented/architecture/2026-09-06-tauri-2-shell.md) |

## 已知欠账

- `assetProtocol.scope: ["**"]` 过宽：理想方案是 dialog 选中的目录动态注入 scope，需前端配合，暂缓。
- 环境无关门禁尚未覆盖 Rust 侧动态链接检查（`otool`/`ldd` 扫描）；release.yml 的人工清单先顶。
