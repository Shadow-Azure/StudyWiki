# Agent Note: 蓝本半步差距收口（改动面路由 / 提示词渲染 / 自测入叶 / 组成树生成区）

Status: implemented

[English](2026-09-09-half-step-gates.en.md) | 中文

## Problem

对照蓝本（dsh 十步流水线）第二轮复盘（2026-09-09，main @ 888798d）定位四处半步差距：① 第 6 步只有人肉选 lint:docs / verify:docs，没有"改动面 → 门禁组合"的机械路由；② 第 5 步翻译提示词只有占位符集合校验（verify-terminology ③），模板本身能否渲染、被无意改动有没有门禁知道，无背书；③ 第 7 步文档标准自测试只在 pnpm test / CI 跑，本地 verify:docs 不连带（蓝本是 quick doc 叶）；④ 架构地图是手写树——蓝本同型物是生成物，本库漂移要等门禁红后再手工修。

## Decision

- route-gates.mjs + `pnpm route:gates`：纯分类函数 + CLI，默认看工作树（git status --porcelain），`--base <ref>` 看区间；路由表五组（src-tauri / src / scripts / 文档语料 / 接线与依赖）+ 快速档回退，并集按固定顺序（build → test → verify:docs）。是建议不是门禁，穷尽覆盖归 CI。
- translation-prompt.spec.mjs：从 docs/i18n/translation-prompt.md 抽 ```text 模板围栏，用合成术语表 + 合成文档渲染三占位符，与内联快照逐字比对；另断言英文侧围栏逐字一致。合成夹具不触真语料——改配对文档不该搅动提示词快照。
- run-gates 新叶 gate-self-tests（spawn vitest run）：进 doc-sync 与 release，刻意不进 doc-quick（秒级承诺优先）；取舍由 ci-wiring spec 钉住。
- 组成树从手写围栏升级为生成区：gen-code-map.mjs 扫 src/**/*.{ts,css} 与 src-tauri/src/**/*.rs，职责从 code-map.manifest.json（唯一 home，新文件不登记 gen 即红）取，内部依赖从源码 import 推导（TS 相对 import；Rust mod 声明 + [lib] crate 引用），写入 architecture.md 两侧生成区（逐字节一致）；`--check` 即新叶 verify-code-map（doc-quick）。styles.css 借此首次登树。

## Alternatives considered

- 组成树 A 方案（手写树 + 双向对账门禁，不生成）：对账只让漂移变红，修仍靠手工；生成区方案同为恰好一叶门禁，但漂移在结构上不可能（区域是机器地盘，手改即红），故弃 A 取 B。
- 职责描述放源文件头注释（`//!` / `//` / `/* */`）：贴着代码，但要新增全文件头注释约定，三种注释语法解析易被 license/banner 类头部绊住；dsh 的 JSDoc→catalog 成立是因为导出注释本来就强制存在，组成树描述没有这个既有载体。选 manifest（doc-budgets.manifest.json 先例）。
- 双叶防御（生成区新鲜度 + 独立对账门禁同设）：两叶查同一不变量，只增加失败源不增加安全；生成器扫描面的盲区由 gen-code-map.spec 夹具兜（gate-coverage 强制 spec 存在）。
- 提示词响应解析测试（蓝本有三段式 XML 响应解析）：本库产出契约是"英文侧文件全文"直接可用，没有可机检的响应格式，无物可测，只做渲染 + 快照。
- 照搬蓝本 gen-module-graph（workspace 包依赖图）：本库无 workspace；它的机械对应物是文件级内部依赖，已并入 code-map 生成器。外部依赖不进图——管辖权在 environment-independence，两处登记会打架。
- gate-self-tests 进 doc-quick：vitest 启动秒级成本会把快速档时间翻倍，与"秒级随手跑"定位冲突，退到 doc-sync。

## Consequences

- 新源文件的动作链固定：code-map.manifest.json 登记职责 → `pnpm gen:code-map` → 提交；忘登记在 doc-quick 即红（比原对账方案更早一步）。
- 本地 `pnpm verify:docs` 与 CI 静态 lane 同构（含自测试）；CI 重跑 vitest 约三秒，接受。
- 组成树的排序与列对齐由生成器决定（扫描根固定序 + 最长名对齐），手工排版自由度让位。
- 蓝本对齐到此为合理停止点：残留 = 第 8 步站点投影 + 外链探活（缓建）+ 五处刻意深度差（change-scope 通用性、提示词双向与响应解析、run-gates 引擎、doc-standard-tests 叶位置、pre-push 罩面）。
- 预算随常驻面扩容：AGENTS.md 660→690、docs/AGENTS.md 700→710（压缩后仍差 28/10；理由：常驻命令清单新增 gen:code-map 与 route:gates 两条、docs/AGENTS.md 生成区规则句扩为双命令）。
