// 门禁自测试：md 死链检查——正文相对链接必须可达，围栏与行内代码里的
// "链接"是示例不算数。夹具机制见 spec-fixture.mjs。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-md-links.mjs", "md-links");
afterAll(gate.cleanup);

describe("verify-md-links", () => {
  it("好链全过（含向上相对链接），围栏与行内代码里的链接不算数", async () => {
    const result = await gate.run({
      "docs/a.md": "# A\n\n见 [b](b.md)。\n\n```md\n[围栏内](fenced-dead.md)\n```\n\n行内 `](inline-dead.md)` 不算。\n",
      "docs/b.md": "# B\n",
      ".agents/notes/n.md": "指回 [a](../../docs/a.md)。\n",
    });
    expect(result.ok).toBe(true);
  });

  it("死链精确到文件与目标", async () => {
    const result = await gate.run({
      "docs/a.md": "# A\n\n死链 [here](dead.md)。\n",
      "docs/b.md": "# B\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["docs/a.md: 死链 → dead.md"]);
  });
});
