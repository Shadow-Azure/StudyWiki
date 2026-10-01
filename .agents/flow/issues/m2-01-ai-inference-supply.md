# 模型供给定论与推理服务

[English](m2-01-ai-inference-supply.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: done
scope:
  - .agents/flow/issues/m2-01-ai-inference-supply.*
  - .agents/flow/milestones/m2-ai-agent-host.*
  - .agents/plans/**
  - src/**
  - tests/**
  - src-tauri/**
  - src/host/**
  - src/plugins/**
  - docs/environment-independence.*
  - docs/architecture.*
  - docs/commands.*
  - package.json
  - scripts/dep-allowlist.json
  - scripts/code-map.manifest.json
  - scripts/doc-budgets.manifest.json
  - .agents/notes/**
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 28
  url: https://github.com/Shadow-Azure/StudyWiki/issues/28
```

## 背景

环境无关性与 AI 推理直接冲突；已定论「可配置远程 endpoint + 自托管闭环」，需落地配置契约并登记豁免。

## 目标

- 落地 LLM/VLM/ASR 三类 endpoint 配置契约（base URL / model / key）。
- 在 environment-independence.md 登记豁免并落 ADR。

## 验收

- 三类 endpoint 可配置、可探测，错误语义明确；产品不内置密钥。
- 豁免与 ADR 已登记，`pnpm verify:env-independence` 绿。

落地记录（2026-10-01）：

- 配置契约：`~/.studywiki/settings.json`（chat/asr 两 kind、base URL/model/key、capabilities.vision、defaultModel），原子写 0600，损坏/版本过高 fail-loud。
- 探测与错误语义：`llm_probe` 走 OpenAI 兼容 `GET /models`；错误归一词表 UNREACHABLE / UNAUTHORIZED / TIMEOUT / RATE_LIMITED / BAD_RESPONSE / ENDPOINT_UNKNOWN / INVALID_CONFIG + 前端路由 MODEL_* 三码（cargo mock server 六例）。
- 产品不内置密钥：预设表只有 baseUrl/模型名模板；key 由用户填入，settings.json 明文 + 0600（与 Claude Code / Codex / dsh 同水位），list 命令脱敏。
- 豁免与 ADR：[environment-independence.md](../../../docs/environment-independence.md) 豁免表链接 [ADR](../../../.agents/notes/proposed/architecture/2026-09-19-ai-inference-supply.md)（保持 proposed，随本 PR 合并转 implemented）；[落地 note](../../../.agents/notes/implemented/feature/2026-10-01-ai-inference-supply.md) 已转 implemented。
- 门禁：`cargo test` 46/46；`vitest` 422/423（唯一失败为 gen-plugin-template 自测的 npm 缓存环境问题，与本改动无关，main 同样复现）；`verify:env-independence` / `verify:dep-audit` / `verify:layering` / `verify:flow` / `verify:commands` / `lint:docs` 全绿。
