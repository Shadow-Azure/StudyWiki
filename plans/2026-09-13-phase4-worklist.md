# Phase 4 工作清单（范围登记）

登记日期：2026-09-13｜性质：Phase 4 范围滚动登记，正式实现计划（plans/yyyy-mm-dd-phase4-*.md 五任务式）动工时另立，本清单是它的原料。

## 主体方向（已拍板，2026-09-13，详见 pr15-review §6.11）

AI agent 写插件（产品内置 cordis 简易 agent + 快速配置自定义模型）+ 动态化（agent 自定义软件 / 发布分享 / 生态拓展）+ guard 收权必做。合成路线：不搬 dsh 闭包求值与 CSP——blob 装载缝 + inject 收权 + 面板单入口热重载。前置硬点四件：运行期网络第二豁免（opt-in）、密钥存放新决策（app 配置域非 manifest）、guard 边界诚实化、运行期激活审计。

落地情况（2026-09-16 阶段）：合成路线三件 ✅ 已落地（本阶段）——blob 装载缝（Phase 2）、inject 收权（guard 门面）、面板单入口热重载；前置硬点中 guard 边界诚实化 ✅ 已落地（本阶段）、运行期激活审计 ✅ 已落地（本阶段）；运行期网络第二豁免（opt-in）与密钥存放新决策未动（仍属 agent 阶段）。

## 启动性能工作项（2026-09-13 用户拍板纳入，来源：启动卡顿根因调查）

调查基线（实测数据与测量方法见 memory `studywiki-startup-perf-baseline`）：Gatekeeper 未公证评估 ~2s 是 open 形态最大层；内置插件激活仅 ~150ms 非瓶颈；dev 形态 = Rust 增量编译 ~6s + vite 冷瀑布 1.9s 固有。

- [ ] **W1 发布签名 + 公证**：正式 Developer ID 签名 + notarization（tauri.conf / CI 发布档接线）。消除 `open` 启动时 macOS 对未公证 ad-hoc app 的每次本地评估（实测同机对照：已公证 Calculator 0.92s vs 本 app 2.5–3.3s 出窗口，直接 exec 仅 0.5–1.5s）。属发布工程项，不触碰环境无关硬约束（无新增运行时依赖）。注意：本地开发 build 仍为 ad-hoc，此欠账只在发布产物层面消解。
- [ ] **W2 dev 工作流改进**：前端改动尽量走 vite 热更新（`pnpm tauri dev` 常驻、改 TS/CSS 不整体重启），把"重启 dev = Rust 增量 ~6s + vite 冷启"的次数压到仅 Rust 改动时。可能的形态：development.md 补一条工作流指引 + 验证 vite HMR 在 tauri webview 内的实际生效面（若 HMR 未接线则补 vite 配置）。

## 未纳入（本次调查明确不做的）

- 应用层小头优化（boot.ts 固定 50ms 静默改条件等待、bootstrap 串行 invoke 链并行化，合计 <500ms 收益）：留在基线 memory 备查，等真实体感反馈再考虑。
- bundle 瘦身/懒加载（codemirror 等）：未测，无数据支撑，不立项。

## 关联

- 根因调查会话（2026-09-13）：systematic-debugging 全程，埋点已撤销，工作区干净；测量方法论五坑记录在 memory `studywiki-startup-perf-baseline`。
- Phase 3 检视：`plans/2026-09-13-pr16-review.md`（fast-follow 表与本文档互不重叠）。
