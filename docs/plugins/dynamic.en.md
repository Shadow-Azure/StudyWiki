# Dynamic loading

English | [中文](dynamic.md)

> Type: reference | Readers: plugin authors, AI agents and maintainers. Writing a plugin lives in [contract.md](contract.en.md); publishing in [authoring.md](authoring.en.md).

## Behaviour contract

Plugin-panel actions (topbar "插件") take effect in this window immediately: install/import (registry or local tgz → on disk → manifest → activate), toggle, reload, remove and rollback. Manifest updates use a serial read-modify-write chain in this window, with failures releasing the chain; there is no cross-window lock, concurrent writes are last-writer-wins, and the next start aligns with the final manifest. Other windows do not follow immediately; the manifest is the cross-window source of truth.

## Reload

Reload validates before it switches: the new code must pass the load checks (shape / apiVersion / inject shape) before the old version is touched, and when the activation audit (polling the fiber to ACTIVE, 2 second ceiling) fails, the host restores the in-memory old module and reports the error inside the panel row. Operations on the same plugin are queued serially, so rapid clicks never interleave.

## Version store

Successful activation leaves a snapshot generation (`plugins/.history/<name>/`, deduplicated by content hash, 10 generations per plugin); when a failed reload restores the in-memory old module, the bad live directory is not snapshotted and no never-ran generation is added. The panel's "历史" (history) expands the version list and "回退" (roll back) atomically writes the chosen generation back to the live directory — an enabled row hot-reloads it right away, a disabled row only lands it on disk for the next activation. "（当前）" is a disk fact, not a runtime fact; a bad live directory may have no matching generation, every list row may lack the marker, and memory still runs the old module. `meta.json` contains only hash, createdAt, version and apiVersion, with the entry name coming from package.json; extra fields in older metadata remain readable, while generations with missing or corrupt metadata are omitted. The store only grows and never activates; removal deletes the live directory first and cleans history best-effort, logging failures without blocking.

## Where activation failures land

Install-then-activate failure: the directory and the manifest row stay, the panel row names the reason, and the next start retries automatically. Disable and rollback failures: the previous state is kept and the error shows inline. A row that failed to load affects no other plugin.
