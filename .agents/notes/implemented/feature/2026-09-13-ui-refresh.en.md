# Agent Note: Workspace visual system redesign

Status: implemented

English | [中文](2026-09-13-ui-refresh.md)

## Problem

The frontend was unstyled native controls: default browser buttons, text-glyph icons (▸ ▾ ▶ ●), no reading typography (markdown-body completely bare), and a modal panel with a hardcoded white background. As a study client built for long reading sessions, both look and legibility fell short — and there was no token layer, leaving future UI changes without a system to follow.

## Decision

Establish a workspace visual system (single styles.css, no logic):

- **Dual-theme tokens**: both themes use neutral surfaces and ink text, semantically layered into surfaces (chrome/paper/raise/code-bg/stage), lines (two hairline steps), ink (three text steps), color (blue for interaction / red reserved for unsaved and warnings), type (13px system sans for UI / 17px serif reading stack / mono stack), and a radius scale (5/8px). Modeled on the VS Code workbench token pattern (isomorphic to `--vscode-*`), switching via `prefers-color-scheme`.
- **Document-workspace hierarchy**: the topbar is fixed to brand, centered active filename, and icon actions on the right; the sidebar header sticks; reading and editing share a 760px measure; the document toolbar sticks with an explicit preview/edit segmented control, while save uses a red dirty dot and exposes its shortcut through `aria-keyshortcuts`.
- **Resizable sidebar**: a full-height 1px hairline sits between sidebar and main; the line occupies no grid track, with only an invisible 7px pointer target behind it. Dragging writes `--sidebar-size`. The sidebar's absolute bounds are 210–520px while main keeps at least 340px; when the window narrows, the effective sidebar cap follows the viewport and updates `aria-valuemax`, so it remains about 380px at the 720px minimum window. Arrow/Home/End keys update `aria-valuenow`.
- **The Markdown editing surface is a document surface**: CodeMirror uses `minimalSetup` (no line-number or fold gutter), forced wrapping, transparent background, the 17px reading serif stack, and token-driven Markdown highlighting; editing shares the preview's 760px measure rather than presenting the page as one code block. `@lezer/highlight` is promoted from transitive to direct dependency solely for this build-time-packaged theme contract.
- **Red is semantic only**: the unsaved dot and error banners; welcome/brand seals use ink so decorative blocks do not compete with content.
- **The brand mark is an iceberg**: the UI uses the 16px-grid inline SVG (ice surface above, submerged mass and waterline below), while native PNG/ICO/ICNS assets derive from one 1024px deep-sea gradient master; `src-tauri/icons/iceberg.svg` is the editable source.
- **Inline SVG icon library** (src/ui/icons.ts): 16px-grid currentColor strokes, built from declarative (tag, attrs) fragments via explicit `createElementNS`. **WebKit (WKWebView) does not paint SVGs parsed out of `div.innerHTML`** (Chrome is fine; static markup and createElementNS both paint — isolated with a four-variant probe) — explicit construction is the only path consistent across all three engines. The cost is that the namespace URI literal trips the env-independence URL scan; the exemption is registered per contract (exemption table in docs/environment-independence.md + the gate's exact-URI allowlist): the URI is a DOM-spec identifier, never fetched, and the gate must not widen it to the entire `www.w3.org` host.
- **Browser visual preview** (src/preview.ts + preview.html): assembles the real app-shell, file tree, Markdown, video, windows, and plugin-manager plugins with an in-memory host; slot behavior matches production `SlotsService` (one child element per renderer). The entry serves local Vite inspection only and is not part of the published `index.html` entry.
- **DOM contract tests move with the UI**: tree names remain isolated spans; segmented modes expose `aria-pressed`; topbar icon commands expose `aria-label`/`title`; non-matching viewer plugins hide their own slot so an empty slot cannot push video below the viewport.
- **Save-error lifecycle**: a failed write can be dismissed manually; if it remains open, a later successful save clears it so saved state never continues to report failure.
- **Semantics strengthened**: tree rows get aria-expanded/aria-current, the panel gets role=dialog + Escape-to-close + autofocus on the install input + Tab/Shift+Tab focus trapping + focus restoration to its opener, icon buttons get aria-label, a global `:focus-visible` ring, and reduced-motion kills all animation.

## Alternatives considered

- **A UI framework (Vue/React component kit)**: forbidden by repo constraint; CSS-variable tokens are the professional standard for framework-free clients (isomorphic to VS Code/cc-switch/waveterm).
- **Copying DSH's chat-style three-column interface**: DSH's durable lessons are token layering and a stable grid, not its information architecture; StudyWiki's primary object is a document, so it uses a two-column document workspace.
- **Bundling a CJK webfont**: a full Source Han Serif is 10MB+, a bad offline-size trade; system serif stacks (Songti SC/SimSun) ship on both mac and Windows.
- **Keeping text-glyph icons** (▸ ▶ ●): font-fallback is uncontrollable, they cannot be colored, and they pollute textContent assertions.

## Consequences

- All future UI goes through tokens + the icon library + `labelButton` (src/ui/dom.ts); no more raw color values, text glyphs, or hand-rolled button boilerplate; new icons register in one place (ICONS in icons.ts).
- CodeMirror presentation is injected through `EditorView.theme` plus `HighlightStyle`; syntax colors reference existing CSS tokens and track the theme. Do not restore line/fold gutters and re-frame editing as a code block.
- The video stage (near-black) is decoupled from themes: the viewing surface stays dark.
- Markdown and video plugins hide their own slots when the active kind does not match; the host still owns slot creation and plugins own only visibility.
- The browser preview is not a release entry and must not introduce real Tauri APIs or runtime branches; extend it first when adding UI surfaces so visual inspection remains repeatable.
- When changing native icons, update `iceberg.svg` and the 1024px master first, then derive every size; never hand-edit one small platform asset into divergence.
- The plugin panel's Escape listener lives on document (after a full re-render destroys the focused element, events no longer pass through the overlay subtree).
