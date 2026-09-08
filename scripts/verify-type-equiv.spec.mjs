// 门禁自测试：type-equiv 防伪锁——围栏与源码结构+JSDoc 逐字等价、
// 围栏与 manifest 1:1、英文侧字节折算。夹具机制见 spec-fixture.mjs。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-type-equiv.mjs", "type-equiv");
afterAll(gate.cleanup);

const SOURCE = 'src/brand.ts';
const SOURCE_TEXT = '/** A string carrying a brand. */\nexport type Branded = string & { readonly brand: "b" };\n';
const FENCE = "```ts type-equiv\n" + SOURCE_TEXT + "```\n";
const MANIFEST = (entries) => `{"entries":${JSON.stringify(entries)}}\n`;
const GOOD_ENTRY = { doc: "docs/core.md", symbol: "Branded", source: SOURCE };

describe("verify-type-equiv", () => {
  it("等价围栏过检；英文侧字节一致折算不重复检查", async () => {
    const result = await gate.run({
      [SOURCE]: SOURCE_TEXT,
      "README.md": "# R\n",
      "docs/core.md": "# Core\n\n" + FENCE,
      "docs/core.en.md": "# Core\n\n" + FENCE,
      "scripts/type-equiv.manifest.json": MANIFEST([GOOD_ENTRY]),
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("1 个围栏与源码结构+JSDoc 一致");
    expect(result.summary).toContain("1 个英文侧字节折算");
  });

  it("围栏漂移（丢 JSDoc）与未登记围栏都红", async () => {
    const result = await gate.run({
      [SOURCE]: SOURCE_TEXT,
      "README.md": "# R\n",
      "docs/core.md":
        "# Core\n\n```ts type-equiv\nexport type Branded = string & { readonly brand: \"b\" };\n```\n",
      "docs/other.md": "# Other\n\n```ts type-equiv\nexport type Other = number;\n```\n",
      "scripts/type-equiv.manifest.json": MANIFEST([GOOD_ENTRY]),
    });
    expect(result.ok).toBe(false);
    const joined = result.errors.join("\n");
    expect(joined).toContain("DRIFT: docs/core.md");
    expect(joined).toContain("Other 的 type-equiv 围栏没有 manifest 条目");
  });

  it("manifest 孤儿条目（登记了没有围栏）红", async () => {
    const result = await gate.run({
      [SOURCE]: SOURCE_TEXT,
      "README.md": "# R\n",
      "docs/core.md": "# Core\n",
      "scripts/type-equiv.manifest.json": MANIFEST([GOOD_ENTRY]),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "manifest: Branded（docs/core.md）没有对应围栏",
    );
  });
});
