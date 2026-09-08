// 门禁自测试：封闭集合与 README 互为镜像——
// 「加 class/lifecycle 须同时改脚本与 README」的契约由测试背书，改一处漏一处即红。

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CLASSES, LIFECYCLES } from "./verify-agent-notes.mjs";

describe("封闭集合 ↔ README 互检", () => {
  it("CLASSES 与 README 分类表逐项一致（含顺序）", async () => {
    const readme = await readFile(".agents/notes/README.md", "utf8");
    const table = [...readme.matchAll(/^\| `([\w-]+)` \|/gm)].map((m) => m[1]);
    expect(table).toEqual([...CLASSES]);
  });
  it("LIFECYCLES 覆盖 README 三个活跃 lifecycle + 未启用的 archived", async () => {
    const readme = await readFile(".agents/notes/README.md", "utf8");
    const bullets = [...readme.matchAll(/\*\*`(\w+)\/`\*\*/g)].map((m) => m[1]);
    expect(bullets).toEqual(["proposed", "implemented", "rejected"]);
    expect([...LIFECYCLES]).toEqual([...bullets, "archived"]);
  });
});
