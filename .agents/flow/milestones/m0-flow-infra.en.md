# M0 Flow infrastructure

English | [中文](m0-flow-infra.md)

```yaml flow
kind: milestone
id: m0
title: 流程基建
status: active
github:
  number: null
  url: null
```

## Goal

Land the roadmap → milestone → issue → ADR development flow and its gates, making "file an issue before writing code" a mechanically enforced path.

## Acceptance

- verify-flow / verify-flow --diff / verify-flow-online are wired into local checks and CI.
- The prototype requirements are decomposed into the m1–m4 milestone sequence on the roadmap.

## Issues

- [Land the development-flow gates](../issues/m0-01-dev-flow-gates.en.md)
