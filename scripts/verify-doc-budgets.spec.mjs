// 门禁自测试：词数计数（中英混排下两侧权重一致的门禁基础）。

import { describe, expect, it } from "vitest";
import { countWords } from "./verify-doc-budgets.mjs";

describe("countWords", () => {
  it("空白分词", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("")).toBe(0);
    expect(countWords("  \n\t ")).toBe(0);
  });
  it("CJK 按字计", () => {
    expect(countWords("你好世界")).toBe(4);
  });
  it("中英混排权重一致", () => {
    expect(countWords("你好 world")).toBe(3);
    expect(countWords("env 无关性 hard constraint")).toBe(6);
  });
});
