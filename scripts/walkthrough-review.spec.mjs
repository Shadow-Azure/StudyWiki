// 检视 diff 数据层自测试：numstat 解析、hunk 行号推进、注解归位、真实 git 夹具。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { collectReviewDiff, hunkForRange, parseUnifiedDiff } from "./walkthrough-review.mjs";

const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const SAMPLE = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -2,5 +2,6 @@
 ctx
-del
+add1
+add2
 ctx2
@@ -20,2 +22,3 @@
 ctxA
-delB
+addB
`;

describe("walkthrough-review 数据层", () => {
  it("解析统一 diff：行号与增删分类", () => {
    const hunks = parseUnifiedDiff(SAMPLE);
    expect(hunks).toHaveLength(2);
    const [h1, h2] = hunks;
    expect(h1.newStart).toBe(2);
    expect(h1.lines.map((l) => l.type)).toEqual(["ctx", "del", "add", "add", "ctx"]);
    expect(h1.lines[1].oldNo).toBe(3); // del 行取 before 行号
    expect(h1.lines[2].newNo).toBe(3); // 第一行 add 的 after 行号
    expect(h1.lines[3].newNo).toBe(4);
    expect(h2.oldStart).toBe(20);
    expect(h2.newStart).toBe(22);
  });

  it("注解按 after 行区间归位到所属 hunk", () => {
    const hunks = parseUnifiedDiff(SAMPLE);
    expect(hunkForRange(hunks, { start: 3, end: 4 })).toBe(0);
    expect(hunkForRange(hunks, { start: 100, end: 101 })).toBe(-1);
  });

  it("真实 git 夹具：collectReviewDiff 采集文件状态与 hunks", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sw-review-"));
    dirs.push(root);
    const git = (argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" });
    git(["init", "-q", "-b", "main"]);
    writeFileSync(path.join(root, "a.ts"), "line1\nline2\nline3\n");
    git(["add", "."]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"]);
    writeFileSync(path.join(root, "a.ts"), "line1\nline2-changed\nline3\nline4\n");
    writeFileSync(path.join(root, "b.ts"), "new file\n");
    git(["add", "."]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "work"]);
    const diff = collectReviewDiff(root, "HEAD~1");
    const a = diff.files.find((f) => f.path === "a.ts");
    const b = diff.files.find((f) => f.path === "b.ts");
    expect(a.status).toBe("M");
    expect(b.status).toBe("A");
    expect(a.hunks[0].lines.some((l) => l.type === "add" && l.text === "line2-changed")).toBe(true);
    expect(a.hunks[0].lines.some((l) => l.type === "del" && l.text === "line2")).toBe(true);
  });
});
