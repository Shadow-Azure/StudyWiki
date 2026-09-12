# Agent Note: Phase 3 plugin authoring toolchain + host hardening closeout

Status: implemented

English | [中文](2026-09-12-phase3-plugin-authoring.md)

## Problem

Phase 2 delivered the consumer side of external plugins (install / local import / loading / management panel, [Note](../../implemented/architecture/2026-09-11-phase2-external-plugins.en.md)); the author side of the supply chain is still manual work: the closed-contract package structure has to be hand-typed from shell snippets inside a PR description, the repository carries no reusable engineering starting point, and nothing checks the format mechanically before publishing — a malformed package is only rejected when a user tries to install it. Two standing debts also wait: the fast-follow hardening bundle ruled by the Phase 2 final review (no ureq timeout, no tarball size cap, `entry == "package.json"` passing install, non-array inject passing through, unhandled rejection in the panel's render); and the [dynamic-asset-scope](../feature/2026-09-06-dynamic-asset-scope.en.md) proposal landed only halfway — Phase 2 emptied the assetProtocol surface, but the command surface (`read_tree` / `read_text_file` / `write_text_file`) still accepts arbitrary absolute paths, so "the permission surface matches user intent" is not closed.

## Decision

Scope: **this phase = the author-side toolchain (scaffold generator + pre-publish validation + authoring guide) + the host hardening bundle (the five fast-follow items + root containment for file commands) + incidental doc/note cleanup**. File watching (notify), hot reload, cross-window stale files, symlink handling, plugin sandboxing, and the runtime provider (the Phase 3+ door in the [Phase 1 Note](../../implemented/architecture/2026-09-10-plugin-architecture.en.md), not yet triggered by real demand) stay out.

1. **Scaffold generator** (the author-side engineering starting point): `pnpm gen:plugin -- <name>` emits a complete npm package into the gitignored `plugins-dev/<name>/` — package.json (`keywords` includes `studywiki-plugin`, empty `dependencies`, `studywiki: {apiVersion: 1, entry: "index.js"}`, `files: ["index.js"]`, `scripts.build/check/prepublishOnly`), `src/index.ts` (a topbar hello example, with a local minimal type copy `src/host.d.ts`) and `scripts/check.mjs` (mechanical validation of the publish surface). **No README** — npm unconditionally packs README/package.json into the tgz, so a README makes the publish surface three files and breaks the host's exactly-two-files contract; the authoring guide lives in StudyWiki's docs, not in the generated artifact. Template text is embedded in `scripts/gen-plugin-template.mjs`: zero new dependencies for the repository; esbuild/typescript are devDependencies of the generated artifact, installed on the author's machine — the host's dep-audit and the shipped product never see them. The generator carries its own spec test (rendered-byte assertions + name validation), so drift between the template and the host's closed contract turns `pnpm test` red.
2. **Pre-publish validation**: the template's `check.mjs` uses `npm pack --dry-run --json` to assert the publish surface is exactly `package.json` + `index.js`, that the studywiki block / keyword / empty dependencies are present, and that the entry is top-level — an author-side mirror of the host's install pipeline for the same contract: fail at publish, not install.
3. **Authoring guide** (`docs/plugins/authoring.md` trio, joining the resident doc system — budgets / pairing / index): the full closed-contract table (present-tense), generate → build → validate → publish (`npm publish`, prepublishOnly runs build + check automatically), the local-import inner loop (no hot reload; restart to apply — the Phase 2 ruling stands), apiVersion semantics, and the same-process full-trust model disclosure.
4. **Host hardening bundle** (the five fast-follow items; [environment-independence.md](../../../../docs/environment-independence.en.md) offline-at-runtime and dependency surfaces unchanged):
   - a shared ureq Agent with an overall timeout (both call sites: registry metadata + tarball);
   - a size cap on both the tarball download and the local import read (20 MiB; under the closed contract an oversized package is a DoS-hardening concern, not a security boundary — over the cap fails loud, naming the cap);
   - `parse_package_json` rejects `entry == "package.json"` (closes the duplicate-package.json count bypass, rejected at both install time and load time);
   - an external module whose `inject` is neither `undefined` nor an array of strings is rejected (`undefined` stays legal — inject is optional);
   - the plugin-manager render shows `readManifest` / `list` rejections inline, eliminating the unhandled rejection.
5. **Root containment for file commands** (closing dynamic-asset-scope): the paths of `read_tree` / `read_text_file` / `write_text_file` must fall inside a root authorized in the window registry (lexical `starts_with`, the same source and layer as the `allow_directory` grants; symlink following stays parked). The authorization source of truth is the WindowRegistry roots (granted at `set_window_root` / `create_window`), with a single decision point in lib.rs; when the registry has no root (welcome state), all three commands reject. Window A reading window B's root is app-level shared authorization, consistent with the known asset-scope limitation.
6. **Docs and Note closeout**: code-map gains the lib.rs responsibility line (plugin command registration today); boot-error guidance gains "or reopen a folder"; the dynamic-asset-scope trio moves to implemented; this Note moves to implemented; the AGENTS.md command list gains `gen:plugin`; full gate suite + release tier.

## Alternatives considered

- **Standalone template repository (plugin-starter)**: forks maintenance, and drift between template and host contract has no gate watching it; embedded templates + spec-pinned rendered bytes make drift fail this repository's own tests.
- **Publishing a host types package @studywiki/types**: better typing for authors, but adds a published artifact and version-sync duty; this phase ships a local minimal type copy inside the generated artifact plus the guide as truth, leaving the types package to real pain.
- **check.mjs validating via the host Rust pipeline (tauri CLI import)**: requires a Rust toolchain on the author's machine, contradicting "authors only need Node"; `npm pack --dry-run --json` is npm's own truth about the publish surface and suffices.
- **Command-side validation reusing FsScope::is_allowed**: same-source with the protocol surface is cleanest, but invoke commands do not consult the asset scope; the command side needs its own decision point. We take a lexical check over registry roots; symlink handling is booked separately.
- **An interactive wizard for gen:plugin**: YAGNI — the one argument is the name.
- **A dev-mode hot-reload inner loop**: Phase 2 already traded reload for correctness via restart; not reopening.

## Consequences

- "Engineering" the author side does not grow host complexity: the repository gains only a generator script and docs; the shipped product is unchanged except for the hardening items.
- The 20 MiB cap is a product judgment: single-file plugins under the closed contract stay far below it; over the cap means rejection, naming the cap.
- With root containment in place, all three commands reject in the welcome state — any latent "read files without opening a folder" usage would fail loud (the current call surface has none).
- The embedded contract checks and the host's Rust checks are two implementations of one contract, each pinned by its own tests; changing the host's closed contract must update the template and the guide together (doc chaining).
- With dynamic-asset-scope moved to implemented, its "outside the root, deny by default" is covered jointly by root containment and the emptied scope; references from inside a library to files outside it are denied by default with an explicit error.
- File watching, hot reload, symlinks, cross-window staleness, sandboxing, and the runtime provider stay parked, with triage archived in this phase's PR description.
