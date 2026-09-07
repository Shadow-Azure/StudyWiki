# Release gate checklist

English | [中文](release-checklist.md)

> Type: reference | Tier: release process. release.yml mechanically executes 1–5; 6–8 are manual for now, to be mechanized step by step.

## Mechanical gates (CI automated)

1. **CI green**: `ci.yml` passes on the target commit (fmt / clippy / test / tsc / vite build / doc-sync).
2. **Version consistency**: tag, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` carry the same version (`scripts/verify-release.mjs`).
3. **Environment independence**: `pnpm verify:env-independence` passes on the artifacts (webview offline installer, no external URLs, no network references in source).
4. **Three-platform artifacts**: dmg (aarch64/x86_64), nsis (x64), appimage (x64) all produced and non-empty.
5. **Artifact smoke test**: each artifact launches and loads the empty state (currently build success + bundle validation; launch automation is a known debt).

## Manual checklist (before publishing the draft release)

6. On a clean machine with no Node/Rust, install and open a real library (one md + one video).
7. Repeat the previous item with networking disabled.
8. Confirm no unreviewed additions to the exemption table in [environment-independence.en.md](environment-independence.en.md).

## Known debts

- Artifact launch smoke test not automated (candidate: CI matrix + virtual display).
- Rust-side dynamic-linking scan (otool/ldd) not yet in the gates.
