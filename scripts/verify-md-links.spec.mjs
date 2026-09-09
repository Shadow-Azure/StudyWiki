// 门禁自测试：md 死链与死锚检查——正文相对链接必须可达，markdown 目标上的
// #fragment 必须命中真实标题 slug 或显式 <a id>；根文件（README 两侧 + AGENTS.md）
// 在扫描面。围栏与行内代码里的"链接"是示例不算数。夹具机制见 spec-fixture.mjs。

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

  it("根文件在扫描面：README.md / README.en.md / AGENTS.md 死链即红", async () => {
    const result = await gate.run({
      "README.md": "# StudyWiki\n\n见 [架构](docs/nope.md)。\n",
      "README.en.md": "# StudyWiki\n\nSee [architecture](docs/nope.md).\n",
      "AGENTS.md": "# AGENTS.md\n\n见 [文档](docs/nope2.md)。\n",
      "docs/a.md": "# A\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("README.md: 死链 → docs/nope.md");
    expect(result.errors.join("\n")).toContain("README.en.md: 死链 → docs/nope.md");
    expect(result.errors.join("\n")).toContain("AGENTS.md: 死链 → docs/nope2.md");
  });

  it("死锚红：markdown 目标的 #fragment 必须命中标题 slug 或显式 <a id>", async () => {
    const result = await gate.run({
      "docs/a.md": "# A\n\n[坏锚](b.md#nope)。\n",
      "docs/b.md": "# B\n\n## 目标段\n\n<a id=\"explicit\"></a>\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["docs/a.md: 死锚 → b.md#nope"]);
  });

  it("重复标题按 GitHub 占位计数：#repeat 与 #repeat-1 有效，#repeat-2 死锚", async () => {
    const result = await gate.run({
      "docs/a.md": "# A\n\n[一](b.md#repeat)、[二](b.md#repeat-1)、[三](b.md#repeat-2)。\n",
      "docs/b.md": "# B\n\n## Repeat\n\n## Repeat\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["docs/a.md: 死锚 → b.md#repeat-2"]);
  });

  it("好锚全过：中英混排 slug、显式 id、同文件锚、query 不影响解析；非 md 目标的 fragment 不校验", async () => {
    const result = await gate.run({
      "docs/a.md":
        "# A\n\n[好](b.md#目标段)、[英](b.md#status-互检)、[显式](b.md#explicit)、[同文件](#a)、[带query](b.md?raw#explicit)、[代码行号](../scripts/x.mjs#L3)。\n",
      "docs/b.md": "# B\n\n## 目标段\n\n## Status 互检\n\n<a id=\"explicit\"></a>\n",
      "scripts/x.mjs": "// x\n",
    });
    expect(result.ok).toBe(true);
  });
});
