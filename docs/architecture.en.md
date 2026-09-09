# Architecture

English | [中文](architecture.md)

> Type: reference | Tier: architecture map. Required reading before changing `src/` or `src-tauri/`. Decision rationale does not live here — see the owning Agent Note.

## Composition

StudyWiki is a single-window Tauri 2 desktop app with two layers:

<!-- BEGIN GENERATED code-map (scripts/gen-code-map.mjs) — do not edit between markers -->
```text
src/          前端（TypeScript + Vite，无 UI 框架）
  main.ts     入口：侧栏文件列表 + 查看器分发（→ styles.css、types.ts）
  styles.css  样式（无逻辑）
  types.ts    LibraryEntry —— 前后端共享的唯一形状
src-tauri/    Rust 壳
  lib.rs      tauri::Builder + 两条命令
  main.rs     入口壳（Windows 隐藏控制台）（→ lib.rs）
```
<!-- END GENERATED code-map -->

The composition tree is a generated region: file roles are registered in [code-map.manifest.json](../scripts/code-map.manifest.json) and internal dependencies (→) are derived from source imports; register and run `pnpm gen:code-map` after adding/removing source files or changing imports. `types.ts` and the Rust-side `LibraryEntry` are the single shape shared across the frontend/backend boundary. Declarations pasted into docs use type-equiv fences notarized against source (`scripts/verify-type-equiv.mjs`, verbatim equivalence; changing source without syncing the doc goes red):

```ts type-equiv
/** A playable or readable file inside the opened library. */
export type LibraryEntry = {
  /** File name including extension. */
  name: string;
  /** Absolute path, used for reads and asset-protocol URLs. */
  path: string;
  /** Dispatches the viewer: markdown or video. */
  kind: "markdown" | "video";
};
```

The authoritative command surface (with signatures) lives in the generated region of [commands.md](commands.en.md); run `pnpm gen:commands` after changing source. Data flow: the user picks a folder (dialog plugin) → the `list_library` command scans and classifies by extension → the frontend renders the sidebar → opening a file dispatches Markdown to `read_text_file` + markdown-it frontend rendering, and video to `convertFileSrc` (asset protocol) handed to the system webview's `<video>` decoder.

## Key decision points

- **Extension dispatch lives on the Rust side** (`MARKDOWN_EXTS` / `VIDEO_EXTS`): a single decision point; the frontend never re-classifies.
- **`assetProtocol.scope: ["**"]`**: the user may open any folder, so it cannot be pre-narrowed; the CSP's `media-src`/`img-src` restrict other resources. Tightening the scope is a [known debt](environment-independence.en.md#known-debts).
- **markdown-it is bundled at build time**, `html: false` disables inline HTML: a direct corollary of the environment-independence constraint below, and it shrinks the XSS surface.
- **The system webview does rendering and video decoding** (macOS WKWebView / Windows WebView2 / Linux webkit2gtk): a volume-vs-dependencies tradeoff; boundary and mitigations in [environment-independence.en.md](environment-independence.en.md).

## Environment independence

Architecturally, every new capability passes one check: does it introduce a runtime environment dependency? The single home for rules, gates, and the exemption registry is [environment-independence.en.md](environment-independence.en.md).
