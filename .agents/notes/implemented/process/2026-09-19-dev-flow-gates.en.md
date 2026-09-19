# Agent Note: Development-flow gates (roadmap → milestone → issue → ADR)

Status: implemented

English | [中文](2026-09-19-dev-flow-gates.md)

## Problem

Ad-hoc development has no flow constraints: requirements scattered across conversations cannot settle, changes lack task boundaries, and phase goals have no committed surface. A roadmap → milestone → issue → ADR flow is needed, executed mechanically by gates like the docs engineering — anything developed on impulse must live inside the current milestone with a qualifying priority before work or merge.

## Decision

- The three working-file layers live in [.agents/flow/](../../../flow/README.en.md): `roadmap.md` (vision + the ordered milestone sequence) + `milestones/` + `issues/`; the contract home is `.agents/flow/README.md`. The ADR layer reuses Agent Notes — issues reference them via the `adr` field; no parallel system.
- Machine-readable fields live in a yaml flow fence: the pairing gate requires fences to be byte-identical across both sides, so the machine-readable surface cannot drift; the fence holds a yaml subset (implementation: `scripts/flow-lib.mjs`).
- Issue ids are coupled to GitHub issue numbers (commits and PR titles reference `(#N)`); a `github.number: null` draft transition state is allowed (backlog only); `bootstrap: true` is the bootstrap exemption — at most one repo-wide, in the first milestone only.
- Priority progression: same tier is serial across milestones; unlimited parallelism within a tier; when the highest not-finished tier has exactly 1 issue left not done, the next tier unlocks. The rules gate in-progress / done eligibility.
- No exemption lane: even mechanical fixes reference an issue.
- Three enforcement layers: `verify-flow` (offline state machine, in doc-quick/doc-sync/release), `verify-flow --diff <base>` (CI on PR: commit/PR title references + referenced-issue status + scope coverage; skipped when the base has no roadmap — PRs predating the flow are not bound), `verify-flow-online` (CI online lane: two-sided consistency with GitHub, verifies without modifying). The local commit-msg hook is reminder-level.
- Companion tooling: `pnpm flow:sync` (the only entry point writing the flow tree to GitHub; backfills numbers and re-records pairing records), `pnpm flow:new-issue` (trio scaffolding).
- Flow documents join the bilingual trio corpus; roadmap / README / milestones carry word budgets, issues do not (working files grow with discussion; budgets constrain resident docs).

## Alternatives considered

- GitHub-native (Projects/Milestones/Issues) as the single source of truth: local gates would depend on network and gh, violating "gates verifiable offline"; rejected in favor of file home + a CI online lane for two-sided consistency.
- A new docs/adr/ parallel system: dual-track with Agent Notes, hard-to-draw boundaries, reasons scattered across two places; rejected.
- Local flow-N numbering decoupled from GitHub: one more namespace and mapping table, and commit references could not jump straight to GitHub; rejected — coupling plus the draft transition state covers offline filing.
- A `[flow-exempt]` escape label: exemptions become the default path, defeating the hard constraint; rejected (explicitly cut by the user).

## Consequences

- `flow:sync` and the online lane require a logged-in gh; the first real run backfilled milestones m0–m4 → #1–#5 and issues #24 / #25, and the first PR #26 carries m0-01 + milestone + project.
- Two implementation defects surfaced by that run are fixed: `flow:sync` never wrote the milestone number back into the in-memory tree (the first sync could not finish in one pass); `gh pr view --json projectItems` returns an array, not `{nodes}` (a PR genuinely linked to a project was judged unlinked).
- The online lane's project link reads user-level Projects v2, where an app token only ever sees an empty list and cannot tell "not linked" from "no permission": with `FLOW_TOKEN` (a PAT carrying `project`) CI enforces it, otherwise the item drops to a reminder and the local `pnpm verify:flow-online` enforces it.
- Status moves edit both fence sides and re-record the pairing record; the backfill case is handled by flow:sync, manual moves go through record:i18n.
- The budgets of AGENTS.md / docs/development.md / docs/AGENTS.md rise with this change (gate command list and flow conventions join in).
- Debt: fine-grained issue decomposition for m1–m4 awaits discussion rounds; the model-inference supply question for m2 must be settled in environment-independence.md before work starts.
