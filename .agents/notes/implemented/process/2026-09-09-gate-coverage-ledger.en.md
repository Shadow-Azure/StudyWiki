# Agent Note: Gate self-test ledger and three coverage holes

Status: implemented

English | [中文](2026-09-09-gate-coverage-ledger.md)

## Problem

The meta-guards note claimed "self-tests brought up to full leaf coverage", but that invariant had no red gate of its own — and filling the holes proved it does decay: verify-release (a real leaf of the release mode; version consistency is a shipping gate) and i18n-merge-driver (the only component that auto-rewrites pairing records) had no specs; the pairing CLI (verify-translation-pairing) had its orchestration layer — checkPair, switcher lines, link locale, corpus discovery — untested beyond the pure-logic lib. Writing the missing specs immediately surfaced two real bugs: ① localeViolations fed `isScopeFile` an **absolute path** from `path.resolve`, but it expects repo-relative paths, so the corpus test was always false and the whole loop continued — the link-locale check had been dead code since it landed (PR #2); ② once revived it false-positived on the real corpus — the i18n README quotes the switcher-line format inside inline code, and those example "links" were treated as real ones.

## Decision

- Added `scripts/gate-coverage.spec.mjs` (the ledger spec): every non-spec script under scripts/ must carry a same-name spec or be registered in an explicit `COVERED_BY` map (run-gates → ci-wiring, install-merge-driver → install-git-hooks, pairing CLI → both the pure-logic lib spec and a CLI orchestration spec); specs named by the map must actually exist, so the map itself cannot rot; spec-fixture is registered as test infrastructure, not a gate.
- verify-release refactored to export `checkVersions` + main guard (pure refactor, CLI output unchanged), with a subprocess e2e spec: all three consistent passes, Cargo.toml drift fails with the diff, `--tag` match and mismatch.
- i18n-merge-driver extracted a pure `decideMerge` + main guard, with a four-branch spec: both sides identical, one side untouched (×2), both sides re-recorded → conflict handed back to git.
- The pairing CLI got a fixture spec (createGateRunner; default() with no args is the full-corpus check): complete trio passes, one side edited without re-recording fails, missing English side fails, locale violation fails, imprecise switcher line fails (after re-recording, hashes reconcile and the switcher check surfaces independently), excluded file carrying an English side fails, links inside inline code and fences are examples and pass.
- Two locale fixes: `path.resolve` → `path.join` (stays repo-relative; `../` normalized); per-line cleaning of inline code and fences (line numbers preserved against the original), bringing example links in line with every other link gate's stance.

## Alternatives considered

- Coverage tooling / import analysis for the ledger: too heavy for .mjs gate scripts and the output is hard to review; "same-name spec + explicit map" is the minimal readable mechanism — a new script without a spec goes red, and map changes are visible in the PR diff.
- Testing verify-release via fixture import of `checkVersions`: kept the subprocess e2e — the exit code is the verdict CI consumes, so the CLI path itself deserves the test.
- Registering the i18n README in the exemption manifest instead of fixing the false positive: that writes a checker defect into a whitelist, and the next document quoting an example would need another entry; cleaning inline code/fences is a stance fix, done once.
- Splitting the dead-code fix into its own PR: the specs and the bugs they exposed are one causal unit of the same "gates for the gates" work; splitting would require transitional prose about a dead-check state.

## Consequences

- "Every gate has a self-test" now has gate backing: a new script without a spec goes red at `pnpm test`, and the meta-guards claim no longer dangles.
- The link-locale check is live for the first time; the corpus is currently clean (green), and from now on an English side mistakenly using `.md` links goes red.
- Self-tests grew 92 → 108 cases (16 → 20 spec files); merge-driver and verify-release move to the exportable + main-guard structure, matching the other gates.
- gate-coverage's map is a new dual-home contract (CLI-wrapper-style scripts must register); its existence assertions back it.
