// 门禁自测试：docs 索引——每个 docs/**/*.md 必须登记进 docs/README.md 地图表，
// 登记的必须存在；postmortem 事故件与 .en.md 侧豁免。夹具机制见 spec-fixture.mjs。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-doc-index.mjs", "doc-index");
afterAll(gate.cleanup);

describe("verify-doc-index", () => {
  it("登记齐全即过；postmortem 事故件与英文侧不进索引", async () => {
    const result = await gate.run({
      "docs/README.md": "# 索引\n\n| 文档 | 说明 |\n|---|---|\n| [a](a.md) | A |\n",
      "docs/a.md": "# A\n",
      "docs/a.en.md": "# A\n",
      "docs/postmortem/0001-x.md": "# 事故\n",
    });
    expect(result.ok).toBe(true);
  });

  it("未登记的报缺、登记不存在的报幽灵", async () => {
    const result = await gate.run({
      "docs/README.md": "# 索引\n\n| 文档 | 说明 |\n|---|---|\n| [ghost](ghost.md) | G |\n| [a](a.md) | A |\n",
      "docs/a.md": "# A\n",
      "docs/c.md": "# C\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "docs/c.md: 未登记进 docs/README.md 地图表",
      "docs/README.md: 登记的 docs/ghost.md 不存在",
    ]);
  });
});
