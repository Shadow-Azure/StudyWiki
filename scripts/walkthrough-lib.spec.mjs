// 门禁自测试：walkthrough 纯函数库——站点装载、schema、锚点、对账与覆盖率。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkAnchors,
  checkChanges,
  checkDiff,
  checkFilePages,
  checkFeatures,
  checkLineCoverage,
  locateSnippet,
  parseSite,
  validateSchema,
} from "./walkthrough-lib.mjs";

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

const SOURCE = `const covered = 1;
const coveredToo = 2;

const uncovered = 3;
const uncoveredToo = 4;
`;

function validOverview() {
  return {
    kind: "overview",
    sections: [{ heading: "总览", body: "这是什么工程。\n" }],
  };
}

function validArchitecture() {
  return {
    kind: "architecture",
    sections: [{ heading: "分层", body: "三层结构。\n", generated: "code-map" }],
  };
}

function validFeatureIndex() {
  return {
    features: [{
      slug: "demo",
      title: "Demo",
      summary: "演示功能",
      issue: "demo-change",
    }],
  };
}

function validFeature() {
  return {
    kind: "feature",
    slug: "demo",
    title: "Demo",
    behavior: "用户能看到演示。\n",
    modules: ["src/demo.ts"],
    steps: [
      {
        ref: { file: "src/demo.ts", snippet: "const covered = 1;" },
        note: "入口常量。\n",
      },
    ],
    related: { notes: [] },
  };
}

function validFilePage() {
  return {
    kind: "file-page",
    source: "src/demo.ts",
    summary: "演示源文件",
    segments: [
      {
        snippet: "const covered = 1;\nconst coveredToo = 2;",
        note: "前两行是被讲解的起点。\n",
      },
    ],
  };
}

function validChange() {
  return {
    kind: "change",
    issue: "demo-change",
    title: "Demo change",
    functional: "功能行为变化。\n",
    architectural: "无。\n",
    code: "新增常量。\n",
    touches: ["file:src/demo.ts", "file:src-tauri/src/main.rs", "feature:demo"],
  };
}

function validManifest(threshold = 0.5, exemptions = {}) {
  return {
    bootstrap: false,
    lineCoverage: { threshold, exemptions },
  };
}

function emptySite({
  overview = validOverview(),
  architecture = validArchitecture(),
  featureIndex = validFeatureIndex(),
  manifest = validManifest(),
} = {}) {
  return {
    overview,
    architecture,
    featureIndex,
    features: new Map(),
    filePages: new Map(),
    changes: new Map(),
    manifest,
    parseErrors: [],
  };
}

function writeOverview(root) {
  write(
    root,
    "walkthrough/overview.yaml",
    `kind: overview
sections:
  - heading: 总览
    body: |
      这是什么工程。
`,
  );
}

function writeArchitecture(root) {
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
}

function writeRegistry(root) {
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
}

function writeFeature(root, slug = "demo", overrides = "") {
  write(
    root,
    `walkthrough/features/${slug}.yaml`,
    `kind: feature
slug: ${slug}
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
${overrides}`,
  );
}

function writeFilePage(root, source = "src/demo.ts", overrides = "") {
  const yamlPath = `walkthrough/files/${source}.yaml`;
  write(
    root,
    yamlPath,
    `kind: file-page
source: ${source}
summary: 演示源文件
segments:
  - snippet: |
      const covered = 1;
      const coveredToo = 2;
    note: |
      前两行是被讲解的起点。
${overrides}`,
  );
  return yamlPath;
}

function writeChange(root) {
  write(
    root,
    "walkthrough/changes/demo-change.yaml",
    `kind: change
issue: demo-change
title: Demo change
functional: |
  功能行为变化。
architectural: |
  无。
code: |
  新增常量。
touches: [file:src/demo.ts, file:src-tauri/src/main.rs, feature:demo]
`,
  );
}

function writeValidSite(root, manifestThreshold = 0.5) {
  writeOverview(root);
  writeArchitecture(root);
  writeRegistry(root);
  writeFeature(root);
  writeFilePage(root);
  writeChange(root);
  write(
    root,
    "walkthrough/manifest.json",
    `${JSON.stringify(
      {
        bootstrap: false,
        lineCoverage: {
          threshold: manifestThreshold,
          exemptions: {},
        },
      },
      null,
      2,
    )}\n`,
  );
  write(root, "src/demo.ts", SOURCE);
  write(
    root,
    "src-tauri/src/main.rs",
    "fn main() {\n    println!(\"demo\");\n}\n",
  );
}

describe("walkthrough-lib", () => {
  it("parseSite 装载五类页并按契约键建立索引", () => {
    const root = tempRoot("studywiki-walkthrough-valid-");
    writeValidSite(root);
    const site = parseSite(root);

    expect(site.parseErrors).toEqual([]);
    expect(site.overview).toEqual(validOverview());
    expect(site.architecture).toEqual(validArchitecture());
    expect(site.featureIndex).toEqual(validFeatureIndex());
    expect([...site.features.keys()]).toEqual(["demo"]);
    expect([...site.filePages.keys()]).toEqual(["src/demo.ts"]);
    expect([...site.changes.keys()]).toEqual(["demo-change"]);
    expect(site.manifest).toEqual(validManifest(0.5));
    expect(validateSchema(site)).toEqual([]);
  });

  it("parseSite 收集 YAML/JSON 解析错误而不抛出", () => {
    const root = tempRoot("studywiki-walkthrough-broken-");
    write(root, "walkthrough/overview.yaml", "kind: overview\nsections:\n  bad\n");
    writeArchitecture(root);
    writeRegistry(root);
    write(root, "walkthrough/manifest.json", "{ not json\n");
    const site = parseSite(root);

    expect(site.parseErrors).toHaveLength(2);
    expect(site.parseErrors[0]).toContain("walkthrough/overview.yaml");
    expect(site.parseErrors[1]).toContain("walkthrough/manifest.json");
    expect(site.overview).toBeNull();
    expect(site.manifest).toBeNull();
  });

  it("validateSchema 拒绝未知 kind、缺必填字段、未知键与错误类型", () => {
    const root = tempRoot("studywiki-walkthrough-schema-");
    const site = emptySite();
    site.filePages.set("src/demo.ts", {
      kind: "file-pag",
      source: "src/demo.ts",
      summary: "演示源文件",
    });
    let errors = validateSchema(site);
    expect(errors).toContain(
      "walkthrough/files/src/demo.ts.yaml: kind 必须是封闭集合之一",
    );

    const siteMissingSegments = emptySite();
    siteMissingSegments.filePages.set("src/demo.ts", {
      kind: "file-page",
      source: "src/demo.ts",
      summary: "演示源文件",
      segments: [],
    });
    errors = validateSchema(siteMissingSegments);
    expect(errors).toContain(
      "walkthrough/files/src/demo.ts.yaml: segments 必须是非空数组",
    );

    const siteExtraKey = emptySite();
    siteExtraKey.filePages.set("src/demo.ts", {
      ...validFilePage(),
      extra: true,
    });
    errors = validateSchema(siteExtraKey);
    expect(errors).toContain(
      "walkthrough/files/src/demo.ts.yaml: 未知键 extra",
    );

    const siteBadType = emptySite();
    siteBadType.featureIndex = { features: [] };
    siteBadType.features.set("demo", { ...validFeature(), modules: "src/demo.ts" });
    errors = validateSchema(siteBadType);
    expect(errors).toContain(
      "walkthrough/features/demo.yaml: modules 必须是非空字符串数组",
    );
  });

  it("validateSchema 收紧 featureIndex、manifest 与 overview generated", () => {
    const site = emptySite();
    site.featureIndex = {
      extra: true,
      features: [{ slug: "demo", title: "Demo", summary: "演示功能" }],
    };
    site.manifest = {
      extra: true,
      bootstrap: "true",
      lineCoverage: { threshold: "x", exemptions: [], extra: true },
    };
    site.overview.sections[0].generated = "code-map";
    const errors = validateSchema(site);

    expect(errors).toContain("features.yaml: 未知键 extra");
    expect(errors).toContain("features.yaml features[0]: issue 必须是非空字符串");
    expect(errors).toContain("walkthrough/manifest.json: 未知键 extra");
    expect(errors).toContain("walkthrough/manifest.json: bootstrap 必须是 boolean");
    expect(errors).toContain("walkthrough/manifest.json.lineCoverage: 未知键 extra");
    expect(errors).toContain("walkthrough/manifest.json.lineCoverage: threshold 必须是 0 到 1 的数字");
    expect(errors).toContain("walkthrough/manifest.json.lineCoverage: exemptions 必须是 map");
    expect(errors).toContain(
      "walkthrough/overview.yaml sections[0]: generated 仅 architecture 支持",
    );
  });

  it("locateSnippet 归一化行尾空白，多处匹配计 count", () => {
    const src = "fn a() {\n  go();  \n}\nfn b() {\n  go();\n}\n";
    expect(locateSnippet(src, "go();")).toEqual({ start: 2, end: 2, count: 2 });
    expect(locateSnippet(src, "不存在")).toBeNull();
    expect(locateSnippet("aaa\n", "aa")).toEqual({ start: 1, end: 1, count: 2 });
    // 块标量天然保留末尾换行；定位时只剥掉这一个归一化换行。
    expect(locateSnippet("a;\nb;\n", "a;\n")).toEqual({ start: 1, end: 1, count: 1 });
    expect(locateSnippet(src, "  go();\n}\n")).toEqual({ start: 2, end: 3, count: 2 });
    // 只剥掉一个换行：snippet 保留的空行仍参与定位。
    expect(locateSnippet("a;\n\nb;\n", "a;\n\n")).toEqual({
      start: 1,
      end: 2,
      count: 1,
    });
    expect(locateSnippet(src, "go();\n}\nfn b()")).toEqual({
      start: 2,
      end: 4,
      count: 1,
    });
  });

  it("checkAnchors 定位文件页与功能页锚点，缺失源码或片段红", () => {
    const root = tempRoot("studywiki-walkthrough-anchors-");
    write(root, "src/demo.ts", SOURCE);
    const site = emptySite();
    site.filePages.set("src/demo.ts", validFilePage());
    site.features.set("demo", validFeature());
    expect(checkAnchors(root, site)).toEqual([]);

    const missing = emptySite();
    missing.filePages.set("src/demo.ts", {
      ...validFilePage(),
      segments: [{ ...validFilePage().segments[0], snippet: "not present" }],
    });
    missing.features.set("demo", {
      ...validFeature(),
      steps: [{ ref: { file: "src/gone.ts", snippet: "gone" }, note: "x" }],
    });
    const errors = checkAnchors(root, missing);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("src/demo.ts");
    expect(errors[0]).toContain("walkthrough/files/src/demo.ts.yaml");
    expect(errors[1]).toContain("src/gone.ts");
    expect(errors[1]).toContain("walkthrough/features/demo.yaml");
  });

  it("checkFilePages 缺页、孤儿页和 summary 漂移都红，vendor 豁免", () => {
    const root = tempRoot("studywiki-walkthrough-files-");
    const site = parseSite(root);
    const codeMap = {
      "//": "注释",
      src: "目录",
      "src/demo.ts": "演示源文件",
      "src-tauri/src/main.rs": "入口壳",
      "vendor/lib/upstream.ts": "上游源码",
    };
    site.filePages.set("src/demo.ts", validFilePage());
    site.filePages.set("src/orphan.ts", { ...validFilePage(), source: "src/orphan.ts" });
    const errors = checkFilePages(site, codeMap);
    expect(errors).toContain("文件页缺失: src-tauri/src/main.rs");
    expect(errors).toContain("孤儿文件页: src/orphan.ts");

    const drifted = emptySite();
    drifted.filePages.set("src/demo.ts", {
      ...validFilePage(),
      summary: "不再逐字",
    });
    const codeMapOne = { "src/demo.ts": "演示源文件" };
    expect(checkFilePages(drifted, codeMapOne)).toEqual([
      "summary 与 code-map 不一致: src/demo.ts",
    ]);
  });

  it("checkFeatures 对账登记处与目录，双方缺失都红", () => {
    const root = tempRoot("studywiki-walkthrough-features-");
    const site = parseSite(root);
    site.featureIndex = {
      features: [
        { slug: "demo", title: "Demo" },
        { slug: "orphan", title: "Orphan" },
      ],
    };
    site.features.set("demo", validFeature());
    expect(checkFeatures(site)).toEqual([
      "功能页缺失: orphan",
    ]);

    const orphanPage = emptySite();
    orphanPage.featureIndex = { features: [{ slug: "demo", title: "Demo" }] };
    orphanPage.features.set("demo", validFeature());
    orphanPage.features.set("extra", { ...validFeature(), slug: "extra" });
    expect(checkFeatures(orphanPage)).toEqual([
      "未登记功能页: extra",
    ]);
  });

  it("checkChanges：backlog 无页不红，in-progress 无页红，孤儿页红", () => {
    const site = emptySite();
    const issues = [
      { slug: "backlog-issue", status: "backlog" },
      { slug: "active-issue", status: "in-progress" },
      { slug: "done-issue", status: "done" },
    ];
    site.changes.set("backlog-issue", { ...validChange(), issue: "backlog-issue" });
    site.changes.set("done-issue", validChange());
    site.changes.set("removed-issue", { ...validChange(), issue: "removed-issue" });
    expect(checkChanges(site, issues)).toEqual([
      "变更页缺失: active-issue",
      "变更页指向不存在 issue: removed-issue",
    ]);
  });

  it("checkLineCoverage 低于阈值红、达标与豁免放行", () => {
    const root = tempRoot("studywiki-walkthrough-coverage-");
    write(root, "src/demo.ts", SOURCE);
    const site = emptySite({ manifest: validManifest(0.5) });
    site.filePages.set("src/demo.ts", validFilePage());
    expect(checkLineCoverage(root, site)).toEqual([]);

    site.manifest = validManifest(0.6);
    expect(checkLineCoverage(root, site)).toEqual([
      "行覆盖率低于阈值: src/demo.ts (50.00% < 60.00%)",
    ]);

    site.manifest = validManifest(0.6, { "src/demo.ts": "骨架期暂缓" });
    expect(checkLineCoverage(root, site)).toEqual([]);
  });

  it("checkLineCoverage 对重叠区间按行去重", () => {
    const root = tempRoot("studywiki-walkthrough-overlap-");
    write(root, "src/demo.ts", "one\ntwo\nthree\nfour\n");
    const site = emptySite({ manifest: validManifest(0.75) });
    site.filePages.set("src/demo.ts", {
      ...validFilePage(),
      segments: [
        { snippet: "one\ntwo", note: "第一段。\n" },
        { snippet: "two\nthree", note: "与上一段重叠。\n" },
      ],
    });
    expect(checkLineCoverage(root, site)).toEqual([]);
  });

  it("checkLineCoverage 的 segment 可跨越空行", () => {
    const root = tempRoot("studywiki-walkthrough-blank-");
    write(root, "src/demo.ts", "one\n\nthree\n");
    const site = emptySite({ manifest: validManifest(1) });
    site.filePages.set("src/demo.ts", {
      ...validFilePage(),
      segments: [{ snippet: "one\n\nthree", note: "跨空行讲解。\n" }],
    });
    expect(checkLineCoverage(root, site)).toEqual([]);
  });

  it("checkDiff 对非字符串 diff 项整条 fail-loud", () => {
    const site = emptySite();
    site.filePages.set("src/demo.ts", validFilePage());
    expect(checkDiff(["src/demo.ts", 42], site)).toEqual([
      "diffFiles 每项必须是字符串",
    ]);
  });

  it("checkDiff 使用注入 diff：改码必改页且 touches 覆盖源文件", () => {
    const site = emptySite();
    site.filePages.set("src/demo.ts", validFilePage());
    site.filePages.set("src-tauri/src/main.rs", {
      ...validFilePage(),
      source: "src-tauri/src/main.rs",
    });
    site.changes.set("demo-change", validChange());
    const diff = [
      "src/demo.ts",
      "src-tauri/src/main.rs",
      "walkthrough/files/src/demo.ts.yaml",
      "walkthrough/files/src-tauri/src/main.rs.yaml",
    ];
    expect(checkDiff(diff, site)).toEqual([]);

    const partialTouches = {
      ...site,
      changes: new Map([
        [
          "demo-change",
          {
            ...validChange(),
            touches: ["file:src/demo.ts", "feature:demo"],
          },
        ],
      ]),
    };
    expect(checkDiff(diff, partialTouches)).toEqual([
      "changes touches 缺少 file 引用: src-tauri/src/main.rs",
    ]);

    expect(
      checkDiff(["src/demo.ts"], {
        ...site,
        filePages: new Map(),
        changes: new Map([
          [
            "demo-change",
            {
              ...validChange(),
              touches: ["file:src-tauri/src/main.rs", "feature:demo"],
            },
          ],
        ]),
      }),
    ).toEqual([
      "改码但缺少文件页: src/demo.ts",
      "changes touches 缺少 file 引用: src/demo.ts",
    ]);
  });
});
