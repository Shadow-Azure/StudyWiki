# Agent Note: Basic agent plugin (m2-03): cordis dual plugins, native tool calling, and durable sessions

Status: implemented

English | [中文](2026-10-04-basic-agent.md)

## Problem

After m2-02 the host has streaming inference and a chat panel, but the model can still only "chat": it cannot read the library, search it, or persist notes. m2-03 upgrades the host into an agent (issue #30, targeting the pi/dsh intersection): multi-turn context + the four tools read/grep/write/edit + note persistence + resumable durable sessions. The design must answer six structural questions at once — where the loop lives, the tool protocol, how grep is supplied (ripgrep under the environment-independence constraint), the write safety model, the session persistence shape, and the relationship with app-chat — while holding the layering discipline and the environment-independence hard constraint.

## Decision

### Positioning: generic tool surface, context driven by interaction

Tools are designed as a generic file agent with no baked-in study context; study scenarios ("summarize the current file", "turn this into a note") are driven by user conversation: the system prompt is assembled fresh each turn, injecting the library-root `AGENTS.md` (when present), the current active file path, and the current approval-mode sentence. Notes have no conventional landing spot — the target path of write/edit is entirely conversation-driven; m2-04's llm-wiki will take over agent behavior by "initializing an AGENTS.md inside the library", and this issue establishes the AGENTS.md injection convention now so the agent side needs zero changes then.

### Modules: cordis dual plugins (aligned with dsh)

- **`src/plugins/agent-core/` (built-in plugin, no UI)**: provides the `ctx.agent` service — the turn loop, the four tools, the approval gate, guardian review, JSONL session persistence, and compaction. `inject: ['llm', 'files', 'workspace']`. Aligned with dsh's "the agent loop itself is a plugin": reuses cordis inject ordering and fiber cleanup (stream handles/AbortControllers are reclaimed on hot reload); m2-04 consumes it via `inject: ['agent']`. Internal writing discipline: core classes take dependencies via constructor injection and never import cordis types, so vitest can drive the full chain with a hand-rolled ctx.
- **`src/plugins/app-agent/` (built-in plugin, pure UI)**: `inject: ['agent', 'slots', 'workspace']`, mounts `sidebar.right`, and replaces app-chat (removed from the module table; reusable modules such as render/attachments move in; directory deleted). Plain chat = a turn without tools, so app-chat's capability is a subset of the superset; two coexisting conversation panels are not kept.
- `src/host/context.d.ts` declaration merging adds the `agent` service type (noted as provided by a built-in plugin, not bootstrap); the files service gains four facades — `grepFiles` / `authorizeReadPath` / `appendSessionEvent` / `deleteSessionFile` — (the four new Rust commands are reached only through host facades, layering unchanged); the external-plugin guard whitelist is unchanged — this issue does not expose agent externally.

### Tool protocol: OpenAI native function calling

- Host `ChatInput` gains a `tools` declaration; the message contract gains assistant `toolCalls` and the `tool` result role; Rust `ChatRequest`/`ChatMessage` are extended to pass through (`tools`, `tool_calls`, `tool_call_id`). The receiving side is ready since m2-02 (`tool-call-delta` is assembled into snapshots); this issue only fills the "in" direction.
- The endpoint capability gate gains a `tools` capability flag (llm-settings checkbox): picking an endpoint without the tools capability in an agent session is explicitly rejected with a hint.
- Text protocols (XML/JSON mixed into prose) are rejected: fragile parsing, painful half-streamed JSON, and voted down by both pi and dsh.

### Loop state machine and message model

- Three message types (all serializable plain data): `user` (content reuses the host multimodal part union) / `assistant` (reasoning, text, toolCalls, usage, finishReason) / `tool` (callId, name, content, isError).
- Log-only events (into the JSONL, never into model context): `approval/asked`, `approval/decided` (with decider and reason), `mode/changed`, `compaction`, session meta — the dsh invariant: policy and approvals never pollute the transcript; the model learns the current mode through the system-prompt mode sentence.
- Turn: `sendMessage` → append the user message → assemble the system prompt fresh + full effective history + the constant four-tool tools declaration (both modes share one declaration; mode only routes approvals) → `chatStream` (rAF-throttled snapshots feed the UI) → on completion append the assistant message → no toolCalls ends the turn; otherwise execute **serially** (each passing the approval gate first), append tool messages one by one, and loop back to assembly. No per-turn iteration cap (aligned with Claude Code/Codex/pi having no hard cap; the runaway escapes are the stop button plus compaction bounding growth).
- Abort and partial-message semantics continue the m2-02 ruling: only a complete answer with finish_reason enters history; partial text from errors/stops stays on screen, never enters context, and is never persisted.

### The four tool semantics

| Tool | Parameters | Behavior |
| --- | --- | --- |
| read | `path`, `offset?`, `limit?` | Absolute path; text returned by line (line-number prefixes for edit targeting), default cap 2000 lines, overlong lines truncated, truncation marked; binary/video/xlsx rejected with an explanation. Outside the authorized set → the out-of-bounds read approval flow |
| grep | `pattern`, `path?`, `glob?`, `ignoreCase?`, `literal?`, `context?`, `limit?` | Subset of pi/dsh parameters, mapped to `rg --json`; `path` defaults to the library root, out-of-bounds → approval; budgets: raw 20 MB / 30 s timeout / default limit 100; error vocabulary `SEARCH_INVALID_PATTERN` / `SEARCH_FAILED` / `SEARCH_RAW_OUTPUT_OVERFLOW` / `SEARCH_ABORTED` |
| write | `path`, `content` | Confined to the authorized set, whole-file write (create/overwrite); passes the approval gate; atomic write + `fs://changed` broadcast |
| edit | `path`, `old_string`, `new_string`, `replace_all?` | str-replace exact match; zero matches / multiple matches (without replace_all) error back to the model; approval card shows old/new side by side; atomic write + `fs://changed` |

All tool results have a unified size cap; overflow is truncated and explicitly marked. "The currently open file" gets no placeholder magic: the active file path lives in the system prompt and the model passes it to read itself.

### grep supply: sidecar ripgrep (dsh-style build-time packaging)

- The binary is supplied via the `@vscode/ripgrep` npm package (currently 1.18.0, containing ripgrep 15.0.0; an extension of the "npm as repository, not runtime" ruling); a build script copies it as a Tauri sidecar (`binaries/rg-<target-triple>`), and per-platform CI builds each pick their own; `dep-allowlist` registers the package and `docs/environment-independence.md` registers the bundled-sidecar note. pi-style runtime download is rejected (the hard constraint forbids it outright), as is pure-frontend TS scanning (traversal already lives in Rust — same family as read_tree — and only matching lines cross IPC).
- A new Rust grep command: bare argv spawn (no shell, no quoting surface), parses the complete `rg --json` stdout, the budgets and error vocabulary above; `path_authorized` runs before spawn (the same single decision point as every file command).

### Authorization boundary and out-of-bounds reads

- The boundary is the **set of paths** in the window authorization registry (not a single library directory); the `~/.studywiki` config-domain exclusion is unchanged.
- Out-of-bounds read/grep: not a hard reject — an approval is raised (granularity choice: this file only / its containing directory); on approval the new Rust command `authorize_read_path` registers the path into the window registry (session-scoped, expires when the window closes), and the same scope never asks again. Writes **never cross the boundary in any mode**: write/edit outside the set returns a tool error straight back to the model, with no approval escape hatch.
- Threat model (why reads are not wide open): read content enters the model context and is sent to a remote endpoint, so malicious text inside the library can prompt-inject exfiltration (e.g. `~/.aws/credentials`); the authorized set can only grow via human/guardian approval, never by the model itself.

### Approvals and the two modes (mirroring Codex ask-for-approval / approve-for-me)

- Only two action classes require approval: write/edit inside the authorized set; read/grep outside it. Everything else executes directly.
- Both modes share one approval event stream and differ only in the answerer: **ask-for-approval** (the durable default for new sessions, changeable via settings `agentApprovalMode`) = an approval card waits for a human click (write content preview / edit old-new comparison / out-of-bounds read granularity choice; approve once / reject with a reason fed back to the model); **approve-for-me** = automatic verdict by a guardian review call — one independent `ctx.llm.chat` (non-streaming, stateless, no conversation history, same model as the current session): the system prompt is the review policy (in-library note writes pass; suspicious out-of-bounds reads, bulk overwrites, and obvious injection instructions are denied), the input is tool name + argument summary, the output is a structured verdict + reason. JSON wrapped in reasoning/prose is extracted and still strictly validated; parse failures and transient 408/429/5xx use 200ms/400ms backoff for two retries, while valid denials do not retry; timeout/final failure is always a fail-closed denial. The verdict and reason land in `approval/decided` and are shown read-only on the UI approval card.
- The durable default affects only new sessions; mode is session-scoped state, switchable anytime: `mode/changed` is logged + the next turn's system-prompt mode sentence updates, and it never rewrites the global default. A third "zero-review auto-write" tier is rejected (approve-for-me already covers unattended runs with one more net), as is a rule engine (persistent always-allow rules, YAGNI).

### Session persistence and resume

- Location `~/.study-wiki/sessions/<library-key>/<session-id>.jsonl`: outside the learning library so application logs cannot enter generic grep; `<library-key>` is generated from the library-root path by sanitizing plus a stable hash. The header line carries a **format version** (the dsh v0→v1 migration lesson, front-loaded) + `rootPath` (for validation, with a notice after the library moves) + a title (first 50 chars of the first user message). Legacy in-library sessions migrate once when listed.
- One event per line, **persisted only when complete** (streaming deltas never touch disk); a new Rust `append_session_event` command (O(1) single-line append, through `path_authorized`).
- Physical isolation between libraries: the list reads only the current root's sessions directory; switching roots switches the list. The session projection exposes `title`, `messages()`, `lines()`, running state and `setModel`; the UI consumes only that surface. Resume semantics = **load only, never auto-run**: replaying the JSONL renders history (including the historical look of tool cards and approval cards), and the loop continues only when the user sends a new message; a crash tail is truncated to the last complete event and marked; dangling approvals are judged `unavailable` (fail-closed, no resurrected clickable cards). The convention is "one session is driven by one window at a time", with no locking.
- **Compaction is in scope**: when the latest response's `usage.promptTokens` crosses a threshold (default 80k, configurable in settings), before the next turn the old segment (first half of history) goes through one independent summarization call (preserving: user goals, conclusions, written/edited file paths, unfinished todos) while the new segment (including recent tool results) is kept verbatim; the old segment is replaced by a summary message and a `compaction` event is logged. **The log keeps the full text** (compaction only affects the view fed to the model), and replay rebuilds the same effective view from compaction events; the UI inserts a divider at the compaction point (expandable to read the summary). Multi-level recursive compaction and tokenizer-precise trimming are rejected (no dependencies; use the measured usage values).

### Gates and tests

- vitest (full chain with a fake ctx): the loop state machine (scripted chatStream multi-round tool calls), two-mode approval routing, guardian verdict parsing and fail-closed paths, JSONL serialization/replay/truncation, compaction triggering and view rebuild, str-replace boundaries, authorization decisions.
- cargo test: `append_session_event` / `authorize_read_path` authorization checks, grep command budgets and error vocabulary (fixture directories + the real sidecar).
- Mechanical surface: commands.md / code-map generated regions rebuilt; `verify:layering` (new plugins equally forbidden from `@tauri-apps/*`), `verify:env-independence` (sidecar registration), `verify:dep-audit` (`@vscode/ripgrep` allowlist), doc-budgets registering new standing docs; this Note and the issue #30 update (status→in-progress, adr, scope extended with `src-tauri/**` etc.) land in the same PR.

## Alternatives considered

- A standalone `src/agent/` pure module (pi-style): pi's purity serves publishing an npm package; this repo is an application-internal component; a second hand-rolled DI mechanism would give up cordis lifecycle and m2-04's inject seam; rejected in favor of dsh-style dual plugins.
- Merging core and UI into one plugin: service and UI have different lifecycles (reloading the UI must not kill sessions), and dsh splits them the same way; rejected.
- Text-protocol tool calling: fragile parsing, painful half-streamed JSON; rejected.
- Pure-frontend TS grep / pi-style runtime rg download: the former splits traversal away from read_tree's native home and hauls full contents over IPC, the latter violates the environment-independence hard constraint; rejected.
- Wide-open reads (codex workspace-write default read semantics): unacceptable under the egress + injection threat surface; rejected.
- In-memory sessions (app-chat status quo): the requirement explicitly demands resumable durable sessions; rejected.
- A conventional `notes/` landing spot / pre-committing to m2-04's wiki structure: the former locks in an unjustified default, the latter makes this issue guess m2-04's contract; rejected — landing is conversation-driven plus the AGENTS.md convention.
- A 25-iteration per-turn cap: mainstream agents have no hard cap (dsh uses a repeat-tool-reminder soft nudge), and the stop button plus compaction suffice; rejected.
- app-chat coexisting as a second panel: conceptual burden plus clashing in-memory/durable session models; rejected in favor of replacement.
- Parallel tool execution: serial approval cards are simpler in UX and implementation; rejected for the first cut, kept for later.
- A diff library for approval comparison: the first cut's old/new two-pane comparison suffices without a dependency; kept for later.

## Consequences

- issue #30's scope extends to `src-tauri/**`, `package.json`, `scripts/dep-allowlist.json`, `tests/**`, `docs/environment-independence.*`, etc. (the issue three-piece set is updated and set to in-progress in the same PR).
- app-chat retires; `sidebar.right`'s sole registrant becomes app-agent; m2-02's rendering and attachment investment is inherited wholesale.
- Rust gains four commands (grep_files / authorize_read_path / append_session_event / delete_session_file) plus sidecar configuration and a build script; commands.md, code-map, dep-allowlist, and doc-budgets move in sync.
- The environment-independence doc registers the rg sidecar (packaged at build time, zero runtime downloads).
- Debts: no evaluation mechanism for compaction summary quality; parallel tool execution; multi-window locks for one session; diff rendering on approval cards; an independent model slot for the guardian; session search/forking; block-level incremental markdown rendering (carried over from m2-02); a repeat-tool-reminder-style soft anti-loop nudge.
