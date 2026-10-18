# Agent Note: llm-wiki source probing foundation

Status: implemented

English | [中文](2026-10-18-source-probe.md)

## Problem

Later llm-wiki ingest needs to detect whether a source file changed. Videos and other large files cannot be read and hashed in full every turn, and the probe must use the same read domain as existing file access rather than bypassing window roots and dynamic grants.

## Decision

`probe_source_file` reuses `ensure_authorized_read` and returns `{size, mtimeMs, sha256}`. Rust computes SHA-256 in 64 KiB streamed chunks; when a known sample matches both on-disk size and mtime, its SHA-256 is trusted and content is not reread. The TS surface adds only a `FilesService.probeSourceFile` facade, so plugins still cannot access Tauri APIs directly. A path containing `..` returns the stable `PROBE_INVALID_PATH` error.

## Alternatives considered

Rehashing in full every turn is simplest, but its cost is unacceptable for large videos. Trusting the relative path directly would let probing escape the path boundary, so that was rejected. Comparing only mtime can miss same-timestamp content changes, so the known fast path must compare both size and mtime.

## Consequences

Later llm-wiki tasks can use `ProbeSample` as the source-change foundation. Mtime granularity is filesystem-dependent, and any known mismatch forces recomputation. Regression tests check content hashes against independent SHA-256 vectors and use a known sample with on-disk size/mtime but a replaced digest to prove the fast path reuses it; a regression that rehashes would fail. If the configuration root cannot be resolved, probing is rejected with `PROBE_UNAUTHORIZED` rather than introducing another path past authorization.
