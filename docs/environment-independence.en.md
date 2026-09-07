# Environment independence

English | [中文](environment-independence.md)

> Type: reference | Tier: sole home of the constraint. This file defines the verifiable meaning of "the client depends on no environment"; AGENTS.md carries only a one-line summary linking here.

## Constraint definition

The released client (installer / executable artifacts) satisfies all of the following clauses, which together mean "depends on no environment":

1. **Zero runtime prerequisites**: the user's machine needs no preinstalled Node, Python, JRE, browser, ffmpeg/codec packages, or any dev dependency of this project.
2. **Fully offline**: installation and runtime touch no network; frontend resources are bundled into the artifact at build time — no CDN, external scripts/styles, or runtime downloads.
3. **Consistent behavior**: functionality is unaffected by environment variables or global config files; the same version of the artifact behaves identically on any machine meeting the OS minimum.
4. **Self-contained install**: the installer carries all its prerequisites (see "system webview boundary" below).

## System webview boundary (the only platform dependency)

Tauri embeds no browser engine; it relies on the OS webview: macOS WKWebView (system-provided, no extra steps), Linux webkit2gtk (carried by the AppImage), Windows WebView2 (preinstalled only on Windows 10/11; older systems are covered by the installer embedding an offlineInstaller — configured in `tauri.conf.json`). This is a deliberate volume-versus-effort tradeoff (alternative: embedding Chromium at 100MB+, see the Agent Note). This boundary **is not treated as violating the constraint**, and it is the only one.

## Mechanical gates

- `pnpm verify:env-independence` ([scripts/verify-env-independence.mjs](../scripts/verify-env-independence.mjs)):
  - `tauri.conf.json`'s Windows `webviewInstallMode` must be `offlineInstaller`;
  - checks that script/style references in `dist/` build artifacts contain no external URLs;
  - checks that `src/` and `index.html` reference no `http(s)://` resources (`docs/` links are unrestricted).
- The release pipeline runs the script above on the artifacts and aborts on red (see [release.yml](../.github/workflows/release.yml)).

## Exemption registry

New exemptions must be registered in this table with an Agent Note link; unregistered violations go red:

| Exemption | Reason | Basis |
|---|---|---|
| System webview boundary (see above) | Volume/maintenance tradeoff | [.agents/notes/implemented/architecture/2026-09-06-tauri-2-shell.en.md](../.agents/notes/implemented/architecture/2026-09-06-tauri-2-shell.en.md) |

## Known debts

- `assetProtocol.scope: ["**"]` is too broad: the ideal fix dynamically injects the dialog-picked directory into the scope; needs frontend cooperation, deferred.
- The environment-independence gate does not yet cover Rust-side dynamic-linking checks (`otool`/`ldd` scans); release.yml's manual checklist covers it for now.
