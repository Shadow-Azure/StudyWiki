# Agent Note: macOS DMG 安装启动门禁

Status: implemented

[English](2026-10-13-macos-package-gate.en.md) | 中文

## Problem

macOS 构建成功不代表用户双击 DMG 后能启动应用。实测产物缺少有效资源封条，`codesign` 失败，Launch Services 标准打开返回 `kLSNoExecutableErr`。以 `.app` 结尾的 bundle identifier 还会和应用包扩展名混淆。

## Decision

Bundle identifier 改为 `dev.studywiki.desktop`，macOS bundle 显式使用 ad-hoc 签名。新增打包门禁把 DMG 挂载到隔离目录、复制应用、校验关键结构、Info.plist 身份和 `codesign --deep --strict`，再用 Finder 同源的 `open -n -g` 启动，确认新进程存活后清理。该门禁进入 PR macOS CI 和 release macOS 上传前链路。

## Alternatives considered

- 只检查 DMG 非空：无法发现签名和 Launch Services 问题。否。
- 只调用二进制文件启动：绕过应用包注册和资源封条校验，不能代表双击路径。否。
- 继续要求开发者证书：无证书分发时仍会退化为未签名 bundle。否。

## Consequences

- PR 和 release 会在 macOS 安装链路损坏时失败，CI 时间增加。
- 非 macOS 安装产物仍缺少同等标准启动冒烟。
- 若未来启用真实开发者签名，只需替换 identity 配置，不必重建门禁。
