// 门禁自测试：postmortem 结构——NNNN-主题 从 0001 连续不重复、四段标题
// 两侧逐字且顺序固定、README 不算事故件；四段清单与 docs/postmortem/README.md
// 互为镜像（改一处漏一处即红）。夹具机制见 spec-fixture.mjs。

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";
import { SECTIONS } from "./verify-postmortem.mjs";

const gate = createGateRunner("verify-postmortem.mjs", "postmortem");
afterAll(gate.cleanup);

/** 一篇四段齐全的合法事故件正文。 */
const BODY = (title) =>
  `# ${title}\n\n## Executive summary\n一段话。\n\n## Timeline\n证据。\n\n## Root cause\n机制。\n\n## Action items\n改动。\n`;

describe("verify-postmortem", () => {
  it("合法事故件（含英文侧）过检，README 不算事故件", async () => {
    const result = await gate.run({
      "docs/postmortem/README.md": "# 事故复盘\n",
      "docs/postmortem/README.en.md": "# Incident review\n",
      "docs/postmortem/0001-login-loop.md": BODY("登录循环"),
      "docs/postmortem/0001-login-loop.en.md": BODY("Login loop"),
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("1 篇事故件");
  });

  it("英文侧缺段也红", async () => {
    const en = BODY("Login loop").replace("## Root cause\n机制。\n\n", "");
    const result = await gate.run({
      "docs/postmortem/README.md": "# 事故复盘\n",
      "docs/postmortem/0001-login-loop.md": BODY("登录循环"),
      "docs/postmortem/0001-login-loop.en.md": en,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "docs/postmortem/0001-login-loop.en.md: 四段",
    );
    expect(result.errors.join("\n")).toContain("缺 Root cause");
  });

  it("段落顺序错即红", async () => {
    const swapped = BODY("登录循环").replace(
      "## Executive summary\n一段话。\n\n## Timeline\n证据。",
      "## Timeline\n证据。\n\n## Executive summary\n一段话。",
    );
    const result = await gate.run({
      "docs/postmortem/README.md": "# 事故复盘\n",
      "docs/postmortem/0001-login-loop.md": swapped,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("顺序不符");
  });

  it("编号跳号即红", async () => {
    const result = await gate.run({
      "docs/postmortem/README.md": "# 事故复盘\n",
      "docs/postmortem/0001-a.md": BODY("A"),
      "docs/postmortem/0003-b.md": BODY("B"),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("编号须从 0001 连续——缺 0002");
  });

  it("非 NNNN 文件名红", async () => {
    const result = await gate.run({
      "docs/postmortem/README.md": "# 事故复盘\n",
      "docs/postmortem/notes.md": BODY("随笔"),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("文件名须为 NNNN-主题.md");
  });
});

describe("SECTIONS ↔ README 互检", () => {
  it("四段清单与 README 固定结构逐项一致", async () => {
    const readme = await readFile("docs/postmortem/README.md", "utf8");
    const listed = [...readme.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)].map((m) => m[1]);
    expect(listed).toEqual(SECTIONS);
  });
});
