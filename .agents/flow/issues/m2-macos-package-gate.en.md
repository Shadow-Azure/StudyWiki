# macOS DMG install launch gate and bundle identity fix

English | [中文](m2-macos-package-gate.md)

```yaml flow
kind: issue
milestone: m2
priority: P1
status: done
scope:
  - .agents/flow/issues/m2-macos-package-gate.*
  - walkthrough/assets/m2-macos-package-gate/**
  - .agents/flow/milestones/m2-ai-agent-host.*
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - AGENTS.md
  - scripts/verify-env-independence.*
  - scripts/verify-macos-package.mjs
  - scripts/verify-macos-package.spec.mjs
  - package.json
  - src-tauri/tauri.conf.json
  - docs/release-checklist.*
  - .agents/notes/**
adr: []
github:
  number: 55
  url: https://github.com/Shadow-Azure/StudyWiki/issues/55
```

## Background

Smoke testing showed that the DMG can be generated and mounted, and the installed `.app` contains its binary, sidecar and resources; however, the installed bundle lacks sealed resources, `codesign --verify` fails, and the Launch Services open path reports `kLSNoExecutableErr`. The compile chain is therefore usable, while macOS bundle identity, signature sealing and standard launch verification are incomplete. The current release workflow only checks that an installer exists and cannot catch this double-click failure mode.

## Goals

- Use a stable reverse-DNS bundle identifier that does not end in `.app`, removing the conflict with the macOS application bundle extension.
- Require the macOS bundle to be explicitly signed with an ad-hoc identity and have a complete resource seal; even certificate-less distribution must remain recognizable to Finder and Launch Services.
- Add a mechanical packaging gate that mounts the DMG, copies the app to an isolated location, validates Info.plist and codesign, then starts it through standard `open` and cleans up the process.
- Wire the gate into the PR macOS lane and the release macOS lane; fail before installer upload.

## Acceptance

- `verify-env-independence` mechanically rejects bundle identifiers ending in `.app`, with a UT for the configuration constraint.
- The `verify-macos-package` script covers DMG lookup, installed bundle layout, codesign validation and the standard launch path, with UTs for helper logic.
- A local macOS DMG packaging smoke passes, with the artifact passing codesign and `open` validation.
- The PR/release macOS lanes run the packaging gate, and remote CI is green after push.
