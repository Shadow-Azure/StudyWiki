# Agent Note: llm-wiki 源探测基础

Status: implemented

[English](2026-10-18-source-probe.en.md) | 中文

## Problem

llm-wiki 后续 ingest 需要判断源文件是否变化。视频和大文件不能每回合整读并哈希，同时探测入口必须与现有文件读域一致，不能绕过窗口 root 与动态授权。

## Decision

`probe_source_file` 复用 `ensure_authorized_read`，返回 `{size, mtimeMs, sha256}`。Rust 以 64 KiB 块流式计算 SHA-256；调用方提供 known 且磁盘 size/mtime 一致时信任 known 的 SHA-256，跳过重读。TS 侧只加 `FilesService.probeSourceFile` facade，插件仍不能直接触达 Tauri API。路径含 `..` 时返回稳定 `PROBE_INVALID_PATH`。

## Alternatives considered

每回合全量重哈希实现最简单，但大视频成本不可接受。完全信任相对路径会让探测绕过路径边界，因此拒绝。只比较 mtime 会漏掉同时间戳内容变化，因此 known 快路径必须同时比较 size 与 mtime。

## Consequences

后续 llm-wiki 任务可以把 `ProbeSample` 作为源变更判断基础；mtime 粒度受文件系统限制，known 失配时必须重算。回归测试用独立 SHA-256 向量核对内容哈希，并以与磁盘 size/mtime 相同但摘要被替换的 known 样本验证快路径确实复用样本；若实现退化为重哈希会失败。配置根不可取得时探测以 `PROBE_UNAUTHORIZED` 拒绝，避免引入另一个越权入口。
