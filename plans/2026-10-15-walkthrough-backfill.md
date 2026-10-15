# Walkthrough 全量回填实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:dispatching-parallel-agents（B1-B6 批次并行、写集互不相交）+ subagent-driven-development（任务评审循环）。内容任务的"测试"即门禁：verify:walkthrough 锚点全绿 + build 成功 + WARN 缺口随批次单调下降。

**Goal:** 把 65 个源文件的注解页、全部功能页、10 个变更页回填进 walkthrough/，行覆盖率达标，摘除 bootstrap 标志，三条降级门禁转全量红；同 PR 把 #57 置 done。

**Architecture:** 批次化并行生成文件页（六批按子系统切、写集互不相交）→ 功能页与变更页（依赖文件页锚点稳定后）→ 覆盖率校准与 bootstrap 摘除收尾。

**Tech Stack:** 既有机制（Task 2-5 骨架）；内容写作规范见下。

**Spec:** [2026-10-15-walkthrough-design.md](2026-10-15-walkthrough-design.md)（本计划实现其「Bootstrap 计划」第 3-4 步）

## Global Constraints

- 全部内容中文单语、写现状不写变更史；文件页 summary 必须与 code-map.manifest.json 登记处逐字一致（门禁）。
- snippet 取语义完整段（函数/类/状态机转移/错误表等），内容从真实源码逐字复制（含行尾空格——构建期渲染的是源码，快照只用于定位）；每个文件页 segments 目标 5-10 段，优先公共出口、状态机、边界与失败处置。
- 行覆盖率目标 ≥90%（manifest 阈值，维护者定版）；批次完成后跑 verify 看缺口，低于阈值的文件补段优先于登记豁免；豁免必须带理由且只在 manifest.exemptions 登记。
- 功能页 steps.ref.file 必须是已登记源文件；related.notes 相对链接必须可达。
- 提交标题含回填 issue 编号 (#N)（Task 1 回填后注入）；每批次一个提交。
- 并行批次互不触碰同一文件；features.yaml、manifest.json、issue 文件只允许序批任务改。
- 不派生孙代理；遇沙箱提示请求提权；AI 生成质量由维护者扫读把关（changes/文件页 diff）。

## Review Focus（本计划专属）

1. 快照与源码逐字一致（含缩进/尾随空白）——每批次 verify 锚点全绿为证。
2. 讲解行文质量（讲"为什么/干什么"而非复述代码）——维护者扫读；批次评审抽查 2 页/批。
3. segments 过少导致覆盖率不达标——批后覆盖率数据说话。
4. 功能页/变更页引用不存在的文件或 slug——schema/对账门禁兜底。
5. Rust 文件页锚点（.rs 按文本定位，无特殊处理）——B6 批次验证。

---

### Task 1: 流程建档 + #57 收尾

**Files:**
- Create: `.agents/flow/issues/m2-walkthrough-backfill.*`（三件套）
- Modify: `.agents/flow/issues/m2-walkthrough-site.*`（status in-progress → done，围栏两侧逐字一致）
- Modify: `.agents/notes/implemented/process/2026-10-15-walkthrough-site.*`（Consequences 后补一段回填事实：覆盖率校准结论位置、快照粒度经验）

- [ ] **Step 1: 建档**

```bash
pnpm flow:new-issue -- --milestone m2 --priority P0 --slug walkthrough-backfill \
  --title "Walkthrough 全量回填：文件页/功能页/变更页 + bootstrap 摘除" \
  --title-en "Walkthrough full backfill: file/feature/change pages + bootstrap flag removal" \
  --scope "walkthrough/**,.agents/flow/issues/m2-walkthrough-backfill.*,.agents/flow/issues/m2-walkthrough-site.*,.agents/notes/implemented/process/2026-10-15-walkthrough-site.*,plans/2026-10-15-walkthrough-backfill.md"
pnpm flow:sync   # 回填编号 N
```

- [ ] **Step 2: 正文与状态**——backfill issue 直接 in-progress（本 PR 新增 + P0 档合法），背景/目标/验收对齐本计划；#57 置 done（回填即其收尾事实）；note 补 Consequences 段；两对 + note 各 record:i18n 重录；`pnpm verify:flow` 绿。

- [ ] **Step 3: 提交**——`walkthrough 回填：流程建档与 #57 收尾 (#N)`

### Task 2-7: 文件页六批（并行派发，写集互不相交）

每批：为清单内每个源文件建 `walkthrough/files/<镜像路径>.yaml`（kind: file-page；summary 逐字对 code-map；segments 5-10 段；note 讲"干什么/起什么作用/为什么是这里"）。批后验证：`node scripts/verify-walkthrough.mjs` 文件页 WARN 数下降等于本批数量、`node scripts/build-walkthrough.mjs` 成功、`pnpm exec vitest run scripts/walkthrough-lib.spec.mjs` 回归绿。各批提交：`walkthrough 回填：文件页 B<n> <子系统名> (#N)`。

**B1 启动与装载（12）**: src/boot-error.ts、src/bootstrap.ts、src/main.ts、src/preview.ts、src/types.ts、src/loader/{activate,boot,external,guard,manifest,table,types}.ts

**B2 宿主服务（10）**: src/host/{context.d.ts,emitter,excel,files,llm-stream,llm,plugins,slots,windows,workspace}.ts

**B3 agent 线（11）**: src/plugins/agent-core/{approval,index,loop,prompt,service,session,tools,types}.ts、src/plugins/app-agent/{attachments,index,render}.ts

**B4 阅读面（10）**: src/plugins/doc-markdown/{editor,index,mode,preview}.ts、src/plugins/doc-excel/{editing,index,model}.ts、src/plugins/doc-video/index.ts、src/plugins/view-filetree/{index,tree}.ts

**B5 壳与配置 + UI（13）**: src/plugins/app-shell/{index,layout}.ts、src/plugins/app-windows/index.ts、src/plugins/llm-settings/{index,model}.ts、src/plugins/plugin-manager/{index,model}.ts、src/ui/{active-layer,dom,icons,markdown,viewer}.ts、src/styles.css

**B6 Rust 侧（9）**: src-tauri/src/{config,grep,lib,llm,llm_stream,main,native_close,plugins,windows}.rs

### Task 8: 功能页（序批）

**Files:** Create `walkthrough/features/*.yaml`（13 页）+ Modify `walkthrough/features.yaml`（登记）

功能清单（slug —— 关联 issue）：file-tree（文件树浏览 —— m1-01）、markdown-read（markdown 阅读与编辑 —— m1-02）、excel-view（excel 查看 —— m1-01）、excel-edit（excel 编辑 —— m1-03）、video-play（视频播放 —— m1-02）、multi-window（多窗口与关窗守卫 —— m1-native-close-guard）、plugin-manage（外置插件管理 —— m2-02）、plugin-load（外置插件装载 blob 缝 —— m2-02）、llm-settings（LLM endpoint 配置 —— m2-01）、agent-chat（agent 对话与回合 —— m2-03）、approval-gate（审批门 —— m2-03）、grep-search（agent grep 工具 —— m2-03）、attachments（附件三源 —— m2-03）

每页：behavior（用户视角）→ modules（真实已登记源文件）→ steps（3-6 个跨文件锚点片段 + 旁注）→ related.notes（可达相对链接）。验证：锚点全绿、功能登记对账绿、build 成功、功能页⇆文件页反链在产物中可见。提交：`walkthrough 回填：功能页 13 页 (#N)`

### Task 9: 变更页（序批，10 页）

**Files:** Create `walkthrough/changes/{m0-01-dev-flow-gates,m1-01-excel-viewer,m1-02-reading-polish,m1-03-excel-editing,m1-native-close-guard,m2-01-ai-inference-supply,m2-02-agent-host,m2-03-basic-agent,m2-walkthrough-site,m2-walkthrough-backfill}.yaml`

历史 9 页：从 git log + issue 正文 + 关联 note 重建三层叙事（functional/architectural/code），touches 链相关功能页/文件页。m2-walkthrough-backfill 页写本 PR 自身。验证：变更对账绿（active issue 全覆盖）、touches 指向存在页面。提交：`walkthrough 回填：变更页 10 页 (#N)`

### Task 10: 覆盖率校准 + bootstrap 摘除 + 收尾

- [ ] **Step 1**: `node scripts/verify-walkthrough.mjs`——文件页/变更页 WARN 清零；行覆盖率逐文件数据导出（verify 输出或临时脚本），低于 0.9 的文件补段；确实不适合注解的（如纯 CSS/类型声明长文件——评估 styles.css/context.d.ts）在 manifest.exemptions 登记理由。
- [ ] **Step 2**: 移除 manifest.json 的 `bootstrap` 字段 → 三条门禁转全量红，`pnpm verify:walkthrough` 必须全绿（任何残留缺口补完为止）。
- [ ] **Step 3**: 校准结论写入 Agent Note（Consequences 回填段）：阈值实际分布、豁免名单与理由、快照粒度经验；`record:i18n` 重录。
- [ ] **Step 4**: 全链终验：`npm_config_cache=/tmp/sw-npm-cache pnpm test`、`pnpm build`、`pnpm verify:docs`、`pnpm verify:flow`、`pnpm verify:walkthrough`、`pnpm walkthrough` 全绿。
- [ ] **Step 5**: 提交 `walkthrough 回填：覆盖率达标与 bootstrap 摘除 (#N)`。

### Task 11: 收尾（合入后）

push → PR（标题含 (#N)，描述三层叙事）→ CI 全绿 → 合入 → backfill issue 置 done 小 PR。维护者人工走查 dist 全站。

## 交接

骨架计划（2026-10-15-walkthrough-impl.md）已完成并合入（PR #58）；本计划是回填。SDD 账本目录另起 `.superpowers/sdd/2026-10-15-walkthrough-backfill/`。
