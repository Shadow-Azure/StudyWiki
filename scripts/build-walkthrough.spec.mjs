// build-walkthrough 规格测试：用 tmpdir 夹具站点锁定产物结构、真实源码锚点、
// 文件页反链、构建期失败语义与 CLI 干净 stdout。

import { spawnSync } from "node:child_process";
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
    `kind: change
issue: demo-change
title: Demo change
functional: |
  功能行为变化。
architectural: |
  架构不变。
code: |
  新增常量。
touches: [file:${sourcePath}, feature:demo]
`,
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
    expect(readFileSync(path.join(outDir, "changes/demo-change.html"), "utf8")).toContain("功能行为变化");

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
