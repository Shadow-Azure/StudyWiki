# Agent Note: Dynamically narrowing the asset protocol scope

Status: proposed

English | [中文](2026-09-06-dynamic-asset-scope.md)

## Problem

`tauri.conf.json` currently sets `assetProtocol.scope: ["**"]`, letting the webview read any local file via the asset protocol. The user authorized exactly one library folder, yet the application holds whole-disk read permission — the permission surface does not match user intent.

## Decision (proposal)

After the dialog returns the chosen directory, narrow the scope to that directory via a runtime capability (the Tauri 2 `app.asset_protocol().scope()` dynamic-grant API); the static config becomes an empty scope. The `list_library`/`read_text_file` commands simultaneously grow a check that paths lie inside the granted scope.

## Alternatives considered

- **Keep `**`**: the status quo, see known debts in [docs/environment-independence.en.md](../../../../docs/environment-independence.en.md).
- **Validate on the command side, leave the protocol alone**: video playback must go through the asset protocol (the `<video>` tag), which command-side validation cannot cover.

## Consequences

- Once landed, delete the debt entry above and sync the fact in the architecture doc.
- Sub-directory grants (a library referencing videos outside it) need an explicit definition: deny by default with a clear error.
