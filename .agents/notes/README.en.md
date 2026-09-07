# Agent Notes

English | [中文](README.md)

A species of design document lives here. **Agent Notes record decisions that affect this repo** — the why, what was given up — the parts code and docs cannot hold. This file defines where they live, when to write them, and their format (below).

## Layout and naming

A note's two coordinates are both encoded in its **path** — `{lifecycle}/{class}/yyyy-mm-dd-topic.md`:

- **Lifecycle** (top folder) is the state; notes move between folders as their state changes:
  - **`proposed/`** — proposals reviewed before implementation, not yet (or only partly) landed.
  - **`implemented/`** — the decision has shipped. The file records what was decided and what was rejected, and **stays in sync with reality**: when code moves files, renames, or changes defaults, the same change rewrites the note's facts in place (facts only, never the decision itself).
  - **`rejected/`** — the proposal was turned down. Keep only when the reason can block an attractive mistake; otherwise delete the whole file.
- **Class** (nested folder) is the kind of decision (see below).
- The filename date = when the topic was **first raised** (git is the referee); other history belongs to git.

Cross-references between notes use relative markdown links, never bare descriptions or numbering — mechanically checkable, survive moves. No central INDEX.md; the directory tree is the list.

## Classes (closed set)

| Class | Covers |
|---|---|
| `feature` | New user-visible capability |
| `bug-fix` | Fixing defects or closing gaps a postmortem exposed |
| `simplification` | Deleting code/behavior/surface without adding capability |
| `architecture` | Structural decisions about the **shipped source** |
| `process` | Tools/policy/process around the code — gates, packaging, releasing |
| `testing` | Test infrastructure and strategy |

The `architecture`/`process` boundary: the former is about the source we ship; the latter about the tools and process around it. Adding a class means changing both the set in `scripts/verify-agent-notes.mjs` and this table.

## When to write

**Every non-trivial change must add or update at least one Agent Note in the same PR.** Non-trivial = changing behavior, architecture, cross-file contracts, process/tooling, test strategy, or any decision a maintainer might revisit. Updating the owning note counts; do not create duplicates. Purely mechanical local edits are exempt.

Archiving: an implemented note with low future value may be frozen into `archived/{class}/` (not enabled at this repo's current scale; enabling requires a sha256 + append-only manifest gate, per the blueprint's mechanism).

## File format

The first three lines are fixed, followed by a blank line:

```markdown
# Agent Note: <标题>

Status: <status>
```

`Status` is one of three, and must cross-check against its folder (gate-enforced):

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <one-line reason>`

Body skeleton: `## Problem` (the motivation, standing on its own without the solution) → `## Decision` (the choice) → `## Alternatives considered` (rejected options and why — the core reason this tier exists) → `## Consequences` (aftermath and debts). Section names are fixed; free technical sections may be inserted between them.

## Gates

`pnpm lint:docs` runs [scripts/verify-agent-notes.mjs](../../scripts/verify-agent-notes.mjs): legal paths (lifecycle × class closed sets), first-three-lines format, `Status` matching its folder, reachable cross-reference links.
