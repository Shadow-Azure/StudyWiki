# Development guide

English | [中文](development.md)

> Type: tutorial | Tier: contributor onboarding. The authoritative list of CI and gates lives in `package.json` scripts and [scripts/run-gates.mjs](../scripts/run-gates.mjs); this page only explains how to use them.

## Environment

- Node ≥ 22, pnpm ≥ 10, Rust stable (1.77+)
- macOS: Xcode CLT; Windows: MSVC Build Tools; Linux: `libwebkit2gtk-dev` etc. (see the official Tauri 2 prerequisites)
- These are **build-time** only; the artifact-side environment-independence constraint is in [environment-independence.en.md](environment-independence.en.md)

## Daily loop

```sh
pnpm tauri dev     # 开发：改 src/ 或 src-tauri/ 均热更/重编
```

Pick gates by change surface before committing (don't default to the full suite; exhaustive coverage belongs to CI):

| Change | Run locally |
|---|---|
| Docs / Agent Notes only | `pnpm lint:docs` |
| Frontend code | `pnpm build` (includes tsc) |
| Rust code | `cargo fmt --check && cargo clippy && cargo test` (in `src-tauri/`) |
| Anything touching artifact behavior | `pnpm verify:docs` + the code checks above |

When either side of a paired document changes: patch the counterpart minimally in the same PR and re-record with `pnpm record:i18n -- <pair>` (contract: [i18n/README.en.md](i18n/README.en.md)); after touching `src-tauri/src/lib.rs` commands, run `pnpm gen:commands`.

Plain ```ts fences are really compiled by doc-typecheck (imports resolve from the repo root); copy fences verbatim to the English side:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { LibraryEntry } from "./src/types";

// 侧栏数据源：已按扩展名分类、按名称排序的条目
const root = "/path/to/library";
const entries: LibraryEntry[] = await invoke("list_library", { root });
```

## Committing and releasing

- Every non-trivial change carries one Agent Note in the same PR (new or updating the owning note).
- Release: push a `v*` tag to trigger [release.yml](../.github/workflows/release.yml); a draft release appears once all gates are green. Checklist: [release-checklist.en.md](release-checklist.en.md).
