# Agent Note: Computer Use 冒烟报告技能

Status: implemented

[English](2026-10-13-computer-use-smoke-reporting.en.md) | 中文

## Problem

Computer Use smoke 会产生截图、无障碍证据、缺陷结论和自动化覆盖判断。若每次直接手写 HTML，证据路径、转义、状态语义和回归声明容易漂移，报告也难以复用。

## Decision

新增 `computer-use-smoke-reporting` 技能：先收集稳定截图与脱敏 JSON，再用本地渲染器生成独立 HTML。模板只负责展示；渲染器转义用户文本、校验截图证据、检查未替换标记，并要求报告数据和证据先于 HTML 存在。

## Alternatives considered

- 继续手写 HTML：生成物会变成事实来源，难以复跑和审计。否。
- 把 StudyWiki 场景写进通用技能：会破坏可复用性，应用细节应留在当次 JSON。否。
- 只保存截图：缺少状态矩阵、根因、修复状态和覆盖结论，不能支撑检视决策。否。

## Consequences

- 冒烟报告必须先维护 JSON 与稳定证据，再生成 HTML。
- 报告不得手工编辑；需要修正时先改 JSON 后重渲染。
- 所有证据必须脱敏，禁止把密钥、令牌或私有绝对路径带进报告。
