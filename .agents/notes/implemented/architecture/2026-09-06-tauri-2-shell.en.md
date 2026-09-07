# Agent Note: Tauri 2 as the desktop shell

Status: implemented

English | [中文](2026-09-06-tauri-2-shell.md)

## Problem

StudyWiki needs a desktop client across macOS/Windows/Linux while honoring the hard constraint: the artifact depends on no user environment (no preinstalled runtimes, fully offline). The shell choice determines size, dependency surface, and release-pipeline shape.

## Decision

Adopt Tauri 2: a Rust shell + the system webview rendering the frontend (TypeScript + Vite, no UI framework). Local file access converges on two custom commands (`list_library`, `read_text_file`) plus the asset protocol; on Windows, WebView2 is covered by embedding an offlineInstaller; on Linux, AppImage carries webkit2gtk. markdown-it is bundled at build time with `html: false`.

## Alternatives considered

- **Electron**: ships its own Chromium, the most thorough environment independence, but ~150MB artifacts, high memory use, and the whole Node runtime as attack surface. The independence budget was spent where it wasn't needed.
- **Tauri variants embedding Chromium / Wails+webview2**: equal or worse portability, community-fork maintenance cost.
- **Fully native (Qt/SwiftUI/WinUI ×3)**: no webview dependency, but three UI codebases and three Markdown rendering implementations — beyond a "simple scaffold".

## Consequences

- The system webview is the sole platform dependency, registered as an explicit exemption in [docs/environment-independence.en.md](../../../../docs/environment-independence.en.md); webview engine differences (rendering/decoding) are a standing cross-platform test concern.
- Video/image decoding depends on formats the system webview supports (mp4/webm/mov etc. work; exotic codecs may be missing).
- The release pipeline needs a three-platform build matrix (see [.github/workflows/release.yml](../../../../.github/workflows/release.yml)).
