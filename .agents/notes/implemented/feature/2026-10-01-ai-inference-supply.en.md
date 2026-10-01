# Agent Note: Inference Supply Landing: Config Contract, Thin Rust Capability Layer, and the ~/.studywiki User Config Root

Status: implemented

English | [中文](2026-10-01-ai-inference-supply.md)

## Problem

The [AI inference supply ADR](../../proposed/architecture/2026-09-19-ai-inference-supply.en.md) settled the direction — user-explicitly-configured remote endpoints, OpenAI-compatible protocol, no built-in keys — but direction only: where config lives, its schema, who sends HTTP, how plugins reach inference, and the key-storage stance all lack contracts. m2-01 (issue #28) requires landing this layer as an implementable foundation, or the m2-02/m2-03 agent host and basic agent have nothing to build on.

## Decision

### Layering: thin Rust capability layer + frontend host service + built-in config plugin

| Layer | Owns | Does not |
|---|---|---|
| Rust (thin capability layer) | settings.json persistence and one-shot migration, HTTP egress (the webview has CORS and cannot reach vendor APIs), 0600 permissions, error normalization | Sessions, routing, retries, any agent logic |
| Frontend host service `ctx.llm` (seventh service) | Model routing (`chat({model})` resolves the owning endpoint), redacted listing, inject whitelist | Holding keys, sending network requests |
| Built-in `llm-settings` plugin | Pure UI: vendor preset instantiation, key entry, probing | Business logic |

Call shape: a plugin calls `ctx.llm.chat({model, messages})` → the frontend routes to `(endpointId, model)` → invokes the Rust `llm_chat` command → the already-vendored `ureq` (rustls) sends HTTPS → normalized errors returned along the same path. Non-streaming is one IPC round trip; streaming arrives in m2-02 via a Tauri `ipc::Channel` as an incremental change with the call shape unchanged.

Rationale (compared with dsh): dsh keeps agent/llm/tools entirely in TS (`ctx.llm` / `ctx.tools` / `ctx.agents` as three orthogonal services; even the agent loop is just a plugin), with native code only for capability isolation (landlock-run); the m2-02 issue scope already excludes `src-tauri/**`; the plugin contract is single-file zero-dependency JS.

### User config root `~/.studywiki/`

One unified user config directory: Tauri `app.path().home_dir()` + `.studywiki` (zero new Cargo dependencies), identical shape on all three platforms (`C:\Users\<name>\.studywiki\` on Windows), no environment-variable branches, matching the discoverability of `~/.claude` / `~/.codex`. The existing `plugins.json` and `plugins/` under `app_config_dir()` migrate as well; `plugin_dir` / `read_manifest` / `write_manifest` all switch to `studywiki_dir()` in the new `config.rs` module. One-shot startup migration: if the old directory has an entry and the new one lacks it, move it; when both exist the new directory wins and the old entry is left in place (migration is idempotent and re-entrant).

### Config contract `~/.studywiki/settings.json`

```jsonc
{
  "version": 1,
  "endpoints": [
    {
      "id": "deepseek",                     // 唯一，用户可改
      "name": "DeepSeek",                   // 显示名
      "kind": "chat",                       // chat | asr；LLM/VLM 共用 chat
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-…",                     // 明文，文件 0600
      "models": [
        { "id": "deepseek-v4-pro",   "capabilities": ["text", "vision"] },
        { "id": "deepseek-v4-flash", "capabilities": ["text"] }
      ]
    }
  ],
  "defaultModel": "deepseek-v4-flash"       // 未指定 model 时的兜底
}
```

- Model routing (inside the frontend host service): `ctx.llm` resolves the owning endpoint by `model` id, then hands `(endpointId, model)` to Rust; the same id under multiple endpoints → `MODEL_AMBIGUOUS`; no owner → `MODEL_UNKNOWN`; a missing model falls back to `defaultModel`, and if that is absent → `MODEL_UNSPECIFIED`.
- `capabilities` containing `vision` marks a VLM; `kind: "asr"` follows the `/v1/audio/transcriptions` contract — this round lands only the schema and probing, with the tool itself in m3-01.
- Writes are atomic (tmp + rename) with 0600 permissions; parse failures fail loud and never silently overwrite the user's file.

### Rust command surface (new `config.rs` + `llm.rs` modules; reusing the vendored ureq rustls, zero new Cargo dependencies)

| Command | Semantics |
|---|---|
| `llm_list_presets` | Returns the vendor preset table; baseUrls exist only on the Rust side (`verify-env-independence` forbids external URLs under `src/**`) |
| `llm_list_endpoints` | Returns the redacted config (`apiKey` → `hasKey` + masked preview); no path ever exposes a full key |
| `llm_upsert_endpoint` / `llm_remove_endpoint` | Atomically writes settings.json |
| `llm_probe(endpoint_id)` | Lightweight probe via the OpenAI-compatible `GET /models`; success returns latency in ms |
| `llm_chat({endpointId, model, messages, …})` | Non-streaming chat/completions, pure transport |

Normalized error codes (one shared vocabulary across the whole chain): Rust transport layer — `UNREACHABLE` / `UNAUTHORIZED` / `TIMEOUT` / `RATE_LIMITED` / `BAD_RESPONSE` / `ENDPOINT_UNKNOWN`; upsert validation — `INVALID_CONFIG`; frontend routing layer — `MODEL_UNKNOWN` / `MODEL_AMBIGUOUS` / `MODEL_UNSPECIFIED`. Plugins handle a single set of codes.

### Frontend host service and built-in plugin

`src/host/llm.ts` (deps injectable) mounts `ctx.llm` with facade `list / upsert / remove / probe / chat`; the external-plugin inject whitelist exposes only `list / probe / chat`, writes are reserved for built-in plugins. The built-in `llm-settings` plugin: topbar entry + panel; a vendor preset table (build-time static templates, not locked, served via `llm_list_presets`) — Zhipu GLM (`https://open.bigmodel.cn/api/paas/v4`, glm-5.3 / glm-5.3-flash), DeepSeek (`https://api.deepseek.com/v1`, deepseek-v4-pro / deepseek-v4-flash), Kimi (`https://api.moonshot.cn/v1`, kimi-k3), MiniMax (`https://api.minimaxi.com/v1`, minimax-m3), and custom OpenAI-compatible; picking a preset prefills baseUrl + model list (editable — add/remove/rename), the user only must enter an apiKey; each model can be flagged `vision`; saved endpoints can be probed in one click.

### Key-storage stance

Plaintext in settings.json, at the same water level as Claude Code (plaintext token in `~/.claude/settings.json` env), Codex (`~/.codex/auth.json`), and dsh (literal `apiKey` as a first-class citizen). Hardening: 0600 file permissions; the command surface is write-only for keys (list is redacted); the external-plugin whitelist excludes write commands. The "no secrets in the repo" constraint is unaffected (user directory).

### Gates and docs

Register the exemption "AI inference via user-explicitly-configured remote endpoints" in `docs/environment-independence.md` with a link to the ADR; the ADR note (linked in Problem above) moves to implemented. Update `docs/architecture.md`: component tree, data flow, key decisions (`~/.studywiki`, plaintext keys + 0600, thin Rust capability layer). Persistent docs are re-recorded as bilingual triples; `pnpm gen:commands` rebuilds the command catalog; gates `verify:env-independence` / `verify:dep-audit` / `verify:layering` / `verify:docs` all green.

### Scope cuts

`llm_chat` is non-streaming (streaming belongs to m2-02); ASR lands only the contract and probing (the tool belongs to m3-01); no multi-protocol adapter layer, no failover, no usage metering.

## Alternatives considered

- **Agent host on the Rust side**: dynamic-library plugins break the single-file JS contract and invite ABI/signing hell; embedding a JS engine rebuilds a runtime, violates environment independence, and spawns a second plugin system. Both rejected (dsh agrees: agents live in TS; native only isolates capabilities).
- **Frontend fetch directly to vendor APIs**: blocked by webview CORS; tauri-plugin-http is its proxied variant, with weaker streaming and error semantics than owning ureq.
- **OS keychain for keys (keyring crate)**: a higher security water level, but the user chose consistency with the plaintext-config mechanism of Claude Code / Codex / dsh, lowering migration and debugging cost; 0600 + a write-only command surface remain as hardening.
- **Keeping `app_config_dir()` for config**: on macOS it hides deep inside `~/Library/Application Support`, where users can neither find nor edit it. Rejected.
- **Multi-protocol adapter layer (copying dsh's `LlmAdapter`)**: the ADR locks the single OpenAI-compatible protocol; GLM/DeepSeek/Kimi/MiniMax all offer compatible endpoints, so adaptation degenerates to config differences. YAGNI.

## Consequences

- The m2-02/m2-03 agent loop will be a frontend plugin invoking inference through `ctx.llm`; when streaming arrives, only the Rust `llm_chat` return path changes (Channel), the call shape stays.
- `~/.studywiki/` becomes the fixed home for all future user-level config (themes, keybindings, etc.); the migration logic serves old installs once and then idles idempotently.
- A plaintext key file leaks if the whole machine is copied — the same water level as the reference tools; if the security bar ever rises, the keychain option can be reopened in a later note.
- ASR endpoints (`kind: "asr"`) can be written into settings.json and probed this round, but have no consumer until m3-01.
