# 环境无关性

[English](environment-independence.en.md) | 中文

> 类型：参考 | 层级：约束唯一 home。定义"完全不依赖环境"的可验证含义；AGENTS.md 只留摘要链到这里。

## 约束定义

发布产物满足以下全部条款，即视为"完全不依赖环境"：

1. **零运行时预装**：用户机器不需要预装 Node、Python、JRE、浏览器、ffmpeg/解码器包或本项目任何开发依赖。
2. **核心与内置插件离线**：全部构建期打包进产物，安装与运行全程不访问网络；禁止 CDN、外链脚本/样式、运行时下载。
3. **行为一致**：不受环境变量、全局配置文件影响；同一版本 + 同一插件集在任意满足 OS 最低版本的机器上行为一致。
4. **自包含安装**：安装器自带其全部前置（见下"系统 webview 边界"）。
5. **外置插件**：用户主动安装的本地资源；安装可联网、仅限 registry tarball 直拉，运行全程离线；一律预打包零依赖单文件，宿主拒载其他形态。

## 系统 webview 边界（唯一的平台依赖）

Tauri 不内嵌浏览器引擎，依赖 OS webview：macOS WKWebView（系统集成）、Linux webkit2gtk（AppImage 携带）、Windows WebView2（Win10/11 预装；老系统由安装器内嵌 offlineInstaller 补齐）。取舍与备选（内嵌 Chromium，100MB+）见 Agent Note。此边界**不视为违反约束**，仅此一项。

## 机械门禁

- `pnpm verify:env-independence`（[scripts/verify-env-independence.mjs](../scripts/verify-env-independence.mjs)）：`tauri.conf.json` 的 Windows `webviewInstallMode` 必须为 `offlineInstaller`；`dist/` 产物无外部资源 URL；`src/` 与 `index.html` 无 `http(s)://` 引用（`docs/` 链接不受限）。
- `pnpm verify:dep-audit`（[scripts/verify-dep-audit.mjs](../scripts/verify-dep-audit.mjs)）：`dependencies` 白名单 diff——未登记包新增即红；传递闭包扫 `node:` 内建引用。
- `pnpm verify:layering`（[scripts/verify-layering.mjs](../scripts/verify-layering.mjs)）：`src/plugins/` 触达 `@tauri-apps/*` 或宿主实现即红（type-only 放行）；`src/` 动态 `import()` / `eval` / `new Function` 只许白名单单条缝（`src/loader/external.ts`，外置插件 blob 装载通道）。
- `pnpm verify:native-links`：otool/ldd 扫发布产物动态链接（release 档，需先 build）。
- 发布流水线在产物上运行上述脚本，红即中止（见 [release.yml](../.github/workflows/release.yml)）。

## 豁免登记

新豁免先在本表登记并附 Note 链接，未登记即红门禁：

| 豁免 | 理由 | 依据 |
|---|---|---|
| 系统 webview 边界（见上） | 体积/维护取舍 | [.agents/notes/implemented/architecture/2026-09-06-tauri-2-shell.md](../.agents/notes/implemented/architecture/2026-09-06-tauri-2-shell.md) |
| 外置插件安装联网（已生效） | 安装 = registry tarball 直拉，运行仍全程离线 | [.agents/notes/implemented/architecture/2026-09-11-phase2-external-plugins.md](../.agents/notes/implemented/architecture/2026-09-11-phase2-external-plugins.md) |

`node:` 内建引用豁免登记在 [scripts/dep-allowlist.json](../scripts/dep-allowlist.json) 的 `nodeRefExempt` 表（不进 bundle 的包内文件），属依赖白名单门禁，不在此重复。

## 已知欠账

- linux 面的 ureq/rustls 链接扫描：纯 Rust 栈理论零新增 dylib（native-links 白名单覆盖系统 C 运行时），待首个真实 linux 发布验证。
