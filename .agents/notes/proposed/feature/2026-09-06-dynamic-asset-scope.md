# Agent Note: 动态收窄 asset protocol scope

Status: proposed

[English](2026-09-06-dynamic-asset-scope.en.md) | 中文

## Problem

`tauri.conf.json` 当前 `assetProtocol.scope: ["**"]`，允许 webview 通过 asset 协议读任意本地文件。用户只授权了一个资料库文件夹，应用却持有全盘读权限——权限面与用户意图不匹配。

## Decision

dialog 返回所选目录后，通过运行时 capability（Tauri 2 `app.asset_protocol().scope()` 动态授权 API）把 scope 收窄到该目录；静态配置改为空 scope。`list_library`/`read_text_file` 两条命令同步改为校验路径在已授权 scope 内。

## Alternatives considered

- **保持 `**`**：现状，见 [docs/environment-independence.md](../../../../docs/environment-independence.md) 已知欠账。
- **命令侧校验、不动 protocol**：视频播放必须走 asset 协议（`<video>` 标签），命令侧校验覆盖不到。

## Consequences

- 落地后删除上述欠账条目，并在架构文档同步事实。
- 子目录授权（资料库内引用库外视频）需明确定义：默认拒绝 + 明确报错。
