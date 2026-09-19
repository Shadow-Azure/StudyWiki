# M0 流程基建

[English](m0-flow-infra.en.md) | 中文

```yaml flow
kind: milestone
id: m0
title: 流程基建
status: active
github:
  number: null
  url: null
```

## 目标

落地 roadmap → milestone → issue → ADR 的开发流程与门禁，让"先立 issue 再写代码"成为机械强制路径。

## 验收

- verify-flow / verify-flow --diff / verify-flow-online 三档检查接入本地与 CI。
- 原型诉求拆成 roadmap 的 m1–m4 milestone 序列。

## Issues

- [开发流程门禁落地](../issues/m0-01-dev-flow-gates.md)
