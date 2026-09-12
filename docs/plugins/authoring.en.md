# External plugin authoring guide

English | [中文](authoring.md)

> Type: tutorial | Tier: external plugin authors. The host install pipeline (`src-tauri/src/plugins.rs`) and the generated `scripts/check.mjs` enforce the same contract; this page is the author-facing authoritative wording — when the host contract changes, this page changes with it.

An external plugin is a zero-dependency single-file ESM module that enters the host as an npm tarball; every requirement below has a mechanical safety net — the host/generator/publish-check division of labor is marked in the table.

## Closed contract (mechanical safety net; refusal points and timing in the table)

| Item | Requirement |
|---|---|
| Package name | Lowercase letters/digits/hyphens, ≤100 chars (generator-enforced); at install the host additionally rejects empty names and path forms; `check.mjs` does not validate the name — check this row first after hand-editing it |
| tgz contents | Exactly `package/package.json` + `package/<entry>`, two files (README/LICENSE get packed by npm unconditionally — don't add them) |
| keywords | Contains `studywiki-plugin` |
| dependencies | Explicitly empty object (zero-dependency single file) |
| studywiki.apiVersion | `1` (host support set {1}; anything else is rejected at load) |
| studywiki.entry | Top-level single file name (rejects `/`, `\`, `..`, `package.json`) |
| Size cap | 20 MiB (same cap for registry pulls and local imports; over-limit is rejected with the cap named) |
| Module exports | ESM: non-empty `name`, function `apply`; `inject` is optional (defaults to `undefined`) and, when given, must be an array of strings |

## Quick start

Generate the starting point at the StudyWiki repo root (`plugins-dev/` is gitignored):

```sh
pnpm gen:plugin -- my-plugin   # 生成 plugins-dev/my-plugin/ 完整 npm 包
```

Inner loop (esbuild/typescript are devDependencies, installed on the author machine only):

```sh
npm install        # 装构建工具链
npm run build      # esbuild 把 src/index.ts 打包成单文件 index.js
npm run check      # 发布面校验：npm pack 断言恰好两文件 + 契约字段齐备
```

The generated `src/index.ts` is a runnable topbar hello example (the `name`/`inject`/`apply` shape); `src/host.d.ts` is a local minimal type copy.

## Trial install in the host

Start the host with `pnpm tauri dev` → plugin panel → “本地导入…” (import local) → pick the tgz produced by `npm pack` → **restart to take effect**. No hot reload (Phase 2 ruling): manifest consistency, failure rollback, and multi-window sync are simplest-correct as "seen at next boot"; broken rows are named in the panel for cleanup and don't affect other plugins.

## Publish

```sh
npm publish        # prepublishOnly 自动 build + check，先校验后上传
```

The publish name is the install name: enter `name` or `name@version` in the panel to install from the registry; the version is the one in that install form.

## Trust model and boundaries

Plugins run in the same webview JS world as the host with **full same-process privileges** — a plugin can reach everything the host can (the Obsidian lesson). apiVersion, zero dependencies, and the single file are the entire current defense line, not a sandbox. The author-side types in `./src/host.d.ts` are a local minimal copy and may drift from the host implementation; this page is the authoritative contract.
