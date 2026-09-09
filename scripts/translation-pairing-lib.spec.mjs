// 门禁自测试：配对纯逻辑层（蓝本 doc-standard.spec 的对应物）——
// 门禁脚本自身也要有测试背书，尤其结构签名这种自写的解析逻辑。
// hash 向量由 git hash-object 实算钉死，与实现算法无循环依赖。

import { describe, expect, it } from "vitest";
import {
  blobHash,
  documentAnchors,
  generatedRegionsEqual,
  githubSlug,
  isManifestExcluded,
  isSwitcherLine,
  markdownLinks,
  normalizeLinkTarget,
  pairAnchorOfArgument,
  pairPaths,
  parseLinkTarget,
  parsePairRecord,
  parsePairingCliArgs,
  parsePairingManifest,
  parseSignature,
  partitionGeneratedRegions,
  renderPairRecord,
  structureDiff,
} from "./translation-pairing-lib.mjs";

describe("pairPaths", () => {
  it("三件套路径从中文 base 推导", () => {
    expect(pairPaths("docs/foo.md")).toEqual({
      base: "docs/foo.md",
      en: "docs/foo.en.md",
      meta: "docs/foo.i18n.yaml",
    });
  });
  it("拒绝英文侧与非 md 输入", () => {
    expect(() => pairPaths("docs/foo.en.md")).toThrow();
    expect(() => pairPaths("docs/foo.txt")).toThrow();
  });
});

describe("pairAnchorOfArgument", () => {
  it("三件套任一文件名或裸词干都归一到 base", () => {
    expect(pairAnchorOfArgument("docs/foo.md")).toBe("docs/foo.md");
    expect(pairAnchorOfArgument("docs/foo.en.md")).toBe("docs/foo.md");
    expect(pairAnchorOfArgument("docs/foo.i18n.yaml")).toBe("docs/foo.md");
    expect(pairAnchorOfArgument("docs/foo")).toBe("docs/foo.md");
  });
  it("Windows 分隔符与 ./ 前缀归一", () => {
    expect(pairAnchorOfArgument(".\\docs\\foo.en.md")).toBe("docs/foo.md");
  });
});

describe("blobHash", () => {
  it("与 git hash-object 一致（实算向量）", () => {
    expect(blobHash(Buffer.alloc(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(blobHash(Buffer.from("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(blobHash(Buffer.from("# 标题\n"))).toBe("1dd08435db2740e224c8b0989f9de60ff105121e");
  });
  it("字符串输入与 Buffer 等价", () => {
    expect(blobHash("# 标题\n")).toBe("1dd08435db2740e224c8b0989f9de60ff105121e");
  });
});

describe("partitionGeneratedRegions", () => {
  it("切分生成区与人工内容（标记行含在区内）", () => {
    const doc = [
      "# T",
      "",
      "<!-- BEGIN GENERATED a (x) — do not edit between markers -->",
      "body",
      "<!-- END GENERATED a -->",
      "",
      "tail",
    ].join("\n");
    const { regions, stripped } = partitionGeneratedRegions(doc);
    expect(regions).toEqual([
      "<!-- BEGIN GENERATED a (x) — do not edit between markers -->\nbody\n<!-- END GENERATED a -->",
    ]);
    expect(stripped).toBe("# T\n\n\ntail");
  });
  it("残缺的标记行抛错", () => {
    expect(() => partitionGeneratedRegions("<!-- BEGIN GENERATED x")).toThrow(/残缺/);
  });
  it("嵌套 BEGIN 抛错", () => {
    expect(() =>
      partitionGeneratedRegions("<!-- BEGIN GENERATED a -->\n<!-- BEGIN GENERATED b -->\n<!-- END GENERATED a -->"),
    ).toThrow(/嵌套/);
  });
  it("END 无 BEGIN、slug 不匹配抛错", () => {
    expect(() => partitionGeneratedRegions("<!-- END GENERATED a -->")).toThrow(/没有对应 BEGIN/);
    expect(() =>
      partitionGeneratedRegions("<!-- BEGIN GENERATED a -->\n<!-- END GENERATED b -->"),
    ).toThrow(/不匹配/);
  });
});

describe("generatedRegionsEqual", () => {
  it("除 locale 投影路径外逐字节一致即相等", () => {
    expect(
      generatedRegionsEqual(
        ["<!-- BEGIN GENERATED x -->\nsee docs/a.md<!-- END GENERATED x -->"],
        ["<!-- BEGIN GENERATED x -->\nsee docs/a.en.md<!-- END GENERATED x -->"],
      ),
    ).toBe(true);
  });
  it("内容或数量不同即不等", () => {
    expect(
      generatedRegionsEqual(
        ["<!-- BEGIN GENERATED x -->\nA<!-- END GENERATED x -->"],
        ["<!-- BEGIN GENERATED x -->\nB<!-- END GENERATED x -->"],
      ),
    ).toBe(false);
    expect(generatedRegionsEqual([], ["x"])).toBe(false);
  });
});

describe("parseSignature", () => {
  it("标题层级、围栏、表格、列表、链接全签名", () => {
    const sig = parseSignature(
      [
        "# H1",
        "## H2",
        "",
        "para with [a](foo.md) and [b](bar.md#sec)",
        "",
        "```ts",
        "let x = 1;",
        "```",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "| 3 | 4 |",
        "",
        "- a",
        "- b",
        "  - c",
        "1. x",
        "2. y",
      ].join("\n"),
    );
    expect(sig.headings).toEqual([1, 2]);
    expect(sig.code).toEqual(["```ts\nlet x = 1;"]);
    expect(sig.tables).toEqual(["3x2"]);
    expect(sig.lists).toEqual(["bullet:items=2", "bullet:items=1", "ordered:start=1:items=2"]);
    expect(sig.links).toEqual(["foo.md", "bar.md"]);
  });
  it("切换行不进链接签名；语料内 .en.md 目标折算到 base；md 目标的 fragment 不进镜像", () => {
    const sig = parseSignature("[English](a.en.md) | 中文\nsee [x](b.en.md) and [y](c.en.md#s)");
    expect(sig.links).toEqual(["b.md", "c.md"]);
  });
  it("HTML 注释行不贡献结构；跨行注释整体跳过", () => {
    const sig = parseSignature("<!-- one -->\n<!-- open\n# not a heading\n-->\n# real");
    expect(sig.headings).toEqual([1]);
  });
  it("未闭合围栏抛错", () => {
    expect(() => parseSignature("```ts\nx")).toThrow(/未闭合/);
  });
});

describe("isSwitcherLine", () => {
  it("两种语言形态", () => {
    expect(isSwitcherLine("[English](a.en.md) | 中文")).toBe(true);
    expect(isSwitcherLine("English | [中文](a.md)")).toBe(true);
    expect(isSwitcherLine("[English](a.en.md) | 中文 extra")).toBe(false);
  });
});

describe("normalizeLinkTarget", () => {
  it(".en.md 折算；md 目标的 fragment 是 locale 内容不进镜像（query 保留）；非 md 目标 query/fragment 保留", () => {
    expect(normalizeLinkTarget("foo.en.md")).toBe("foo.md");
    expect(normalizeLinkTarget("foo.en.md#s")).toBe("foo.md");
    expect(normalizeLinkTarget("foo.en.md#已知欠账")).toBe("foo.md");
    expect(normalizeLinkTarget("foo.en.md?q=1")).toBe("foo.md?q=1");
    expect(normalizeLinkTarget("foo.en.md?q=1#s")).toBe("foo.md?q=1");
    expect(normalizeLinkTarget("bar.md")).toBe("bar.md");
    expect(normalizeLinkTarget("bar.md#s")).toBe("bar.md");
    expect(normalizeLinkTarget("../scripts/x.mjs#L3")).toBe("../scripts/x.mjs#L3");
  });
});

describe("markdownLinks", () => {
  it("带行号产出目标", () => {
    expect([...markdownLinks("line1 [a](x.md)\nline2 [b](y.md)")]).toEqual([
      { line: 1, target: "x.md" },
      { line: 2, target: "y.md" },
    ]);
  });
});

describe("structureDiff", () => {
  const empty = { headings: [], code: [], tables: [], lists: [], links: [] };
  it("结构镜像时为空", () => {
    const sig = { headings: [1], code: ["```ts\nx"], tables: [], lists: [], links: ["a.md"] };
    expect(structureDiff(sig, { ...sig })).toEqual([]);
  });
  it("每个结构域只报第一处分歧", () => {
    const diff = structureDiff({ ...empty, headings: [1, 2] }, { ...empty, headings: [1, 3] });
    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain("标题层级 #2");
  });
});

describe("配对记录 parse/render", () => {
  const paths = pairPaths("docs/foo.md");
  const record = { baseHash: "a".repeat(40), enHash: "b".repeat(40) };
  it("render → parse 往返", () => {
    expect(parsePairRecord(renderPairRecord(paths, record), paths)).toEqual(record);
  });
  it("非法格式返回 undefined", () => {
    expect(parsePairRecord("docs/foo.md: xyz\n", paths)).toBeUndefined();
    expect(parsePairRecord(`foo.md: ${"a".repeat(40)}\nfoo.md: ${"b".repeat(40)}\n`, paths)).toBeUndefined();
    expect(
      parsePairRecord(`foo.md: ${"a".repeat(40)}\nother.md: ${"b".repeat(40)}\n`, paths),
    ).toBeUndefined();
    expect(parsePairRecord(`foo.md: ${"a".repeat(40)}\n`, paths)).toBeUndefined();
  });
});

describe("豁免 manifest", () => {
  it("只认 excluded 字段", () => {
    expect(parsePairingManifest('{"excluded": []}')).toEqual({ excluded: [] });
    expect(parsePairingManifest('{"//": "c", "excluded": ["docs/"]}')).toEqual({ excluded: ["docs/"] });
    expect(() => parsePairingManifest("{}")).toThrow(/excluded/);
    expect(() => parsePairingManifest('{"foo": 1}')).toThrow(/不支持/);
  });
  it("精确文件与目录子树", () => {
    const manifest = { excluded: ["docs/", "README.md"] };
    expect(isManifestExcluded("docs/a.md", manifest)).toBe(true);
    expect(isManifestExcluded("docsx/a.md", manifest)).toBe(false);
    expect(isManifestExcluded("README.md", manifest)).toBe(true);
    expect(isManifestExcluded("README.en.md", manifest)).toBe(false);
  });
});

describe("parsePairingCliArgs", () => {
  it("无参=全库检查；具名=单对检查（锚点归一并去重）", () => {
    expect(parsePairingCliArgs([])).toEqual({ mode: "check", scope: "corpus", anchors: [] });
    expect(parsePairingCliArgs(["docs/a.md"])).toEqual({
      mode: "check",
      scope: "pairs",
      anchors: ["docs/a.md"],
    });
    expect(parsePairingCliArgs(["docs/a.md", "docs/a.en.md"])).toEqual({
      mode: "check",
      scope: "pairs",
      anchors: ["docs/a.md"],
    });
  });
  it("--list 独用；--write 须点名 pair 或 --all", () => {
    expect(parsePairingCliArgs(["--list"])).toEqual({ mode: "list", scope: "corpus", anchors: [] });
    expect(parsePairingCliArgs(["--write", "docs/a.md"]).mode).toBe("write");
    expect(parsePairingCliArgs(["--write", "--all"])).toEqual({
      mode: "write",
      scope: "corpus",
      anchors: [],
    });
    expect(() => parsePairingCliArgs(["--write"])).toThrow();
    expect(() => parsePairingCliArgs(["--all"])).toThrow();
    expect(() => parsePairingCliArgs(["--write", "docs/a.md", "--all"])).toThrow();
    expect(() => parsePairingCliArgs(["--list", "docs/a.md"])).toThrow();
    expect(() => parsePairingCliArgs(["--bogus"])).toThrow(/未知参数/);
  });
  it("-- 分隔符（pnpm run 透传）被忽略", () => {
    expect(parsePairingCliArgs(["--write", "--", "docs/a.md"])).toEqual({
      mode: "write",
      scope: "pairs",
      anchors: ["docs/a.md"],
    });
    expect(parsePairingCliArgs(["--", "docs/a.md"]).mode).toBe("check");
  });
});

describe("parseLinkTarget", () => {
  it("拆 path 与 fragment，剥 query，percent-decode", () => {
    expect(parseLinkTarget("b.md")).toEqual({ external: false, path: "b.md", fragment: null });
    expect(parseLinkTarget("b.md#sec")).toEqual({ external: false, path: "b.md", fragment: "sec" });
    expect(parseLinkTarget("b.md?raw#sec")).toEqual({ external: false, path: "b.md", fragment: "sec" });
    expect(parseLinkTarget("#sec")).toEqual({ external: false, path: "", fragment: "sec" });
    expect(parseLinkTarget("My%20File.md")).toEqual({ external: false, path: "My File.md", fragment: null });
    expect(parseLinkTarget("b.md#")).toEqual({ external: false, path: "b.md", fragment: null });
  });
  it("坏 percent 转义回退原文（%zz 不是谁真想链的文件）", () => {
    expect(parseLinkTarget("%zz.md").path).toBe("%zz.md");
    expect(parseLinkTarget("b.md#%zz").fragment).toBe("%zz");
  });
  it("外链识别：scheme、协议相对、根绝对", () => {
    expect(parseLinkTarget("https://x/y#z").external).toBe(true);
    expect(parseLinkTarget("mailto:a@b").external).toBe(true);
    expect(parseLinkTarget("//host/x.md").external).toBe(true);
    expect(parseLinkTarget("/abs/x.md").external).toBe(true);
  });
});

describe("githubSlug", () => {
  it("小写、丢标点、空格→连字符；下划线保留、CJK 保留", () => {
    expect(githubSlug("Status 与文件夹互检")).toBe("status-与文件夹互检");
    expect(githubSlug("Showcase: web_fetch")).toBe("showcase-web_fetch");
    expect(githubSlug("What the model sees / Token effect")).toBe("what-the-model-sees--token-effect");
  });
});

describe("documentAnchors", () => {
  it("标题 slug + 显式 <a id>；重复 slug 占位计数 -1、-2", () => {
    const text = [
      "# T",
      "",
      "## Repeat",
      "",
      "## Repeat",
      "",
      "## Repeat",
      "",
      '<a id="explicit"></a>',
      "",
    ].join("\n");
    const anchors = documentAnchors(text);
    expect(anchors.has("t")).toBe(true);
    expect(anchors.has("repeat")).toBe(true);
    expect(anchors.has("repeat-1")).toBe(true);
    expect(anchors.has("repeat-2")).toBe(true);
    expect(anchors.has("explicit")).toBe(true);
    expect(anchors.has("nope")).toBe(false);
  });
  it("围栏与 HTML 注释里的标题/id 不算数；标题里的链接取可见文字", () => {
    const text = [
      "## See [docs](x.md)",
      "",
      "```md",
      "## Fenced",
      '```',
      "",
      "<!--",
      '## Commented <a id="ghost">',
      "-->",
      "",
      '<a id="real"></a>',
    ].join("\n");
    const anchors = documentAnchors(text);
    expect(anchors.has("see-docs")).toBe(true);
    expect(anchors.has("see-docsxmd")).toBe(false);
    expect(anchors.has("fenced")).toBe(false);
    expect(anchors.has("commented")).toBe(false);
    expect(anchors.has("ghost")).toBe(false);
    expect(anchors.has("real")).toBe(true);
  });
});
