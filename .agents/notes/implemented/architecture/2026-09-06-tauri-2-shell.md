# Agent Note: Tauri 2 作为桌面壳

Status: implemented

[English](2026-09-06-tauri-2-shell.en.md) | 中文

## Problem

StudyWiki 需要一个跨 macOS/Windows/Linux 的桌面客户端，同时满足硬约束：产物完全不依赖用户环境（不预装运行时、完全离线）。壳层选型决定体积、依赖面与发布流水线形态。

## Decision

采用 Tauri 2：Rust 壳 + 系统 webview 渲染前端（TypeScript + Vite，无 UI 框架）。本地文件访问收敛为两条自定义命令（`list_library`、`read_text_file`）+ asset protocol；Windows 侧 WebView2 用 offlineInstaller 内嵌补齐；Linux 用 AppImage 携带 webkit2gtk。前端 markdown-it 构建期打包，`html: false`。

## Alternatives considered

- **Electron**：自带 Chromium，环境无关性最彻底，但产物 ~150MB、内存占用高，且引入整个 Node 运行时作为攻击面。环境无关的收益花在了不需要的地方。
- **内嵌 Chromium 的 Tauri 变体 / Wails+webview2**：同等或更差的可移植性，社区分叉维护成本。
- **纯原生（Qt/SwiftUI/WinUI 三套）**：无 webview 依赖，但三份 UI 代码与三份 Markdown 渲染实现，超出"简单架子"的范围。

## Consequences

- 系统 webview 成为唯一平台依赖，已在 [docs/environment-independence.md](../../../../docs/environment-independence.md) 登记为显式豁免；webview 引擎差异（渲染/解码能力）是跨平台测试的固定关注点。
- 视频/图片解码依赖系统 webview 支持的格式（mp4/webm/mov 等常见格式可用，冷门编码可能缺席）。
- 发布流水线需三平台构建矩阵（见 [.github/workflows/release.yml](../../../../.github/workflows/release.yml)）。
