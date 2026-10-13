# Agent Note: macOS DMG install launch gate

Status: implemented

English | [中文](2026-10-13-macos-package-gate.md)

## Problem

A successful macOS build does not prove that an app launches after the user opens its DMG. Testing found a bundle without a valid resource seal, failing `codesign`, and Launch Services returning `kLSNoExecutableErr` for the standard open path. A bundle identifier ending in `.app` also conflicted with the application bundle extension.

## Decision

Change the bundle identifier to `dev.studywiki.desktop` and explicitly ad-hoc-sign the macOS bundle. Add a packaging gate that mounts the DMG in an isolated directory, copies the app, validates key structure, Info.plist identity, and `codesign --deep --strict`, then launches through Finder-equivalent `open -n -g`, confirms that the fresh process stays alive, and cleans up. The gate runs in PR macOS CI and before release artifact upload.

## Alternatives considered

- Check only that the DMG is non-empty: it cannot detect signing or Launch Services failures. Rejected.
- Launch only the executable: that bypasses bundle registration and resource-seal checks, so it does not represent the double-click path. Rejected.
- Continue requiring a developer certificate: certificate-less distribution would still degrade to an unsigned bundle. Rejected.

## Consequences

- PRs and releases fail when the macOS install path is broken; CI takes longer.
- Non-macOS installers still lack an equivalent standard launch smoke test.
- If real developer signing is enabled later, only the identity configuration changes; the gate remains reusable.
