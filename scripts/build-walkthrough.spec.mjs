// build-walkthrough 规格测试：用 tmpdir 夹具站点锁定产物结构、真实源码锚点、
// 文件页反链、构建期失败语义与 CLI 干净 stdout。

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildSite } from "./build-walkthrough.mjs";

const dirs = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(root, relativePath, text) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** 生成新 schema 的 change 页 YAML 文本。 */
function changeYaml(issue, title, sourcePath) {
  return `kind: change
issue: ${issue}
title: ${title}
scale:
  files: 2
  additions: 30
  deletions: 4
feature: |
  功能行为变化。
userFlow:
  - 打开演示页面
  - 确认演示行为
architectural: |
  架构不变。
codeMap:
  - group: 实现
    attention: must-read
    why: 核心变化
    files:
      - path: ${sourcePath}
        note: 新增常量
  - group: 附带
    attention: skim
    why: null
    files:
      - path: pnpm-lock.yaml
        note: 锁文件
reviewGuide:
  order:
    - 先读变更地图
  risks:
    - 风险一
  acceptance:
    - item: 演示可用
      evidence: pnpm exec vitest 通过
verification:
  - pnpm exec vitest run scripts/build-walkthrough.spec.mjs
touches: [file:${sourcePath}, feature:demo]
`;
}

function writeValidSite(root, sourcePath = "src/demo.ts") {
  write(
    root,
    "walkthrough/overview.yaml",
    `kind: overview
sections:
  - heading: 总览
    body: |
      这是什么工程。
    images: [assets/space #image.svg]
`,
  );
  write(
    root,
    "walkthrough/architecture.yaml",
    `kind: architecture
sections:
  - heading: 分层
    body: |
      三层结构。
    generated: code-map
`,
  );
  write(
    root,
    "walkthrough/features.yaml",
    `features:
  - slug: demo
    title: Demo
    summary: 演示功能
    issue: demo-change
`,
  );
  write(
    root,
    "walkthrough/features/demo.yaml",
    `kind: feature
slug: demo
title: Demo
behavior: |
  用户能看到演示。
modules: [${sourcePath}]
steps:
  - ref:
      file: ${sourcePath}
      snippet: |
        const covered = 1;
    note: |
      入口常量。
related:
  notes: []
`,
  );
  const fileYaml = `walkthrough/files/${sourcePath}.yaml`;
  write(
    root,
    fileYaml,
    `kind: file-page
source: ${sourcePath}
summary: 演示源文件
segments:
  - snippet: |
      const covered = 1;
      const coveredToo = 2;
    note: |
      前两行是被讲解的起点。
  - snippet: |
      const afterAnchor = 3;
    note: |
      第二段注解。
`,
  );
  write(
    root,
    "walkthrough/changes/demo-change.yaml",
    changeYaml("demo-change", "Demo change", sourcePath),
  );
  write(
    root,
    "walkthrough/manifest.json",
    `${JSON.stringify({ bootstrap: true, lineCoverage: { threshold: 0.5, exemptions: {} } }, null, 2)}\n`,
  );
  write(
    root,
    "scripts/code-map.manifest.json",
    `${JSON.stringify({ src: "前端夹具", [sourcePath]: "演示源文件" }, null, 2)}\n`,
  );
  write(root, "walkthrough/assets/space #image.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n");
  write(
    root,
    sourcePath,
    "const covered = 1;   \nconst coveredToo = 2;\nconst afterAnchor = 3;\n",
  );
}

describe("build-walkthrough", () => {
  it("生成五层多页静态站并渲染锚定区间的真实源码", () => {
    const root = tempRoot("studywiki-build-walkthrough-");
    const outDir = path.join(root, "site-output");
    writeValidSite(root);

    buildSite(root, outDir);

    const home = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(home).toContain("这是什么工程");
    expect(home).toContain('<img src="assets/space%20%23image.svg"');
    expect(readFileSync(path.join(outDir, "architecture.html"), "utf8")).toContain("src/demo.ts");
    expect(readFileSync(path.join(outDir, "features/demo.html"), "utf8")).toContain("const covered = 1;");
    expect(readFileSync(path.join(outDir, `files/${"src/demo.ts"}.html`), "utf8")).toContain("const coveredToo = 2;");

    // 导航文件区：按源码目录嵌套的可折叠树（details/summary，零脚本）
    const nestedSource = "src/host/nested.ts";
    write(root, nestedSource, "export const nested = true;\n");
    write(
      root,
      `walkthrough/files/${nestedSource}.yaml`,
      `kind: file-page\nsource: ${nestedSource}\nsummary: 嵌套演示\nsegments:\n  - snippet: |\n      export const nested = true;\n    note: |\n      嵌套演示。\n`,
    );
    buildSite(root, outDir);
    const nav = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(nav).toContain("<details class=\"nav-dir\"><summary>host/ (1)</summary>");
    expect(nav).toContain('href="files/src/host/nested.ts.html"');
    expect(nav).toContain("<summary>src/ (2)</summary>");

    // 变更史：按 PR 编号降序 + 搜索框
    for (const [slug, title] of [["demo-b", "#52 Alpha"], ["demo-c", "#7 Beta"]]) {
      write(
        root,
        `walkthrough/changes/${slug}.yaml`,
        changeYaml(slug, title, "src/demo.ts"),
      );
    }
    buildSite(root, outDir);
    const homeSorted = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(homeSorted.indexOf("#52 Alpha")).toBeGreaterThan(-1);
    expect(homeSorted.indexOf("#52 Alpha")).toBeLessThan(homeSorted.indexOf("#7 Beta"));
    expect(homeSorted.indexOf("#7 Beta")).toBeLessThan(homeSorted.indexOf(">Demo change<"));
    expect(homeSorted).toContain('type="search"');
    const changePage = readFileSync(path.join(outDir, "changes/demo-change.html"), "utf8");
    expect(changePage).toContain("功能行为变化");

    // 变更页 v2 头部：Issue 标识 + 规模统计徽章
    expect(changePage).toContain("Issue demo-change");
    expect(changePage).toContain(">2 个文件</span>");
    expect(changePage).toContain(">+30</span>");
    expect(changePage).toContain(">−4</span>");

    // 用户操作路径为有序列表
    expect(changePage).toMatch(/<ol class="user-flow">[\s\S]*?打开演示页面[\s\S]*?确认演示行为[\s\S]*?<\/ol>/u);

    // 变更地图：must-read 组展开置顶，skim 组默认折叠并灰显"可扫读"
    expect(changePage).toContain('<section class="map-group must-read">');
    expect(changePage).toContain('<details class="map-group skim">');
    expect(changePage).toContain("核心变化");
    expect(changePage).toContain(">必读</span>");
    expect(changePage).toContain(">可扫读</span>");
    expect(changePage.indexOf('<section class="map-group must-read">'))
      .toBeLessThan(changePage.indexOf('<details class="map-group skim">'));
    // 组内文件表：存在文件页则链入，机械路径退化为 code；不列行数
    expect(changePage).toMatch(/<table class="map-files">[\s\S]*?href="\.\.\/files\/src\/demo\.ts\.html"[\s\S]*?新增常量[\s\S]*?<\/table>/u);
    expect(changePage).toContain("<code>pnpm-lock.yaml</code>");

    // 检视指引：阅读顺序、风险点、验收对照表
    expect(changePage).toContain("建议阅读顺序");
    expect(changePage).toContain("风险一");
    expect(changePage).toMatch(/<table class="acceptance">[\s\S]*?演示可用[\s\S]*?pnpm exec vitest 通过[\s\S]*?<\/table>/u);

    // 验证清单
    expect(changePage).toContain("pnpm exec vitest run scripts/build-walkthrough.spec.mjs");

    // 变更页除公共骨架外不引入脚本
    expect(changePage).not.toMatch(/<script\b/iu);

    const feature = readFileSync(path.join(outDir, "features/demo.html"), "utf8");
    expect(feature).toContain("../files/src/demo.ts.html#L1");
    // locate 会 trimEnd 归一化锚点，但渲染必须保留源文件侧原始尾随空白；
    // 这个 byte 级断言让“直接输出 YAML 快照”的朴素实现失败。
    expect(feature).toContain("const covered = 1;   </span>");
    expect(feature).toContain("src/demo.ts:1");
    expect(feature).not.toContain("const afterAnchor = 3;");
    expect(feature).not.toMatch(/<script\b/iu);
    expect(feature.match(/<style>/gu)).toHaveLength(1);

    const filePage = readFileSync(path.join(outDir, "files/src/demo.ts.html"), "utf8");
    expect(filePage).toContain("被引用");
    expect(filePage).toContain("../../features/demo.html");
    expect(filePage).toContain('id="L1"');
    expect(filePage).toContain('id="L3"');
  });

  it("生成链接逐段 URL 编码且空格与 # 不破坏属性或页面回路", () => {
    const root = tempRoot("studywiki-build-url-encoding-");
    const outDir = path.join(root, "site-output");
    const sourcePath = "src/space #path.ts";
    writeValidSite(root, sourcePath);

    buildSite(root, outDir);

    const feature = readFileSync(path.join(outDir, "features/demo.html"), "utf8");
    expect(feature).toContain('../files/src/space%20%23path.ts.html#L1"');
    expect(feature).toContain("src/space #path.ts:1");

    const filePage = readFileSync(path.join(outDir, `files/${sourcePath}.html`), "utf8");
    expect(filePage).toContain('href="../../features/demo.html"');
    expect(filePage).toContain('<div class="backlinks">');
    expect(filePage).not.toContain('<p class="backlinks">');
    expect(filePage).not.toContain('href="../files/src/space #path.ts.html"');
  });

  it("change 页 touches 中的特殊路径链接也被逐段编码", () => {
    const root = tempRoot("studywiki-build-touch-encoding-");
    const outDir = path.join(root, "site-output");
    const sourcePath = "src/space #path.ts";
    writeValidSite(root, sourcePath);

    buildSite(root, outDir);

    const change = readFileSync(path.join(outDir, "changes/demo-change.html"), "utf8");
    expect(change).toContain('href="../files/src/space%20%23path.ts.html"');
    expect(change).not.toContain('href="../files/src/space #path.ts.html"');
  });

  it("变更页头部 Issue 在 flow 登记 github.url 时渲染为链接，缺失时退化为文本", () => {
    const root = tempRoot("studywiki-build-issue-link-");
    const outDir = path.join(root, "site-output");
    writeValidSite(root);
    write(
      root,
      ".agents/flow/issues/demo-change.md",
      `# Demo change

\`\`\`yaml flow
kind: issue
milestone: m2
priority: P1
status: in-progress
scope: []
adr: []
github:
  number: 99
  url: https://github.com/example/studywiki/issues/99
\`\`\`
`,
    );

    buildSite(root, outDir);
    const linked = readFileSync(path.join(outDir, "changes/demo-change.html"), "utf8");
    expect(linked).toContain(
      '<a class="issue-link" href="https://github.com/example/studywiki/issues/99">Issue demo-change</a>',
    );

    const plainRoot = tempRoot("studywiki-build-issue-plain-");
    const plainOut = path.join(plainRoot, "site-output");
    writeValidSite(plainRoot);
    buildSite(plainRoot, plainOut);
    const plain = readFileSync(path.join(plainOut, "changes/demo-change.html"), "utf8");
    expect(plain).toContain("Issue demo-change");
    expect(plain).not.toContain('class="issue-link" href=');
  });

  it("文件页同时列出 steps 与 modules 引用且不去重失败", () => {
    const root = tempRoot("studywiki-build-backlink-");
    const outDir = path.join(root, "site-output");
    writeValidSite(root);
    write(
      root,
      "walkthrough/features/demo.yaml",
      `kind: feature
slug: demo
title: Demo
behavior: |
  用户能看到演示。
modules: [src/demo.ts]
steps:
  - ref:
      file: src/demo.ts
      snippet: |
        const covered = 1;
    note: |
      入口常量。
related:
  notes: []
`,
    );

    buildSite(root, outDir);

    const filePage = readFileSync(path.join(outDir, "files/src/demo.ts.html"), "utf8");
    const backlinks = filePage.match(/<div class="backlinks">[\s\S]*?<\/ul><\/div>/u)?.[0] ?? "";
    expect(backlinks.match(/features\/demo\.html/gu)).toHaveLength(1);
  });

  it("多处锚点命中时输出 WARN、取首次并继续生成", () => {
    const root = tempRoot("studywiki-build-anchor-warn-");
    const outDir = path.join(root, "site-output");
    writeValidSite(root);
    write(
      root,
      "src/demo.ts",
      "const covered = 1;\nconst coveredToo = 2;\nconst covered = 1;\nconst coveredToo = 2;\nconst afterAnchor = 3;\n",
    );
    const logs = [];
    const originalLog = console.log;
    console.log = (...parts) => logs.push(parts.join(" "));

    try {
      buildSite(root, outDir);
    } finally {
      console.log = originalLog;
    }

    const warning = "WARN: snippet 在 src/demo.ts 命中 2 处，取首次（第 1 行）";
    expect(logs).toEqual([warning, warning]);
    expect(readFileSync(path.join(outDir, "features/demo.html"), "utf8")).toContain('id="step-1-L1"');
    expect(readFileSync(path.join(outDir, "files/src/demo.ts.html"), "utf8")).toContain('id="L1"');
  });

  it("不传 outDir 时默认产物落在调用 root 内", () => {
    const root = tempRoot("studywiki-build-default-root-");
    writeValidSite(root);

    buildSite(root);

    expect(readFileSync(path.join(root, "walkthrough/dist/index.html"), "utf8")).toContain(
      "这是什么工程",
    );
  });

  it("锚点定位失败时构建抛错", () => {
    const root = tempRoot("studywiki-build-anchor-fail-");
    const outDir = path.join(root, "site-output");
    writeValidSite(root);
    write(root, "src/demo.ts", "const unrelated = true;\n");

    expect(() => buildSite(root, outDir)).toThrowError(/锚点定位失败/);
  });

  it("site.parseErrors 非空时构建抛错", () => {
    const root = tempRoot("studywiki-build-parse-fail-");
    const outDir = path.join(root, "site-output");
    writeValidSite(root);
    write(root, "walkthrough/overview.yaml", "kind: [broken\n");

    expect(() => buildSite(root, outDir)).toThrowError(/walkthrough\/overview\.yaml/);
  });

  it("CLI 默认输出 walkthrough/dist 且成功 stdout 为空", () => {
    const root = tempRoot("studywiki-build-cli-");
    writeValidSite(root);
    const result = spawnSync(process.execPath, [path.resolve("scripts/build-walkthrough.mjs")], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(readFileSync(path.join(root, "walkthrough/dist/index.html"), "utf8")).toContain("这是什么工程");
  });
});

describe("review 模式", () => {
  it("--review 产出本 PR 检视页：叙事区 + must-read 组真实 diff + 注解归位", () => {
    const root = mkdtempSync(path.join(tmpdir(), "walkthrough-review-build-"));
    dirs.push(root);
    const git = (argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" });
    git(["init", "-q", "-b", "main"]);
    write(root, "src/demo.ts", "export const covered = 1;\nexport const keep = 2;\n");
    write(root, "scripts/code-map.manifest.json", "{\"src/demo.ts\": \"演示源文件\"}");
    write(root, "walkthrough/manifest.json", "{\"lineCoverage\": {\"threshold\": 0.9, \"exemptions\": {}}}");
    write(root, "walkthrough/overview.yaml", "kind: overview\nsections:\n  - heading: 演示\n    body: |\n      演示。\n");
    write(root, "walkthrough/architecture.yaml", "kind: architecture\nsections:\n  - heading: 演示\n    body: |\n      演示。\n");
    write(root, "walkthrough/features.yaml", "features: []\n");
    git(["add", "."]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"]);
    write(
      root,
      "walkthrough/changes/demo-pr.yaml",
      `kind: change
issue: demo-pr
title: #7 演示 PR
scale:
  files: 2
  additions: 10
  deletions: 1
feature: |
  演示功能。
userFlow:
  - 打开演示
architectural: |
  无。
codeMap:
  - group: 核心变更
    attention: must-read
    why: 语义核心。
    files:
      - path: src/demo.ts
        note: 演示文件。
        changes:
          - snippet: |
              export const changed = 2;
            note: |
              这是本次修改的那行。
reviewGuide:
  order:
    - 先看 demo.ts
  risks:
    - 演示风险
  acceptance:
    - item: 演示验收
      evidence: pnpm test
verification:
  - pnpm test
touches: []
`,
    );
    write(root, "src/demo.ts", "export const covered = 1;\nexport const changed = 2;\nexport const keep = 2;\n");
    git(["add", "."]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "work"]);
    const outDir = path.join(root, "walkthrough/dist");
    buildSite(root, outDir, { review: { base: "HEAD~1" } });
    const review = readFileSync(path.join(outDir, "review.html"), "utf8");
    expect(review).toContain("本 PR 检视");
    expect(review).toContain("演示功能");
    expect(review).toContain("diff-add");
    expect(review).toContain("export const changed = 2;");
    expect(review).toContain("这是本次修改的那行。");
    expect(review).toContain("attention-must-read");
    // 导航置顶链接
    expect(review).toContain("本 PR 检视</a>");
  });
});
