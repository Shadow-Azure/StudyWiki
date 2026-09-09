# Agent Note: Source-reference rot gate

Status: implemented

English | [中文](2026-09-09-doc-refs-gate.md)

## Problem

Reviewing gate gaps against the blueprint's ten-step pipeline (same review line as [2026-09-09-md-wrap-gate.en.md](2026-09-09-md-wrap-gate.en.md)) found one leaf missing: verify-doc-refs. This repo's source is comment-dense — contract-home pointers ("契约见 docs/i18n/README.md") and runtime target paths (`gen-commands-catalog`'s write destinations) are scattered across three source families, but no gate reconciles the source side when docs are renamed or deleted. Rotting pointers can go unnoticed for months, and they strike exactly the navigability pillar of docs-as-code.

## Decision

- Added the verify-doc-refs leaf to doc-quick/doc-sync/release (disk-only check, quick-tier). Scan surface: scripts/*.mjs (excluding *.spec.mjs — fixtures are all synthetic paths), src/**/*.ts, src-tauri/src/**/*.rs; matched over full text, comments and strings alike — runtime paths rot too; the path character class includes `\p{L}\p{N}` (note titles allow Chinese themes; an ASCII class would silently skip them).
- The example stance matches the other link gates: paths inside inline code and fences don't count. Fence detection gets a source-idiom FENCE_IN_COMMENT_RE — strip the `//`, `#`, `*` single-line comment prefix before testing for fence markers; the markdown-document FENCE_OPEN_RE cannot recognize the `// ```md` shape. The TDD fixture surfaced this gap before the implementation caught up.
- One corpus fix: archive-agent-note.mjs's usage example carried its synthetic path unbackticked, so the new gate rightly flagged it; fixed per the example convention.
- Wiring: ci-wiring's anti-deletion list gains verify-doc-refs (deleting the leaf goes red); docs/AGENTS.md's lint:docs comment enumeration gains 源码引用. Backed by a six-case spec (98 total).

## Alternatives considered

- Scan comments only, not strings: rejected — verify-doc-index and gen-commands-catalog keep their check/write targets in string literals; a comments-only scan would miss runtime rot.
- Replace the *.spec.mjs class exclusion with a per-file allowlist: rejected — fixtures are inherently full of synthetic paths; excluding the extension once is enough, while an allowlist would need rolling registration as specs grow.
- Extend the surface to .github/workflows and docs themselves: rejected — the former is not a home for docs-engineering contracts, and the latter's dead links are already governed by verify-md-links; the boundary is stated in the gate's header comment.

## Consequences

- Green on landing (one example-stance fix); source comments and runtime paths are now mechanically reconciled against the doc tree — renaming or deleting a doc without updating source goes red.
- verify-doc-refs.mjs sits in its own scan surface: the contract and rule documents its header cites must really exist, and the regex source text cannot match itself (the `\/` escaped form), so self-reference is safe.
- Fence detection now has two definitions (markdown-document FENCE_OPEN_RE / source-comment FENCE_IN_COMMENT_RE): the two domains genuinely have different fence shapes, so they are not forced to share; a third shape would need a matching revision.
- New directories outside the three source roots (e.g. a future src-tauri/tests) do not auto-join the scan surface; adding a root means extending SCAN_SPEC — a deliberate, declared boundary, not auto-discovery.
