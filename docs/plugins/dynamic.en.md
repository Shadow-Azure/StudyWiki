# Dynamic loading

English | [中文](dynamic.md)

> Type: reference | Readers: plugin authors, AI agents and maintainers. Writing a plugin lives in [contract.md](contract.en.md); publishing in [authoring.md](authoring.en.md).

## Behaviour contract

Every action in the plugin panel (topbar "插件") takes effect immediately in this window and no longer asks for a restart: install and import (registry or local tgz → on disk → manifest → activate here), the enable/disable toggle, reload (click it after editing code), remove, and version rollback. Other windows do not follow — they align with the manifest naturally at their next start, and the manifest is the single source of truth for cross-window consistency.

## Reload

Reload validates before it switches: the new code must pass the load checks (shape / apiVersion / inject shape) before the old version is touched, and when the activation audit (polling the fiber to ACTIVE, 2 second ceiling) fails, the host restores the in-memory old module and reports the error inside the panel row. Operations on the same plugin are queued serially, so rapid clicks never interleave.

## Version store

Every successful activation leaves a snapshot generation (`plugins/.history/<name>/`, deduplicated by content hash, 10 generations per plugin). The panel's "历史" (history) expands the version list and "回退" (roll back) atomically writes the chosen generation back to the live directory — an enabled row hot-reloads it right away, a disabled row only lands it on disk to take effect at the next activation. The "（当前）" marker in that list is a disk fact (Rust compares the live directory's content hash), not a runtime fact: after a failed reload the old module keeps running in memory while the live directory already holds the new code. The store only grows and never activates anything by itself; removing a plugin deletes its history too (the panel asks for confirmation).

## Where activation failures land

Install-then-activate failure: the directory and the manifest row stay, the panel row names the reason, and the next start retries automatically. Disable and rollback failures: the previous state is kept and the error shows inline. A row that failed to load affects no other plugin.
