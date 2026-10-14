# Walkthrough 工程讲解站实施计划（机制骨架）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 walkthrough 机制骨架——YAML 子集解析器、九条门禁、静态 HTML 生成器、CI/命令接线与空壳内容，门禁全绿。

**Architecture:** 手写 yaml 子集解析器（零新增依赖）→ walkthrough-lib 纯函数库（schema/锚点/对账/覆盖率/diff，verify 与 build 共用）→ verify-walkthrough 门禁叶子 + build-walkthrough 生成器（markdown-it 渲染正文，快照只定位、展示构建期真实代码）。产物为多页静态站点，file:// 直开。

**Tech Stack:** Node 22 ESM、vitest、仓内既有 markdown-it、run-gates 叶子机制。

**Spec:** [plans/2026-10-15-walkthrough-design.md](2026-10-15-walkthrough-design.md)

**范围说明：** 本计划只覆盖机制骨架（spec「Bootstrap 计划」第 1-2 步）。全量内容回填（第 3-4 步）在骨架合入后另行出计划。骨架期 `walkthrough/manifest.json` 置 `bootstrap: true`：文件页对账、变更对账、行覆盖率三条门禁降级为警告（与 flow 的 bootstrap 豁免同构），回填收尾时移除标志转红——这是对 spec 的一处增量细化，已同步进 Task 6。

## Global Constraints

- 零新增依赖：解析器手写，markdown-it 用仓内既有；scripts 为 ESM `.mjs`，命名 `scripts/<name>.mjs` + 同名 `.spec.mjs`（vitest）。
- 新门禁接入 `scripts/run-gates.mjs` 的 LEAVES 与 doc-sync 模式；gate-coverage / ci-wiring 对账 spec 同步更新。
- `walkthrough/**` 中文单语：不进配对语料、不进词数预算；在 docs/AGENTS.md 层级表登记该层级，translation-pairing 语料不变（walkthrough 不在其范围，无需豁免登记）。
- markdown 段落一行到底；无尾随空白（pre-commit 钩子）。
- 提交信息中文，标题含 Task 1 回填的 issue 编号 `(#N)`。
- 产物 `walkthrough/dist/` 进 .gitignore。

## Review Focus

1. snippet 在目标文件多处匹配：行为定义为取首次出现 + 构建警告（不红）——Task 3 spec 钉住。
2. snippet 与源码仅行尾空白/缩进尾差：逐行 trimEnd 归一化后匹配——Task 3 spec 钉住。
3. yaml 块标量内含 `#` 开头行与空行：不得被当注释截断——Task 2 spec 钉住。
4. backlog/ready 状态的 issue 没有 changes 页不红，in-progress/done 缺页才红（bootstrap 关闭后）——Task 4 spec 钉住。
5. 源文件重命名/删除后遗留孤儿文件页：对账必须红——Task 4 spec 钉住。

---

### Task 1: flow issue 建档 + Agent Note（proposed）

**Files:**
- Create: `.agents/flow/issues/m2-walkthrough-site.md`（三件套，flow:new-issue 生成）
- Create: `.agents/notes/proposed/process/2026-10-15-walkthrough-site.md`（三件套手写）
- Run: `pnpm flow:sync`（回填 GitHub 编号）

**Interfaces:**
- Consumes: 无
- Produces: issue 编号 `N`（后续任务提交标题引用）；slug `m2-walkthrough-site`（changes 对账的合法 issue 之一）

- [ ] **Step 1: 生成 issue 三件套**

```bash
pnpm flow:new-issue -- --milestone m2 --priority P1 --slug walkthrough-site \
  --title "Walkthrough 工程讲解站：机制骨架" \
  --title-en "Walkthrough engineering site: mechanism skeleton" \
  --scope "walkthrough/**,scripts/walkthrough-lib.mjs,scripts/walkthrough-yaml.mjs,scripts/verify-walkthrough.mjs,scripts/build-walkthrough.mjs,scripts/*walkthrough*.spec.mjs,scripts/run-gates.mjs,scripts/route-gates.mjs,package.json,docs/AGENTS.md,AGENTS.md,.gitignore,.github/workflows/ci.yml,plans/2026-10-15-walkthrough-*,.agents/notes/**/2026-10-15-walkthrough-site.*"
```

- [ ] **Step 2: 回填编号并置 in-progress**

```bash
pnpm flow:sync        # 回填 github.number/url
# 编辑 issue 三件套 status: backlog → in-progress（围栏两侧逐字节一致），正文补背景/目标/验收
pnpm record:i18n -- .agents/flow/issues/m2-walkthrough-site.md
pnpm verify:flow      # 期望：绿（m1 P1 已全 done，m2 P1 可并行）
```

- [ ] **Step 3: 写 Agent Note（proposed，process 类，三件套）**

正文四段：Problem（AI 产出速度 >> 维护者读码速度，缺面向人的工程认知界面）→ Decision（五层站点 + YAML 源 + 内容快照锚点 + 九条门禁 + 双轴互链，引 spec 与调研四个借鉴点）→ Alternatives considered（DeepWiki 全自动、Swimm SaaS、CodeTour 扩展、单 HTML、符号锚点，各一句否决理由）→ Consequences（bootstrap 回填成本、60% 阈值待校准、讲解语义质量归人扫读）。写完 `pnpm record:i18n -- <base>` 重录。

- [ ] **Step 4: 验证 + 提交**

```bash
pnpm lint:docs
git add .agents/flow/issues/m2-walkthrough-site.* .agents/notes/proposed/process/2026-10-15-walkthrough-site.*
git commit -m "walkthrough 讲解站：流程建档与决策记录 (#N)"
```

### Task 2: yaml 子集解析器

**Files:**
- Create: `scripts/walkthrough-yaml.mjs`
- Test: `scripts/walkthrough-yaml.spec.mjs`

**Interfaces:**
- Produces: `parseWalkthroughYaml(text: string, path: string): unknown`——支持：顶层 map；标量（null/true/false/非负整数/字符串）；行内列表 `[a, b]`；块标量 `|`；`- 项` 列表（标量或 map，map 续行缩进两格）；一层嵌套 map；整行 `#` 注释。不支持语法抛 `Error(path:行号: 原因)`。

- [ ] **Step 1: 写失败测试**

```js
import { describe, expect, it } from "vitest";
import { parseWalkthroughYaml } from "./walkthrough-yaml.mjs";

describe("walkthrough-yaml", () => {
  it("标量与行内列表", () => {
    expect(parseWalkthroughYaml("a: 1\nb: true\nc: null\nd: [x, y]\n", "t")).toEqual({ a: 1, b: true, c: null, d: ["x", "y"] });
  });
  it("块标量保留 # 行与空行", () => {
    const v = parseWalkthroughYaml("note: |\n  # 不是注释\n\n  第二段\n", "t");
    expect(v.note).toBe("# 不是注释\n\n第二段\n");
  });
  it("列表项 map 与嵌套 map", () => {
    const v = parseWalkthroughYaml("segments:\n  - snippet: |\n      code();\n    note: 讲解\n  - snippet: |\n      b();\n    note: 二\nmeta:\n  x: 1\n", "t");
    expect(v.segments).toHaveLength(2);
    expect(v.segments[0]).toEqual({ snippet: "code();\n", note: "讲解" });
    expect(v.meta).toEqual({ x: 1 });
  });
  it("非法语法抛带行号错误", () => {
    expect(() => parseWalkthroughYaml("a:\n    b: 过深缩进\n", "t.yaml")).toThrow(/t\.yaml:2/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run scripts/walkthrough-yaml.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现解析器**

逐行扫描：跟踪块标量状态（块内行原样收集、去公共缩进、不处理注释）；非块内整行 `#` 跳过；按缩进层级构建 map/list。约 120 行，单文件。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run scripts/walkthrough-yaml.spec.mjs`
Expected: PASS 4/4

- [ ] **Step 5: 提交**

```bash
git add scripts/walkthrough-yaml.mjs scripts/walkthrough-yaml.spec.mjs
git commit -m "walkthrough：yaml 子集解析器 (#N)"
```

### Task 3: walkthrough-lib 纯函数库

**Files:**
- Create: `scripts/walkthrough-lib.mjs`
- Test: `scripts/walkthrough-lib.spec.mjs`

**Interfaces:**
- Consumes: `parseWalkthroughYaml`（Task 2）
- Produces（后续 Task 4/5 依赖这些确切签名）:
  - `parseSite(root: string): Site`——读 walkthrough/ 全部 yaml，`Site = { overview, architecture, featureIndex, features: Map<slug,obj>, filePages: Map<source,obj>, changes: Map<issue,obj>, manifest, parseErrors: string[] }`
  - `locateSnippet(sourceText: string, snippet: string): { start: number, end: number, count: number } | null`——逐行 trimEnd 后子串匹配，1-based 行号，count 为匹配次数
  - `validateSchema(site: Site): string[]`
  - `checkAnchors(root: string, site: Site): string[]`
  - `checkFilePages(site: Site, codeMap: object): string[]`——一一对应 + summary 逐字（vendor 豁免）
  - `checkFeatures(site: Site): string[]`——features.yaml ⇆ features/ 目录
  - `checkChanges(site: Site, issues: {slug, status}[]): string[]`——in-progress/done 必须有页；页指向存在 issue
  - `checkLineCoverage(root: string, site: Site): string[]`——阈值/豁免读 site.manifest
  - `checkDiff(root: string, base: string, site: Site): string[]`——改码必改页 + touches 全量（git diff --name-only base...HEAD）

- [ ] **Step 1: 写失败测试**（tmpdir 夹具，模式照 flow-new-issue.spec.mjs）

```js
it("validateSchema 拒绝未知 kind 与缺必填字段", () => { /* 夹具：kind 拼写错误、file-page 缺 segments */ });
it("locateSnippet 归一化行尾空白，多处匹配计 count", () => {
  const src = "fn a() {\n  go();  \n}\nfn b() {\n  go();\n}\n";
  expect(locateSnippet(src, "go();")).toEqual({ start: 2, end: 2, count: 2 });
  expect(locateSnippet(src, "不存在")).toBeNull();
});
it("checkFilePages 缺页与孤儿页都红，vendor 豁免", () => { /* 夹具：codeMap 两文件，一页缺失、一页孤儿 */ });
it("checkChanges：backlog 无页不红，in-progress 无页红", () => { /* 夹具两个 issue */ });
it("checkLineCoverage 低于阈值红、豁免放行", () => { /* 夹具 manifest threshold */ });
it("checkDiff 改码未改页红 + touches 缺文件红", () => { /* mock diff 文件列表 */ });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run scripts/walkthrough-lib.spec.mjs`
Expected: FAIL

- [ ] **Step 3: 实现**

约 250 行。checkDiff 内部用 `execFileSync("git", ["diff", "--name-only", base + "...HEAD"])`；checkChanges 的 issue 状态由调用方（verify 叶子）经 `flow-lib.mjs` 的 loadFlowTree 读入后传入，lib 保持纯函数；codeMap 读 `scripts/code-map.manifest.json`。

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/walkthrough-lib.mjs scripts/walkthrough-lib.spec.mjs
git commit -m "walkthrough：schema/锚点/对账/覆盖率纯函数库 (#N)"
```

### Task 4: verify-walkthrough 门禁

**Files:**
- Create: `scripts/verify-walkthrough.mjs`
- Test: `scripts/verify-walkthrough.spec.mjs`

**Interfaces:**
- Consumes: Task 3 全部 check 函数
- Produces: `export default async function verifyWalkthrough(): { ok: boolean, errors: string[] }`（run-gates 叶子签名）；CLI `node scripts/verify-walkthrough.mjs [--diff <base>]`

- [ ] **Step 1: 写失败测试**——夹具站点：bootstrap:true 时文件页/变更/覆盖率三档只警告不红；bootstrap:false 时转红；锚点失败始终红；--diff 两规则经 mock git 输出验证。

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL

- [ ] **Step 3: 实现**——七条静态规则按序执行收集 errors；manifest.bootstrap 时规则 3/5/6 输出 `WARN:` 前缀不进 errors；`--diff` 追加规则 8/9；约 80 行薄壳。

- [ ] **Step 4: 跑测试确认通过** → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/verify-walkthrough.mjs scripts/verify-walkthrough.spec.mjs
git commit -m "walkthrough：九条门禁与 bootstrap 降级 (#N)"
```

### Task 5: build-walkthrough 生成器

**Files:**
- Create: `scripts/build-walkthrough.mjs`
- Test: `scripts/build-walkthrough.spec.mjs`

**Interfaces:**
- Consumes: `parseSite`、`locateSnippet`（Task 3）、仓内 `markdown-it`
- Produces: `buildSite(root: string, outDir: string): void`——产 `index.html`（总览）、`architecture.html`、`features/<slug>.html`、`files/<路径>.html`、`changes/<issue>.html`；CLI `node scripts/build-walkthrough.mjs` 默认输出 `walkthrough/dist/`

- [ ] **Step 1: 写失败测试**——tmpdir 夹具站点构建：产物文件存在；功能页含从夹具源码拉取的真实代码文本（非 YAML 快照原文）；文件页头部含"被引用"反链；锚点失败时构建抛错（构建即校验）。

- [ ] **Step 2: 跑测试确认失败** → Expected: FAIL

- [ ] **Step 3: 实现**——手写 HTML 模板（左侧导航 + 面包屑 + 内联 CSS，零外链）；markdown-it（html:false）渲染叙述字段；architecture 页 `generated: code-map` 段嵌入 `scripts/gen-code-map.mjs` 同款树；代码块转义后 `<pre><code>` + 行号 + 来源链接；约 300 行。

- [ ] **Step 4: 跑测试确认通过** → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/build-walkthrough.mjs scripts/build-walkthrough.spec.mjs
git commit -m "walkthrough：静态 HTML 生成器 (#N)"
```

### Task 6: walkthrough/ 骨架内容

**Files:**
- Create: `walkthrough/README.md`、`walkthrough/overview.yaml`、`walkthrough/architecture.yaml`、`walkthrough/features.yaml`（空清单 `{features: []}`）、`walkthrough/manifest.json`（`{"bootstrap": true, "lineCoverage": {"threshold": 0.6, "exemptions": {}}}`）、`walkthrough/features/.gitkeep`、`walkthrough/files/.gitkeep`、`walkthrough/changes/.gitkeep`
- Modify: `.gitignore`（加 `walkthrough/dist/`）

**Interfaces:**
- Consumes: Task 4/5 的门禁与生成器（骨架内容必须全绿）
- Produces: 可供 Task 7 接线的稳定目录契约

- [ ] **Step 1: 写 README 契约**——目录布局、yaml 子集规则、四种 kind schema 表、锚点机制、九条门禁、bootstrap 降级语义、"语义归人扫读"分工。段落一行到底。

- [ ] **Step 2: 写 overview.yaml / architecture.yaml 初稿**——overview：产品定位 + 站点阅读指引；architecture：分层叙事 + `generated: code-map` 段 + 关键决策链 Agent Notes。

- [ ] **Step 3: 构建 + 门禁验证**

```bash
node scripts/build-walkthrough.mjs && node scripts/verify-walkthrough.mjs
```

Expected: 构建成功；verify 绿（bootstrap 降级档仅 WARN）。

- [ ] **Step 4: 提交**

```bash
git add walkthrough/ .gitignore
git commit -m "walkthrough：目录契约与骨架内容 (#N)"
```

### Task 7: 接线（命令/门禁/CI/文档登记）

**Files:**
- Modify: `package.json`（加 `walkthrough`、`verify:walkthrough` 两条 script）
- Modify: `scripts/run-gates.mjs`（LEAVES 加 verify-walkthrough，挂 doc-sync 模式）
- Modify: `scripts/route-gates.mjs`（加 `walkthrough/**` 路由）
- Modify: `.github/workflows/ci.yml`（静态 lane 加 PR 档 `node scripts/verify-walkthrough.mjs --diff origin/${{ github.base_ref }}`，`if: github.event_name == 'pull_request'`）
- Modify: `AGENTS.md`（命令清单加两行）、`docs/AGENTS.md`（层级表加 walkthrough 行：中文单语、产物 gitignored）
- Test: `scripts/gate-coverage.spec.mjs`、`scripts/ci-wiring.spec.mjs`（按对账失败信息更新期望值）

- [ ] **Step 1: 改 package.json + run-gates + route-gates**，跑 `pnpm exec vitest run scripts/gate-coverage.spec.mjs scripts/route-gates.spec.mjs` 看对账失败，按失败信息补 spec 期望。

- [ ] **Step 2: 改 ci.yml + AGENTS.md + docs/AGENTS.md**（docs/AGENTS.md 在配对语料内：最小修补英文侧 + `pnpm record:i18n -- docs/AGENTS.md`）。

- [ ] **Step 3: 重建命令目录 + 全量文档门禁**

```bash
pnpm gen:commands && pnpm verify:docs && pnpm verify:flow
```

Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add package.json scripts/run-gates.mjs scripts/route-gates.mjs .github/workflows/ci.yml AGENTS.md docs/AGENTS.md docs/AGENTS.en.md docs/AGENTS.i18n.yaml docs/commands.md scripts/gate-coverage.spec.mjs scripts/ci-wiring.spec.mjs scripts/route-gates.spec.mjs
git commit -m "walkthrough：命令/门禁/CI 接线与文档登记 (#N)"
```

### Task 8: 收尾验证 + Note 转 implemented

- [ ] **Step 1: 全量门禁**

```bash
pnpm test && pnpm build && pnpm verify:docs && pnpm verify:flow
```

Expected: 全绿。

- [ ] **Step 2: 人工走查**——`pnpm walkthrough` 打开产物，走"总览 → 架构 → 导航"回路，确认 file:// 下互链可用。

- [ ] **Step 3: Agent Note 移 implemented**——`git mv` 三件套到 `.agents/notes/implemented/process/`，Status 改 implemented，`pnpm record:i18n` 重录，`pnpm lint:docs` 绿。

- [ ] **Step 4: 提交**

```bash
git commit -m "walkthrough：机制骨架收尾，决策记录转 implemented (#N)"
```

---

## 交接

骨架合入后另出「全量内容回填」计划：按主干链路 → 边缘功能顺序生成全部文件页/功能页，行覆盖率达标，为每个 in-progress/done issue 补 changes 页，最后移除 `bootstrap: true` 转全量红门禁。
