# Agent Note: Guardian approval timeouts must cancel the underlying request

Status: implemented

English | [中文](2026-10-11-guardian-timeout-cancellation.md)

## Problem

The guardian implementation used `Promise.race` for the model response. When the 30-second deadline fired, only the approval layer stopped waiting; the underlying chat promise and possible retry requests kept running. This wasted resources, delayed connection release, and made timeout denial look like a stopped request when it was not.

## Decision

The guardian now uses a shared 90-second review deadline with at most three attempts by default. Every attempt receives the same cancellable signal; deadline expiry aborts the current request first, then waits up to 5 seconds for cancellation to settle. The host `chat` call uses abortable streaming IPC when given a signal and converges the result to the non-streaming shape. Parse failures and 408/429/5xx may retry only within the shared deadline; timeout and final failure remain fail-closed denials.

## Alternatives considered

Merely shortening the timeout cannot cancel the underlying call. Adding a request registry and abort command to non-streaming IPC would expand the Rust surface, while the streaming channel already has `llm_chat_abort`. Resetting the deadline per retry would let a slow model wait indefinitely and diverge from Codex's shared-budget semantics.

## Consequences

Stopping a guardian review does not intentionally leave a new underlying request behind; retries and backoff share one budget. Tests cover deadline abort, shared deadline across retries, `cancelAll` abort, and a host chat signal triggering `llm_chat_abort`. A dedicated guardian model, cancellation telemetry, and backend hard-cancellation guarantees remain future work.
