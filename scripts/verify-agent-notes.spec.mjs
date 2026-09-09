// 门禁自测试：封闭集合与 README 互为镜像——
// 「加 class/lifecycle 须同时改脚本与 README」的契约由测试背书，改一处漏一处即红。

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { CLASSES, LIFECYCLES, SKELETON, skeletonErrors } from "./verify-agent-notes.mjs";
import { createGateRunner } from "./spec-fixture.mjs";

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
  it("SKELETON 与 README「文件格式」的正文骨架行逐项一致（含顺序）", async () => {
    const readme = await readFile(".agents/notes/README.md", "utf8");
    const skeletonLine = readme.split("\n").find((line) => line.startsWith("正文骨架："));
    expect(skeletonLine, "README 缺「正文骨架：」行").toBeTruthy();
    const names = [...skeletonLine.matchAll(/`## ([^`]+)`/g)].map((m) => m[1]);
    expect(names).toEqual([...SKELETON]);
  });
});

describe("skeletonErrors（正文骨架，纯函数）", () => {
  const body = (h2s) => `# Agent Note: 夹具\n\nStatus: implemented\n\n${h2s.map((h) => `## ${h}\n\n正文。\n`).join("\n")}`;

  it("四段齐全且首段 Problem → 无错误", () => {
    expect(skeletonErrors("f.md", body(SKELETON))).toEqual([]);
  });
  it("自由段插在骨架段之间 → 允许", () => {
    expect(
      skeletonErrors("f.md", body(["Problem", "技术细节", "Decision", "Alternatives considered", "Consequences"])),
    ).toEqual([]);
  });
  it("骨架末段之后不允许再放二级标题（契约字面：自由段只能插中间）", () => {
    const errors = skeletonErrors("f.md", body([...SKELETON, "Testing"]));
    expect(errors.join("\n")).toContain("之后不允许");
  });
  it("首段不是 Problem → 红", () => {
    const errors = skeletonErrors("f.md", body(["背景", ...SKELETON.slice(1)]));
    expect(errors.join("\n")).toContain("首个二级标题");
  });
  it("段名变体不算数（如 Decision（提案））→ 报缺逐字段名", () => {
    const errors = skeletonErrors(
      "f.md",
      body(["Problem", "Decision（提案）", "Alternatives considered", "Consequences"]),
    );
    expect(errors.join("\n")).toContain('缺 "## Decision"');
  });
  it("四名齐全但顺序错 → 报顺序", () => {
    const errors = skeletonErrors(
      "f.md",
      body(["Problem", "Consequences", "Decision", "Alternatives considered"]),
    );
    expect(errors.join("\n")).toContain("排序");
  });
  it("围栏里的 ## 是示例不是结构", () => {
    const fenced = `${body(SKELETON)}\n\`\`\`markdown\n## Decision\n\n## Problem\n\`\`\`\n`;
    expect(skeletonErrors("f.md", fenced)).toEqual([]);
  });
});

describe("verify-agent-notes（夹具集成）", () => {
  const { run, cleanup } = createGateRunner("verify-agent-notes.mjs", "agent-notes");
  const base = (h2s) =>
    `# Agent Note: 夹具\n\nStatus: implemented\n\n${h2s.map((h) => `## ${h}\n\n正文。\n`).join("\n")}`;
  const PATH = ".agents/notes/implemented/process/2026-09-01-fixture.md";
  const EN_PATH = ".agents/notes/implemented/process/2026-09-01-fixture.en.md";

  it("base 与 .en.md 两侧各自钉骨架：en 侧缺段即红", async () => {
    const result = await run({
      [PATH]: base(SKELETON),
      [EN_PATH]: base(["Problem", "Alternatives considered", "Consequences"]),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(EN_PATH);
    expect(result.errors.join("\n")).toContain('缺 "## Decision"');
  });
  it("两侧骨架齐全 → 不因骨架红", async () => {
    const result = await run({ [PATH]: base(SKELETON), [EN_PATH]: base(SKELETON) });
    expect(result.ok).toBe(true);
  });
  it("en 侧只查骨架：Status 行不合规不红（其余随 base，配对门禁管辖）", async () => {
    const en = `# Agent Note: fixture\n\nStatus: whatever\n\n${base(SKELETON).split("\n").slice(4).join("\n")}`;
    const result = await run({ [PATH]: base(SKELETON), [EN_PATH]: en });
    expect(result.ok).toBe(true);
  });
  it("互引链接死锚红：#fragment 必须命中目标 note 的标题", async () => {
    const TARGET = ".agents/notes/implemented/process/2026-09-02-target.md";
    const withLink = base(SKELETON).replace(
      "## Problem\n\n正文。",
      "## Problem\n\n[引](2026-09-02-target.md#nope)",
    );
    const result = await run({ [PATH]: withLink, [TARGET]: base(SKELETON) });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("死锚 → 2026-09-02-target.md#nope");
  });

  afterAll(cleanup);
});
