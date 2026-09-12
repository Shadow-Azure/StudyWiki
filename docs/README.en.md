# Documentation index and maintenance mechanics

English | [中文](README.md)

This repo treats documentation as an artifact on par with code: behind every "should stay consistent" soft requirement stands a gate script that goes red. Humans only make judgments (tradeoffs, translation tradeoffs, archiving); consistency belongs to the machine. The mechanics are modeled on the deepseek-harness docs-as-code pipeline. Every in-scope document is maintained as a Chinese/English pair (contract in [i18n/README.en.md](i18n/README.en.md)).

## Document map

| Document | Role |
|---|---|
| [AGENTS.md](../AGENTS.md) | Standing orders (root) |
| [architecture.md](architecture.en.md) | Architecture map (with type-equiv fence) |
| [environment-independence.md](environment-independence.en.md) | Environment-independence constraints + exemption registry |
| [development.md](development.en.md) | Contributor onboarding |
| [plugins/authoring.md](plugins/authoring.en.md) | External plugin authoring guide (closed contract / quick start / trial install / publish / trust model) |
| [commands.md](commands.en.md) | Tauri command catalog (generated region) |
| [i18n/README.md](i18n/README.en.md) | Bilingual pairing contract |
| [i18n/terminology.md](i18n/terminology.en.md) | Terminology alignment (banned alternates gate-backed) |
| [i18n/translation-prompt.md](i18n/translation-prompt.en.md) | Operational template for adding the English side |
| [AGENTS.md](AGENTS.md) (docs subtree standard) | Tiering, writing rules, gates |
| [release-checklist.md](release-checklist.en.md) | Release gate checklist |
| [postmortem/README.md](postmortem/README.en.md) | Incident-review tier description |

Every new `docs/**/*.md` must be registered in this table or the index gate goes red (`scripts/verify-doc-index.mjs`; the `.en.md` side registers with its base, not separately). Word budgets are enforced by `scripts/doc-budgets.manifest.json` (base side only); this table is just the index.

## Lifecycle in ten steps

Rule injection (layered AGENTS) → decision records (Agent Notes) → as-is docs (docs/, bilingual triplets) → types into docs (type-equiv fences + manifest, gate-notarized verbatim equivalence with source) → catalog generation (`pnpm gen:commands`, verify is `--check`) → bilingual pairing (verify-translation-pairing, hashes + structure signature) → local verification (run-gates tiers) → CI adjudication (ci.yml static lane embeds doc-sync) → release projection (release-checklist) → archiving and review (postmortem).

Divergence from the blueprint: no VitePress projection site (no external publishing need; restore with an Agent Note when that changes). The bilingual direction is reversed from the blueprint — Chinese is the base (`foo.md`) plus an English side (`foo.en.md`); the pairing mechanics are symmetric.

## Agent Notes

Decision records (the why, what was rejected) live not in docs/ but in [.agents/notes/](../.agents/notes/README.en.md) — a separate system where the path is the state machine, also paired bilingually.
