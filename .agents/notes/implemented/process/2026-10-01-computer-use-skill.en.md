# Agent Note: Generic Computer Use calling conventions

Status: implemented

English | [中文](2026-10-01-computer-use-skill.md)

## Problem

Codex Computer Use does not expose separate click, typing, or screenshot tools; it is reached by dynamically loading `@oai/sky` through `node_repl`. Without an in-repo explanation, later sessions can mistake it for a set of nonexistent first-class actions or reuse stale accessibility indexes.

## Decision

Add `.agents/skills/computer-use/SKILL.md` to capture the generic calling contract: dynamic import, application addressing, the `get_app_state` read surface, screenshot presentation, common actions, failure semantics, authorization boundaries, and a small-step execution rhythm. It explains only how to use Computer Use and is not coupled to a product smoke workflow.

## Alternatives considered

- Keep only a global skill: it lacks in-repo discoverability and does not make the entry point reliably available to this project's sessions. Rejected.
- Put a desktop test workflow into the skill: that couples a generic tool explanation to the current task and reduces reuse. Rejected.
- Rely on chat memory: the Computer Use surface and index lifecycle are easy to remember incorrectly. Rejected.

## Consequences

- Invoke `$computer-use` explicitly when viewing, clicking, typing into, or screenshotting desktop UI.
- Re-read the accessibility tree and resolve fresh indexes after every interface change.
- Confirm authorization before mutations, secrets, or system settings; the tool remains a generic desktop UI operation surface.
