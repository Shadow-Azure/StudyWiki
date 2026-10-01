# Model supply decision and inference service

English | [中文](m2-01-ai-inference-supply.md)

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
  - .agents/skills/**
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 28
  url: https://github.com/Shadow-Azure/StudyWiki/issues/28
```

## Background

Environment independence conflicts directly with AI inference; the decision is "configurable remote endpoint + self-hosted closed loop", which needs its configuration contract landed and the exemption registered.

## Goals

- Land the LLM/VLM/ASR endpoint configuration contract (base URL / model / key).
- Register the exemption in environment-independence.md and file the ADR.

## Acceptance

- The three endpoint kinds are configurable and probeable, with clear error semantics; the product ships no key.
- The exemption and ADR are registered, and `pnpm verify:env-independence` is green.

Landing record (2026-10-01):

- Config contract: `~/.studywiki/settings.json` (chat/asr kinds, base URL/model/key, capabilities.vision, defaultModel), atomic 0600 writes, fail-loud on corruption or unsupported version.
- Probing and error semantics: `llm_probe` uses the OpenAI-compatible `GET /models`; the normalized vocabulary is UNREACHABLE / UNAUTHORIZED / TIMEOUT / RATE_LIMITED / BAD_RESPONSE / ENDPOINT_UNKNOWN / INVALID_CONFIG plus the frontend routing MODEL_* triad (six cargo mock-server cases).
- No built-in keys: the preset table only ships baseUrl/model-name templates; the user enters the key into settings.json (plaintext + 0600, same water level as Claude Code / Codex / dsh) and the list command is redacted.
- Exemption and ADR: the [environment-independence.md](../../../docs/environment-independence.en.md) exemption table links the [ADR](../../../.agents/notes/proposed/architecture/2026-09-19-ai-inference-supply.en.md) (stays proposed until this PR merges, then flips to implemented); the [landing note](../../../.agents/notes/implemented/feature/2026-10-01-ai-inference-supply.en.md) is implemented.
- Gates: `cargo test` 46/46; `vitest` 422/423 (the single failure is the gen-plugin-template self-test hitting an npm cache environment issue, unrelated to this change and reproducible on main); `verify:env-independence` / `verify:dep-audit` / `verify:layering` / `verify:flow` / `verify:commands` / `lint:docs` all green.
