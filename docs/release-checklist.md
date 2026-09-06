# 发布门禁清单

> 类型：参考 | 层级：发布流程。release.yml 机械执行 1–5；6–8 目前人工，逐步机械化。

## 机械门禁（CI 自动）

1. **CI 全绿**：`ci.yml` 在目标 commit 上通过（fmt / clippy / test / tsc / vite build / doc-sync）。
2. **版本一致**：tag、`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 四处版本号一致（`scripts/verify-release.mjs`）。
3. **环境无关性**：`pnpm verify:env-independence` 在产物上通过（webview 离线安装器、无外部 URL、源无网络引用）。
4. **三平台产物**：dmg（aarch64/x86_64）、nsis（x64）、appimage（x64）全部产出且非空。
5. **产物冒烟**：每个产物能启动并加载空状态（当前为构建成功 + bundle 校验；启动自动化为已知欠账）。

## 人工清单（出 draft release 前过一遍）

6. 在无 Node/Rust 的干净机器上安装并打开一个真实资料库（md + 视频各一）。
7. 断网状态下重复上一条。
8. 确认 [environment-independence.md](environment-independence.md) 豁免表无未评审新增。

## 已知欠账

- 产物启动冒烟未自动化（候选：CI 矩阵 + 虚拟显示）。
- Rust 侧动态链接扫描（otool/ldd）未进门禁。
