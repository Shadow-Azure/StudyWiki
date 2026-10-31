# Agent Note: README product tour and video entry

Status: implemented

English | [中文](2026-10-30-readme-product-tour.md)

## Problem

The original README led with development commands and repository layout, making the product's value hard for first-time visitors to grasp and showing no real interface. With multi-format reading, Agent, and plugin capabilities in place, the entry point needed to reflect that maturity without expanding into a long page duplicating the architecture docs.

## Decision

The homepage now follows a sequence of one-line value, real workspace, four connected experiences, source quick start, and offline boundaries. It draws on the above-the-fold communication of TradingAgents, Impeccable, Superpowers, and T3 Code from GitHub Trending without copying their badges, news sections, or long installation matrices. A roughly one-minute landscape Chinese video introduces the product using screenshots from an isolated current `main` build and MiMo TTS narration. The README image is also the video entry point. Screenshots use fictional demo material and exclude user plugins, model configuration, and personal files.

## Alternatives considered

- Copy editing alone: inexpensive but unable to show the desktop product's form.
- An animated GIF: useful for a short interaction but weak for a complete narrative and unable to carry spoken explanation.
- Badges and a full feature table: common on high-star projects but adds maintenance and dilutes the core workflow.
- Screenshots from an existing personal profile: faster but risks exposing settings and mixes in plugins that do not match `main`.

## Consequences

The Chinese and English READMEs retain mirrored structure and the 350-word budget. The assets in `docs/assets/` must evolve with the interface; significant feature changes should trigger a new recording rather than letting media become a stale source of truth. Video intermediates remain in the local reports directory, while the repository keeps only the finished presentation assets.
