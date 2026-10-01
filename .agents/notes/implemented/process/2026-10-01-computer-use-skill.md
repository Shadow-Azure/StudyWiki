# Agent Note: Computer Use 通用调用约定

Status: implemented

[English](2026-10-01-computer-use-skill.en.md) | 中文

## Problem

Codex 的 Computer Use 不暴露独立的点击、输入、截屏工具，而是要经 `node_repl` 动态加载 `@oai/sky`。若缺少仓库内说明，后续会话容易把工具当成一组不存在的一级动作，或复用已失效的 accessibility 编号。

## Decision

新增 `.agents/skills/computer-use/SKILL.md`，固化通用调用契约：动态导入、应用寻址、`get_app_state` 读面、截图呈现、常用动作、失败语义、授权边界和小步执行节奏。它只说明如何使用 Computer Use，不绑定某个产品 smoke 流程。

## Alternatives considered

- 只保留全局 skill：缺少仓库内可发现性，且无法让本项目会话稳定找到入口。否。
- 把某个桌面测试流程写进 skill：会把通用工具说明耦合到当前任务，降低复用性。否。
- 依赖会话记忆：Computer Use 的调用面与索引生命周期容易记错。否。

## Consequences

- 需要查看、点击、输入或截屏桌面 UI 时，显式调用 `$computer-use`。
- 每次界面变化后必须重新读取 accessibility 树并解析新编号。
- 涉及变更、密钥或系统设置时，先确认授权再动作；工具只作为桌面 UI 的通用操作面。
