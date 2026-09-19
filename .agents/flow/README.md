# 开发流程

[English](README.en.md) | 中文

> 契约 home：roadmap → milestone → issue → ADR 四层工作文件的格式、状态机与门禁。机械执行归 `verify-flow` / `verify-flow --diff` / `verify-flow-online`，本页只说规则。

## 层级

| 层 | 文件 | 职责 |
|---|---|---|
| roadmap | [roadmap.md](roadmap.md) | 愿景 + milestone 有序序列（唯一事实源） |
| milestone | milestones/&lt;id&gt;-*.md | 阶段交付目标与验收 |
| issue | issues/&lt;milestone-id&gt;-*.md | 最小工作单元：背景、目标、验收、scope |
| ADR | [../notes/](../notes/README.md) | 决策记录复用 Agent Notes，issue 以 adr 字段关联 |

## 机读面：yaml flow 围栏

每个工作文件带且仅带一个 yaml flow 围栏；配对门禁要求围栏两侧逐字节一致，机读字段因此天然不漂移。围栏内是 yaml 子集：顶层 `key: 标量`、`key:` 加 `- 项` 列表、缩进两格的一层嵌套 map、行内列表 `[a, b]`；标量只认 null、true/false、非负整数、字符串。

roadmap 围栏字段：`kind: roadmap`、`milestones`（id 有序列表）。milestone 围栏字段：`kind: milestone`、`id`、`title`（GitHub milestone 同步用）、`status`、`github: {number, url}`。issue 围栏字段：`kind: issue`、`milestone`、`priority`、`status`、`bootstrap`、`scope`（允许触碰的文件 glob 列表）、`adr`（Agent Note 相对路径列表）、`github: {number, url}`。

## 封闭集合

- issue status：`backlog` / `ready` / `in-progress` / `done`
- milestone status：`planned` / `active` / `done`
- priority：`P0` / `P1` / `P2`（P0 最高）

## 编号与引用

- issue 编号耦合 GitHub issue 编号：提交与 PR 标题用 `(#N)` 引用。
- draft 过渡态：`github.number` 为 null 的 issue 只能处于 backlog；`pnpm flow:sync` 回填编号后才能流转。
- bootstrap 豁免：流程自举的 issue 无法挂自身编号，`bootstrap: true` 允许无编号流转；全库至多一个，且必须属于 roadmap 序列的第一个 milestone；编号回填后移除该标记。
- 无豁免通道：机械修复同样挂 issue。

## 优先级推进

- 跨 milestone 同档串行：m(i+1) 的 P0 可开工，当且仅当之前 milestone 的 P0 全部 done；P1、P2 同理各走各的串行链。
- 档内并行不限：同 milestone 同档位可同时多个 in-progress。
- 退档解锁：milestone 内最高未清档仅剩 1 个未 done 时，下一档解锁。
- 规则约束 in-progress / done 的资格；ready 只是"已备好"的梳理标记，不构成承诺。
- milestone status 与 issue 互检：milestone 为 done 当且仅当其 issue 全部 done。

## 门禁与拦截点

| 检查 | 位置 | 内容 |
|---|---|---|
| `pnpm verify:flow` | 本地 + CI 静态 lane | 本页全部离线规则 |
| `verify-flow --diff <base>` | CI on PR | commit 与 PR 标题的 `(#N)` 引用、被引 issue 处于 ready/in-progress、diff 文件落在所挂 issue 的 scope 并集内 |
| `verify-flow-online` | CI 在线 lane | 与 GitHub 双侧一致：issue 存在、milestone 归属、状态映射、PR 关联 project 与 milestone |
| commit-msg 钩子 | 本地（`pnpm install:hooks`） | 提交标题含 `(#N)`（提醒级，穷尽覆盖归 CI） |

## GitHub 同步

`pnpm flow:sync` 是把流程树写到 GitHub 的唯一入口（建 milestone / issue、回填 number/url、重录配对记录）；CI 在线 lane 只校验不修改。需要本机 gh 已登录。

## 工具

`pnpm flow:new-issue -- --milestone <id> --priority <P0> --slug <kebab> --title <中文标题> --title-en <English title> --scope <glob,glob>` 生成 issue 三件套骨架。
