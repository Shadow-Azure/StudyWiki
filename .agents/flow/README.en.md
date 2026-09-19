# Development Flow

English | [中文](README.md)

> Contract home: the format, state machine, and gates for the four working-file layers — roadmap → milestone → issue → ADR. Mechanical enforcement belongs to `verify-flow` / `verify-flow --diff` / `verify-flow-online`; this page states the rules only.

## Layers

| Layer | File | Responsibility |
|---|---|---|
| roadmap | [roadmap.md](roadmap.en.md) | Vision + the ordered milestone sequence (single source of truth) |
| milestone | milestones/&lt;id&gt;-*.md | A phase's delivery goal and acceptance |
| issue | issues/&lt;milestone-id&gt;-*.md | Smallest work unit: background, goals, acceptance, scope |
| ADR | [../notes/](../notes/README.en.md) | Decision records reuse Agent Notes; issues reference them via the adr field |

## Machine-readable surface: the yaml flow fence

Every working file carries exactly one yaml flow fence; the pairing gate requires fences to be byte-identical across both sides, so machine-readable fields cannot drift between languages. Inside the fence is a yaml subset: top-level `key: scalar`, `key:` plus `- item` lists, a one-level nested map indented two spaces, inline lists `[a, b]`; scalars are limited to null, true/false, non-negative integers, and strings.

roadmap fence fields: `kind: roadmap`, `milestones` (ordered id list). milestone fence fields: `kind: milestone`, `id`, `title` (used for GitHub milestone sync), `status`, `github: {number, url}`. issue fence fields: `kind: issue`, `milestone`, `priority`, `status`, `bootstrap`, `scope` (file globs this issue may touch), `adr` (relative paths to Agent Notes), `github: {number, url}`.

## Closed sets

- issue status: `backlog` / `ready` / `in-progress` / `done`
- milestone status: `planned` / `active` / `done`
- priority: `P0` / `P1` / `P2` (P0 is highest)

## Numbering and references

- Issue ids are coupled to GitHub issue numbers: commits and PR titles reference them as `(#N)`.
- Draft transition state: an issue whose `github.number` is null may only sit in backlog; it may move on only after `pnpm flow:sync` backfills the number.
- Bootstrap exemption: the flow's own bootstrap issue cannot reference its own number, so `bootstrap: true` permits status moves without one; at most one such issue exists repo-wide and it must belong to the first milestone in the roadmap sequence; remove the flag once the number is backfilled.
- No exemption lane: even mechanical fixes reference an issue.

## Priority progression

- Same tier is serial across milestones: P0 of m(i+1) may start if and only if every P0 of earlier milestones is done; P1 and P2 each follow their own serial chain.
- Unlimited parallelism within a tier: several issues of the same milestone and tier may be in-progress at once.
- Step-down unlock: when the highest not-finished tier inside a milestone has exactly 1 issue left not done, the next tier unlocks.
- The rules gate eligibility for in-progress / done; ready is only a grooming marker, not a commitment.
- milestone status cross-checks with issues: a milestone is done if and only if all of its issues are done.

## Gates and interception points

| Check | Where | Coverage |
|---|---|---|
| `pnpm verify:flow` | local + CI static lane | every offline rule on this page |
| `verify-flow --diff <base>` | CI on PR | `(#N)` references in commit and PR titles, referenced issues in ready/in-progress, diff files covered by the referenced issues' scope union |
| `verify-flow-online` | CI online lane | two-sided consistency with GitHub: issue exists, milestone membership, state mapping, PR linked to a milestone and a project (see below) |
| commit-msg hook | local (`pnpm install:hooks`) | commit title carries `(#N)` (reminder-level; exhaustive coverage belongs to CI) |

## GitHub sync

`pnpm flow:sync` is the only entry point that writes the flow tree to GitHub (creates milestones / issues, backfills number/url, re-records pairing records); the CI online lane verifies without modifying. Requires a logged-in local gh.

Issues / milestones / state mapping check out with `GITHUB_TOKEN`; **a PR's project link** needs user-level Projects v2, where an app token only ever sees an empty list: with `FLOW_TOKEN` (a PAT carrying `project`) CI enforces it, otherwise it drops to a reminder and the local `pnpm verify:flow-online` enforces it.

## Tooling

`pnpm flow:new-issue -- --milestone <id> --priority <P0> --slug <kebab> --title <中文标题> --title-en <English title> --scope <glob,glob>` generates the issue trio skeleton.
