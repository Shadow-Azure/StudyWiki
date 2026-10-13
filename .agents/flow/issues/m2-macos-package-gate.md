# macOS DMG 安装启动门禁与 bundle 身份修复

[English](m2-macos-package-gate.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P1
status: ready
scope:
  - .agents/flow/issues/m2-macos-package-gate.*
  - .agents/flow/milestones/m2-ai-agent-host.*
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - AGENTS.md
  - scripts/verify-env-independence.*
  - scripts/verify-macos-package.mjs
  - scripts/verify-macos-package.spec.mjs
  - package.json
  - src-tauri/tauri.conf.json
  - docs/release-checklist.*
  - .agents/notes/**
adr: []
github:
  number: 55
  url: https://github.com/Shadow-Azure/StudyWiki/issues/55
```

## 背景

Smoke 实测 DMG 可以生成和挂载，`.app` 内的二进制、sidecar 与资源也存在；但安装后的 bundle 缺少 sealed resources，`codesign --verify` 失败，Launch Services 标准打开报 `kLSNoExecutableErr`。这说明编译链路可用，而 macOS bundle 身份、签名封条和标准启动验证链路不完整。现有 release 工作流只做产物非空检查，无法拦截这类用户双击安装后失败的问题。

## 目标

- 使用不以 `.app` 结尾的稳定 reverse-DNS bundle identifier，消除与 macOS 应用包扩展名的冲突。
- 要求 macOS bundle 使用 ad-hoc identity 显式签名，形成完整的资源封条；无开发者证书分发时也保持 Finder/Launch Services 可识别。
- 新增机械打包门禁：挂载 DMG、复制 app 到隔离目录、校验 Info.plist 与 codesign，再通过标准 `open` 启动并清理进程。
- 把该门禁接入 PR macOS lane 和 release macOS lane；在产物上传前失败即中止。

## 验收

- `verify-env-independence` 机械拒绝以 `.app` 结尾的 bundle identifier，配置约束有 UT。
- `verify-macos-package` 脚本覆盖 DMG 查找、安装包布局、codesign 校验和标准启动路径，辅助逻辑有 UT。
- 本地 macOS DMG 打包 smoke 通过，产物能通过 codesign 和 `open` 验证。
- PR/release CI 的 macOS lane 执行打包门禁，推送后远端 CI 全绿。
