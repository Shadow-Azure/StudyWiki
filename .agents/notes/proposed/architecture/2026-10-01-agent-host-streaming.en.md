# Agent Note: Agent host streaming inference pipeline and chat slot

Status: proposed

English | [中文](2026-10-01-agent-host-streaming.md)

## Problem

The inference service landed in m2-01 only offers non-streaming chat: the full answer returns at once. Answers in study scenarios are routinely long (walkthroughs, summaries, note organization), so non-streaming means tens of seconds of dead waiting; and the agent surface m2-02 promises external plugins still lacks two pieces: the chat UI slot and the context-sourcing interface. Multimodal input (screenshots, blackboard photos, lecture audio) is the natural input of study scenarios, so the message model must carry it natively.

## Decision

### Streaming pipeline

- Rust hand-rolls SSE line parsing (blocking reads via ureq, `data:` lines + blank-line dispatch + multi-data-line joining) with no new dependencies. `[DONE]` is the transport gate and the Chat Completions `finish_reason` is the semantic terminator; trailing events remain consumable after either arrives, and EOF with neither is the `STREAM_CLOSED` truncation error (truncation must never pass for a normal ending).
- Chunks reach the frontend over `tauri::ipc::Channel`: each invoke gets its own channel, so windows are isolated by construction; the frontend dropping the Channel fails the Rust send and stops the read. User-initiated abort sets a flag through `llm_chat_abort(streamId)`, and the read loop stops before the next chunk.
- The `llm_chat_stream(req, channel)` command spawns a worker thread to read the stream; the invoke Promise resolves when the stream settles — the channel delivers deltas, await delivers settlement.

### Chunk vocabulary and assembly

Take the minimal set mainstream agent implementations converged on: `text-delta` / `reasoning-delta` / `tool-call-delta` / `usage` / `finish` / `error`. `tool-call-delta` is defined but not consumed this round (the m2-03 tool loop will need it; the protocol carries no rework). Reasoning takes the first non-empty field among `reasoning_content` → `reasoning` → `reasoning_text` (compatible endpoints spell it differently); requests carry `stream_options: {include_usage: true}` and tolerate usage landing on the choice. The host streaming service owns one frontend assembler per stream and exposes its single chunk → message snapshot through `ChatStreamHandle.snapshot()`; consumers render that read-only view, never raw deltas, and never duplicate assembly state; on interruption a half-received tool call is dropped (no fabricated result can complete it) while text/reasoning parts are kept. Partial text stays view-only and never enters later model context: error, stop, and finish-less endings are kept out of session history, and only an answer carrying a finish_reason is recorded — replaying failed attempts triggers compatibility errors and anchors retry into continuation (aligned with pi's transform-layer filtering of error/aborted messages and dsh's attempt≠message split; the decision also excludes stop partials, stricter than dsh).

### Multimodal message model

Message content grows from a plain string to a part array; the media wire tag is directly `image` / `audio` (Rust dispatches through enum variants, with no free-form string kind), and a media part's source is a union: `path` (local file; Rust reads it at egress, base64-encodes it into the request body, path canonicalized once, then that same path is root-checked and read) / `inline` (base64 from clipboard paste and drag-drop, never persisted) / `url` (remote URL passed through verbatim for the provider to fetch; the client never downloads). Capability gating runs before sending: endpoint `capabilities` gains `audio`, and a message carrying image/audio to a model without the matching capability fails with `UNSUPPORTED_CONTENT` before sending. Attachment size hard caps: 20 MB per item / 100 MB per request (decoded estimate); the frontend rejects pasted/dropped files before reading bytes and the Rust egress re-checks metadata/data length, both failing with a clear `UNSUPPORTED_CONTENT`. No compression/normalization — pi/dsh-style resizing exists because their providers enforce 5 MB-class limits; on OpenAI-compatible endpoints with a 20 MB image cap, refusing outright is more honest and avoids image-processing dependencies.

### Chat slot and rendering

- Add the generic right-sidebar slot `sidebar.right`; the built-in `app-chat` plugin is its first registrant, and later agent plugins and external plugins share the slot. The host-shared markdown renderer lives in `src/ui/markdown.ts`.
- Streaming rendering batches by rAF and re-parses the full text with markdown-it (`html: false` unchanged): multiple deltas in one frame trigger a single re-render. Reasoning blocks are collapsed by default and fold away once streamed; interruption keeps the partial content and marks it "interrupted".
- Snapshot consumption goes through `handle.snapshot()`; the plugin owns only its UI loop and rendering, not assembly state.
- Context-sourcing interface: activeFile / workspace snapshot come through the workspace facade (the wiki index belongs to m2-04).
- The panel's visual language follows the claude.ai message conventions: neutral soft bubbles (no border), rule-marked collapsible reasoning, code blocks with a language header, a containerized composer, and a pill model selector — all on existing tokens, following light/dark.
- The first 📎 control is disabled: the host has no file-dialog surface yet, so attachments use only paste/drop into inline sources, and the button states that limit.

## Alternatives considered

- Frontend fetch + SSE straight to the endpoint: bypasses the Rust egress layer and breaks the "Rust = persistence + thin egress" ruling; rejected.
- Tauri `emit` broadcast instead of Channel: broadcast needs hand-rolled stream-id filtering, risks crosstalk across windows, and has weaker backpressure and drop semantics than Channel; rejected.
- Block-level incremental markdown rendering (re-render only the unclosed tail block): saves CPU but introduces the invariant that closed blocks never re-parse; at chat scale a full re-parse is milliseconds, rejected and kept as a later optimization.
- A durable attachment store (content addressing + cross-session replay + offload policy): m2-02 sessions are in-memory with no replay need, so the machinery is too heavy; rejected, inline attachments stay unpersisted.
- A single-source model of pure path or pure inline: path cannot cover clipboard/drag-drop, and inline doubles large audio files across the JS heap and IPC; the union takes the best of each.

## Consequences

- The guard whitelist for `llm` gains `chatStream`; `SlotName` gains `sidebar.right`; the commands.md generated section gains `llm_chat_stream` / `llm_chat_abort`; the normalized error vocabulary gains `STREAM_CLOSED` / `UNSUPPORTED_CONTENT`.
- Final semantics: abort is the explicit `llm_chat_abort` command plus a send-failure backstop, not literal Channel-drop GC; the sole assembly point lives in host `llm_stream.ts`, and `ChatStreamHandle.snapshot()` also resolves the earlier "partial snapshot" wording.
- Attachment path keeps a local race window between canonicalize authorization and the read (triggering requires a malicious local process — accepted under the single-user desktop threat model); canonicalize failures uniformly report "not inside the workspace" — coarse diagnostics but fail-closed; error-vocabulary refinement and open-level symlink protection belong to the m2-03 tool-write hardening window.
- Streamed single-event payloads carry a byte cap: optional `streamEventLimitBytes` in `settings.json`, defaulting to 100 MiB; exceeding it cuts the stream with `BAD_RESPONSE` (the guard for the stream's only unbounded buffer).
- Attachment request size is double-gated (20 MB per item / 100 MB aggregate) and not yet configurable in `settings.json`; revisit configuration once real workloads demand it.
- Debts: `tool-call-delta` has no consumer this round; sessions are not persisted (reopening clears them); block-level incremental rendering remains a performance optimization; remote url sources depend on provider reachability, and a self-hosted endpoint that cannot reach the public internet reports through the transport error semantics.
- A late `llm_chat_abort` (stop racing stream completion) leaves its streamId in the process-level abort registry until exit: no functional impact (every stream mints a fresh UUID; a stale id is never queried again) and roughly a hundred bytes each — a structural artifact of string-keyed cross-IPC addressing (pi/dsh avoid it because their cancel handles live and die with the activity). TTL sweeping only if ever needed.
- The `input_audio` wire shape is fixed to OpenAI's official dialect (raw base64 plus a `format` field); MiMo v2.5 ASR verifiably requires a data-URI-prefixed `data` with no `format` field (shenlun script validated against the live endpoint in 2026-08; pyvideotrans and Codewhale match), so audio to MiMo ASR as configured today would 400 — vendor dialect dispatch (an `audioDialect` on presets) is deliberately deferred until a real integration needs it. TTS (top-level `audio` parameter and `message.audio` output) is unimplemented this round and remains follow-up debt.
