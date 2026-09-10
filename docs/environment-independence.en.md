# Environment independence

English | [中文](environment-independence.md)

> Type: reference | Tier: sole home of the constraint. This file defines the verifiable meaning of "the client depends on no environment"; AGENTS.md carries only a one-line summary linking here.

## Constraint definition

The released artifacts satisfy all of the following clauses, which together mean "depends on no environment":

1. **Zero runtime prerequisites**: the user's machine needs no preinstalled Node, Python, JRE, browser, ffmpeg/codec packages, or any dev dependency of this project.
2. **Core and built-in plugins offline**: the core and all built-in plugins are bundled into the artifact at build time; installation and runtime touch no network — no CDN, external scripts/styles, or runtime downloads.
3. **Consistent behavior**: functionality is unaffected by environment variables or global config files; the same version plus the same plugin set behaves identically on any machine meeting the OS minimum.
4. **Self-contained install**: the installer carries all its prerequisites (see "system webview boundary" below).
5. **External plugins** (rule written now, effective in Phase 2): an external plugin is a local resource the user installs deliberately — the install action may go online and only via registry tarball direct fetch; after install everything runs offline; always a pre-bundled zero-dependency single file, and the host refuses any other shape.

## System webview boundary (the only platform dependency)

Tauri embeds no browser engine; it relies on the OS webview: macOS WKWebView (system-provided, no extra steps), Linux webkit2gtk (carried by the AppImage), Windows WebView2 (preinstalled only on Windows 10/11; older systems are covered by the installer embedding an offlineInstaller — configured in `tauri.conf.json`). This is a deliberate volume-versus-effort tradeoff (alternative: embedding Chromium at 100MB+, see the Agent Note). This boundary **is not treated as violating the constraint**, and it is the only one.

## Mechanical gates

- `pnpm verify:env-independence` ([scripts/verify-env-independence.mjs](../scripts/verify-env-independence.mjs)): `tauri.conf.json`'s Windows `webviewInstallMode` must be `offlineInstaller`; `dist/` artifacts reference no external resource URLs; `src/` and `index.html` reference no `http(s)://` URLs (`docs/` links are unrestricted).
- `pnpm verify:native-links`: otool/ldd scan of release artifacts for dynamic links (release mode; build first).
- The release pipeline runs the scripts above on the artifacts and aborts on red (see [release.yml](../.github/workflows/release.yml)).

## Exemption registry

New exemptions must be registered in this table with an Agent Note link; unregistered violations go red:

| Exemption | Reason | Basis |
|---|---|---|
| System webview boundary (see above) | Volume/maintenance tradeoff | [.agents/notes/implemented/architecture/2026-09-06-tauri-2-shell.en.md](../.agents/notes/implemented/architecture/2026-09-06-tauri-2-shell.en.md) |
| External plugin install networking (enabled in Phase 2) | Install = registry tarball direct fetch; runtime stays fully offline | [.agents/notes/implemented/architecture/2026-09-10-plugin-architecture.en.md](../.agents/notes/implemented/architecture/2026-09-10-plugin-architecture.en.md) |

Exemptions for `node:` builtin references (in-package files confirmed never to enter the browser bundle, e.g. CLI bins) are registered in the `nodeRefExempt` table of [scripts/dep-allowlist.json](../scripts/dep-allowlist.json), part of the dependency-allowlist gate — not duplicated here.

## Known debts

- `assetProtocol.scope: ["**"]` is too broad: tightening the scope is a precondition for opening external plugins in Phase 2 (ideal fix: inject the dialog-picked directory dynamically; needs frontend cooperation).
- CSP/custom-protocol loading-channel spike (scheduled for Phase 2; blob-URL fallback).
- Existing plugin manifests have no migration logic: after upgrading with an old manifest, built-in plugins newly added to the static table do not auto-activate (Phase 2 precondition).
