# Agent Note: Agent host streaming inference pipeline and chat slot

Status: proposed

English | [中文](2026-10-01-agent-host-streaming.md)

## Problem

The inference service landed in m2-01 only offers non-streaming chat: the full answer returns at once. Answers in study scenarios are routinely long (walkthroughs, summaries, note organization), so non-streaming means tens of seconds of dead waiting; and the agent surface m2-02 promises external plugins still lacks two pieces: the chat UI slot and the context-sourcing interface. Multimodal input (screenshots, blackboard photos, lecture audio) is the natural input of study scenarios, so the message model must carry it natively.

## Decision

### Streaming pipeline

- Rust hand-rolls SSE line parsing (blocking reads via ureq, `data:` lines + blank-line dispatch + multi-data-line joining + the `[DONE]` marker) with no new dependencies. EOF before `[DONE]` is the `STREAM_CLOSED` truncation error (truncation must never pass for a normal ending).
- Chunks reach the frontend over `tauri::ipc::Channel`: each invoke gets its own channel, so windows are isolated by construction; the frontend dropping the Channel fails the Rust send and stops the read. User-initiated abort sets a flag through `llm_chat_abort(streamId)`, and the read loop stops before the next chunk.
- The `llm_chat_stream(req, channel)` command spawns a worker thread to read the stream; the invoke Promise resolves when the stream settles — the channel delivers deltas, await delivers settlement.

### Chunk vocabulary and assembly

Take the minimal set mainstream agent implementations converged on: `text-delta` / `reasoning-delta` / `tool-call-delta` / `usage` / `finish` / `error`. `tool-call-delta` is defined but not consumed this round (the m2-03 tool loop will need it; the protocol carries no rework). Reasoning takes the first non-empty field among `reasoning_content` → `reasoning` → `reasoning_text` (compatible endpoints spell it differently); requests carry `stream_options: {include_usage: true}` and tolerate usage landing on the choice. The frontend assembler is the single chunk → message assembly point; consumers render the assembled partial snapshot, never raw deltas; on interruption a half-received tool call is dropped (no fabricated result can complete it) while text/reasoning parts are kept.

### Multimodal message model

Message content grows from a plain string to a part array; the media wire tag is directly `image` / `audio` (Rust dispatches through enum variants, with no free-form string kind), and a media part's source is a union: `path` (local file; Rust reads it at egress, base64-encodes it into the request body, path canonicalized once, then that same path is root-checked and read) / `inline` (base64 from clipboard paste and drag-drop, never persisted) / `url` (remote URL passed through verbatim for the provider to fetch; the client never downloads). Capability gating runs before sending: endpoint `capabilities` gains `audio`, and a message carrying image/audio to a model without the matching capability fails with `UNSUPPORTED_CONTENT` before sending.

### Chat slot and rendering

- Add the generic right-sidebar slot `sidebar.right`; the built-in `app-chat` plugin is its first registrant, and later agent plugins and external plugins share the slot. The host-shared markdown renderer lives in `src/ui/markdown.ts`.
- Streaming rendering batches by rAF and re-parses the full text with markdown-it (`html: false` unchanged): multiple deltas in one frame trigger a single re-render. Reasoning blocks are collapsed by default and fold away once streamed; interruption keeps the partial content and marks it "interrupted".
- Context-sourcing interface: activeFile / workspace snapshot come through the workspace facade (the wiki index belongs to m2-04).

## Alternatives considered

- Frontend fetch + SSE straight to the endpoint: bypasses the Rust egress layer and breaks the "Rust = persistence + thin egress" ruling; rejected.
- Tauri `emit` broadcast instead of Channel: broadcast needs hand-rolled stream-id filtering, risks crosstalk across windows, and has weaker backpressure and drop semantics than Channel; rejected.
- Block-level incremental markdown rendering (re-render only the unclosed tail block): saves CPU but introduces the invariant that closed blocks never re-parse; at chat scale a full re-parse is milliseconds, rejected and kept as a later optimization.
- A durable attachment store (content addressing + cross-session replay + offload policy): m2-02 sessions are in-memory with no replay need, so the machinery is too heavy; rejected, inline attachments stay unpersisted.
- A single-source model of pure path or pure inline: path cannot cover clipboard/drag-drop, and inline doubles large audio files across the JS heap and IPC; the union takes the best of each.

## Consequences

- The guard whitelist for `llm` gains `chatStream`; `SlotName` gains `sidebar.right`; the commands.md generated section gains `llm_chat_stream` / `llm_chat_abort`; the normalized error vocabulary gains `STREAM_CLOSED` / `UNSUPPORTED_CONTENT`.
- Debts: `tool-call-delta` has no consumer this round; sessions are not persisted (reopening clears them); block-level incremental rendering remains a performance optimization; remote url sources depend on provider reachability, and a self-hosted endpoint that cannot reach the public internet reports through the transport error semantics.
