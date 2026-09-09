# Agent Note: Closing the blueprint's half-step gaps (change routing / prompt rendering / self-tests as a leaf / generated composition tree)

Status: implemented

English | [中文](2026-09-09-half-step-gates.md)

## Problem

The second blueprint review (dsh ten-step pipeline, 2026-09-09, main @ 888798d) located four half-step gaps: ① step 6 offered only a manual choice between lint:docs and verify:docs, with no mechanical routing from change surface to gate combination; ② step 5's translation prompt had only placeholder-set checking (verify-terminology ③) — whether the template still renders, or was edited by accident, had no backing gate; ③ step 7's documentation-standard self-tests ran only under pnpm test / CI, not in local verify:docs (the blueprint makes them a quick doc leaf); ④ the architecture map was a hand-written tree — the blueprint's counterpart is generated, so here drift waited for a red gate and then a manual fix.

## Decision

- route-gates.mjs + `pnpm route:gates`: a pure classification function plus a CLI; by default it reads the worktree (git status --porcelain), `--base <ref>` reads a range. Five route groups (src-tauri / src / scripts / document corpus / wiring-and-dependencies) with a quick-mode fallback; unions come out in a fixed order (build → test → verify:docs). It is advice, not a gate — exhaustive coverage belongs to CI.
- translation-prompt.spec.mjs: extract the ```text template fence from docs/i18n/translation-prompt.md, render the three placeholders with a synthetic terminology table and a synthetic document, and compare verbatim against an inline snapshot; it also asserts the English side's fence is byte-identical. Synthetic fixtures never touch the live corpus — editing paired documents must not churn the prompt snapshot.
- New run-gates leaf gate-self-tests (spawns vitest run): in doc-sync and release, deliberately not in doc-quick (the seconds-level promise wins); ci-wiring spec pins this tradeoff.
- The composition tree is upgraded from a hand-written fence to a generated region: gen-code-map.mjs scans src/**/*.{ts,css} and src-tauri/src/**/*.rs, takes roles from code-map.manifest.json (the single home — an unregistered new file fails generation), derives internal dependencies from source imports (TS relative imports; Rust mod declarations + [lib] crate references), and writes both architecture.md regions byte-identically; `--check` is the new doc-quick leaf verify-code-map. styles.css joins the tree for the first time.

## Alternatives considered

- Option A for the tree (hand-written tree + bidirectional reconciliation gate, no generation): reconciliation only turns drift red, and the fix stays manual; the generated-region option is likewise exactly one gate leaf but makes drift structurally impossible (the region is machine territory — hand edits go red), so A gave way to B.
- Role descriptions in per-file header comments (`//!` / `//` / `/* */`): close to the code, but it adds a whole-repo header-comment convention and three comment-syntax parsers that license/banner headers trip over; dsh's JSDoc→catalog works because export comments are already mandatory, and tree roles have no such existing carrier. Chose the manifest (doc-budgets.manifest.json precedent).
- Dual-leaf defense (region freshness plus an independent reconciliation gate): both leaves check the same invariant, adding failure sources without adding safety; the generator's blind spots are covered by gen-code-map.spec fixtures (gate-coverage forces specs to exist).
- A prompt response-parsing test (the blueprint parses a three-section XML response): this repo's output contract is "the English-side file, whole" — there is no machine-checkable response format, so only rendering + snapshot were built.
- Porting the blueprint's gen-module-graph (workspace package-dependency graph) as-is: no workspace here; its mechanical counterpart is file-level internal dependencies, already folded into the code-map generator. External dependencies stay out of the map — their jurisdiction is environment-independence, and two registries would fight.
- gate-self-tests in doc-quick: vitest's seconds-level startup would roughly double quick-mode time, conflicting with its "run it in seconds" positioning; it moved down to doc-sync.

## Consequences

- The action chain for a new source file is fixed: register its role in code-map.manifest.json → `pnpm gen:code-map` → commit; forgetting the registration goes red in doc-quick (one step earlier than the original reconciliation option).
- Local `pnpm verify:docs` now matches the CI static lane (self-tests included); the duplicate vitest run in CI costs about three seconds — accepted.
- The tree's ordering and column alignment are decided by the generator (fixed scan-root order + longest-name alignment); manual layout freedom is given up.
- Blueprint alignment reaches its sensible stopping point: what remains is step 8 site projection + external-link probing (deferred) plus five deliberate depth differences (change-scope generality, bidirectional prompt with response parsing, the run-gates engine, doc-standard-tests leaf placement, what pre-push covers).
- Budgets grow with the standing surface: AGENTS.md 660→690 and docs/AGENTS.md 700→710 (still 28/10 over after condensing; justification: two new standing commands, gen:code-map and route:gates, and the docs/AGENTS.md generated-region rule now covers both generators).
