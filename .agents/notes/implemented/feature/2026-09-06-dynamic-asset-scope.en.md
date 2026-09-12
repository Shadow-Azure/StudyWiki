# Agent Note: Dynamically narrowing the asset protocol scope

Status: implemented

English | [中文](2026-09-06-dynamic-asset-scope.md)

## Problem

`tauri.conf.json` set `assetProtocol.scope: ["**"]` at proposal time, letting the webview read any local file via the asset protocol. The user authorized exactly one library folder, yet the application holds whole-disk read permission — the permission surface does not match user intent.

## Decision

After the dialog returns the chosen directory, narrow the scope to that directory via a runtime capability (the Tauri 2 `asset_protocol_scope().allow_directory` dynamic-grant API); the static config becomes an empty scope. The file commands simultaneously check that paths lie inside a root authorized in the window registry (landed as `read_tree` / `read_text_file` / `write_text_file`, Phase 3 root containment).

## Alternatives considered

- **Keep `**`**: the status quo at proposal time.
- **Validate on the command side, leave the protocol alone**: video playback must go through the asset protocol (the `<video>` tag), which command-side validation cannot cover.

## Consequences

- Once landed, delete the debt entry above and sync the fact in the architecture doc.
- Sub-directory grants (a library referencing videos outside it) need an explicit definition: deny by default with a clear error.
