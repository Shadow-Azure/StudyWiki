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
  it("只把起始方括号的值当行内列表", () => {
    expect(parseWalkthroughYaml("a: x]", "t")).toEqual({ a: "x]" });
    expect(() => parseWalkthroughYaml("a: [x", "t")).toThrow("t:1: 行内列表格式应为 [a, b]");
  });
  it("解析 CRLF 并按归一化后行号报错", () => {
    const text = "a: 1\r\nnote: |\r\n  # x\r\n\r\n  y\r\n";
    expect(parseWalkthroughYaml(text, "t")).toEqual({ a: 1, note: "# x\n\ny\n" });
    expect(() => parseWalkthroughYaml("a:\r\n    b: deep\r\n", "t")).toThrow("t:2: 子节点缩进必须为 2 格");
  });
  it("拒绝引号 key", () => {
    expect(() => parseWalkthroughYaml('"k": v\n', "t")).toThrow("t:1: 不支持引号 key");
    expect(() => parseWalkthroughYaml("map:\n  'k': v\n", "t")).toThrow("t:2: 不支持引号 key");
  });
  it("重复 __proto__ 是重复键且不污染原型", () => {
    expect(() => parseWalkthroughYaml("__proto__: x\n__proto__: y\n", "t")).toThrow("t:2: 重复键 __proto__");
    const value = parseWalkthroughYaml("map:\n  __proto__: x\n", "t");
    expect(Object.hasOwn(value.map, "__proto__")).toBe(true);
  });
  it("拒绝同行嵌套列表项", () => {
    expect(() => parseWalkthroughYaml("items:\n  - - a\n", "t")).toThrow("t:2: 不支持列表项嵌套");
  });
  it("列表 dash 后必须恰一个空格", () => {
    expect(() => parseWalkthroughYaml("items:\n  -   a\n", "t")).toThrow("t:2: 列表项 `-` 后应恰一个空格");
  });
  it("块缩进由首个非空内容行决定", () => {
    expect(parseWalkthroughYaml("note: |\n\n  alpha\n    beta\n", "t")).toEqual({ note: "\nalpha\n  beta\n" });
    const text = "outer:\n  note: |\n      deep\n        deeper\n     shallow\n";
    expect(() => parseWalkthroughYaml(text, "t")).toThrow("t:5: 缩进过深（期望 2 格）");
  });
});
