# Built-in agent contract

English | [中文](agent.md)

> Type: reference | Also see [contract.md](contract.en.md) and [../architecture.en.md](../architecture.en.md).

## Service surface

UI-free `agent-core` injects the three host facades and publishes `ctx.agent`: list, open, delete, cleanup. A session has `title`, `mode`, `model`, `running`, `rootMismatch`, `messages`/`lines`, `send`/`abort`/`setMode`/`setModel`/`respond` and subscriptions. `app-agent` is only the right rail; the external guard does not expose `agent`.

## Tool contract

| Tool | Parameters | Behaviour |
| --- | --- | --- |
| `read` | `path`; `offset?`; `limit?` | Reads authorized UTF-8; default 2000 lines, 200 KB, line-number prefixes; binary/video/xlsx refused |
| `grep` | `pattern`; `path?`; `glob?`; `ignoreCase?`; `literal?`; `context?`; `limit?` | ripgrep sidecar; path defaults to root; default 100 hits and 20 MB/30-second budget |
| `write` | `path`; `content` | Creates/replaces text in the root; after approval writes atomically and broadcasts |
| `edit` | `path`; `old_string`; `new_string`; `replace_all?` | Exact replacement; zero/multiple matches without replacement error; approval comparison, then atomic write |

Oversized output is truncated and marked. Outside reads/searches ask first; approval registers the chosen file/directory read grant. Outside-root writes fail in every mode.

## Approval modes

Approvals cover in-boundary write/edit and outside read/grep. `ask` waits for a human; `auto` uses the session model for an independent history-free guardian review with a 30-second timeout; failure denies. Abort records pending items `unavailable`; decisions and reasons enter the log.

## Session format

Path `<library root>/.study-wiki/sessions/<id>.jsonl`; the first line is a v1 header with `v`, `id`, `rootPath`, `title`, `createdAt`. Later lines are completed events; halves never persist and crash tails drop:

| Line kind | Payload |
| --- | --- |
| `message` | user / assistant / tool message |
| `approval` | family, tool, path, decider, decision, reason |
| `mode` | `ask` / `auto` |
| `compaction` | summary, covered count, time |

The log keeps full text; compaction changes only the model view. Usage above 80000 (configurable) swaps the older half for a summary next turn. Restore replays only; root mismatch is announced and dangling approvals are not revived.

## AGENTS.md convention

The system prompt is rebuilt each turn with root `AGENTS.md`, the active file and mode sentence. No notes location is preset; m2-04 constrains behavior through an in-library `AGENTS.md`.
