# Agent Note: "Study Room" visual system redesign

Status: implemented

English | [中文](2026-09-13-ui-refresh.md)

## Problem

The frontend was unstyled native controls: default browser buttons, text-glyph icons (▸ ▾ ▶ ●), no reading typography (markdown-body completely bare), and a modal panel with a hardcoded white background. As a study client built for long reading sessions, both look and legibility fell short — and there was no token layer, leaving future UI changes without a system to follow.

## Decision

Establish the "Study Room" visual system (single styles.css, no logic):

- **Dual-theme tokens**: Paper (light) / Ink (dark), semantically layered into surfaces (chrome/paper/raise/code-bg/stage), lines (two hairline steps), ink (three text steps), color (azurite for interaction / cinnabar reserved for semantic marks), type (13px system sans for UI / serif stack at 17px·line-height 2 for reading / mono stack), and a radius scale (5/8/11px). Modeled on the VS Code workbench token pattern (isomorphic to `--vscode-*`), switching via `prefers-color-scheme`.
- **The typographic hero lives on the reading surface**: serif body, 760px book measure, h2 chapter rule, cinnabar-tinged left rule on blockquotes; the tool surfaces keep VS Code-style calm density.
- **Cinnabar is semantic only**: the unsaved-edit mark (save-btn.dirty::after), error banners, and the welcome seal (a white-on-red stamp of 「学」); interactive color is uniformly azurite.
- **Inline SVG icon library** (src/ui/icons.ts): 16px-grid currentColor strokes, built from declarative (tag, attrs) fragments via explicit `createElementNS`. **WebKit (WKWebView) does not paint SVGs parsed out of `div.innerHTML`** (Chrome is fine; static markup and createElementNS both paint — isolated with a four-variant probe) — explicit construction is the only path consistent across all three engines. The cost is that the namespace URI literal trips the env-independence URL scan; the exemption is registered per contract (exemption table in docs/environment-independence.md + the gate's ALLOWED list): the URI is a DOM-spec identifier, never fetched.
- **Surgical DOM changes** (test contracts untouched): tree file names live in their own span (the exact `textContent === "a.md"` assertion still passes); toolbar button order preserved (mode first, save second); SVGs contribute no textContent, so icons can enter nodes under text assertions freely; plugin panel buttons keep pure-text textContent (exact match on "安装").
- **Semantics strengthened**: tree rows get aria-expanded/aria-current, the panel gets role=dialog + Escape-to-close + autofocus on the install input, icon buttons get aria-label, a global `:focus-visible` ring, and reduced-motion kills all animation.

## Alternatives considered

- **A UI framework (Vue/React component kit)**: forbidden by repo constraint; CSS-variable tokens are the professional standard for framework-free clients (isomorphic to VS Code/cc-switch/waveterm).
- **Bundling a CJK webfont**: a full Source Han Serif is 10MB+, a bad offline-size trade; system serif stacks (Songti SC/SimSun) ship on both mac and Windows.
- **Keeping text-glyph icons** (▸ ▶ ●): font-fallback is uncontrollable, they cannot be colored, and they pollute textContent assertions.

## Consequences

- All future UI goes through tokens + the icon library + `labelButton` (src/ui/dom.ts); no more raw color values, text glyphs, or hand-rolled button boilerplate; new icons register in one place (ICONS in icons.ts).
- CodeMirror syntax colors are overridden via `--syn-*` tokens (tok-* class selectors), tracking the theme.
- The video stage (near-black) is decoupled from themes: the viewing surface stays dark.
- The topbar filename (topbar-file) and tree active-row highlight add file-opened subscriptions, both torn down inside their plugins.
- The plugin panel's Escape listener lives on document (after a full re-render destroys the focused element, events no longer pass through the overlay subtree).
