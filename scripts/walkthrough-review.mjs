// PR 检视的 diff 数据层：collectReviewDiff 采集 base...HEAD 的 per-file 统一 diff
// （numstat + hunk 解析），只产数据不产 HTML；渲染归 build-walkthrough.mjs。
// before 片段来自 base 版本（PR 检视期基线必存在），本模块不持久化任何内容。

import { execFileSync } from "node:child_process";

/**
 * 统一 diff 的一行：type 为 ctx/add/del；newNo 为 after 侧行号（del 行为 null）。
 * @typedef {{type: "ctx"|"add"|"del", text: string, oldNo: number|null, newNo: number|null}} DiffLine
 */

/**
 * 采集并解析 base...HEAD 的 diff。
 * @param {string} root 仓库根
 * @param {string} base 基线 ref
 * @param {object} [deps] exec 注入缝（测试用）
 * @returns {{files: Array<{path: string, status: "A"|"M"|"D", additions: number, deletions: number, hunks: Array<{oldStart: number, newStart: number, lines: DiffLine[]}>}>}}
 */
export function collectReviewDiff(root, base, deps = {}) {
  const exec = deps.exec ?? ((argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }));
  const numstat = exec(["diff", "--numstat", `${base}...HEAD`])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [a, d, ...rest] = line.split("\t");
      return { path: rest.join("\t"), additions: Number(a), deletions: Number(d) };
    });
  const statuses = new Map(
    exec(["diff", "--name-status", `${base}...HEAD`])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        return [rest.join("\t"), status];
      }),
  );
  return {
    files: numstat.map((row) => ({
      ...row,
      status: statuses.get(row.path) === "A" ? "A" : statuses.get(row.path) === "D" ? "D" : "M",
      hunks: parseUnifiedDiff(exec(["diff", "--unified=3", `${base}...HEAD`, "--", row.path])),
    })),
  };
}

/**
 * 解析统一 diff 文本为 hunk 数组（行号按 @@ 头推进）。
 * @param {string} diffText
 * @returns {Array<{oldStart: number, newStart: number, lines: DiffLine[]}>}
 */
export function parseUnifiedDiff(diffText) {
  const hunks = [];
  for (const line of diffText.split("\n")) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (head) {
      hunks.push({ oldStart: Number(head[1]), newStart: Number(head[2]), lines: [] });
      continue;
    }
    const hunk = hunks[hunks.length - 1];
    if (!hunk) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ type: "add", text: line.slice(1), oldNo: null, newNo: nextNew(hunk) });
    } else if (line.startsWith("-")) {
      hunk.lines.push({ type: "del", text: line.slice(1), oldNo: nextOld(hunk), newNo: null });
    } else if (line.startsWith(" ") || line === "") {
      hunk.lines.push({ type: "ctx", text: line.slice(1), oldNo: nextOld(hunk), newNo: nextNew(hunk) });
    }
  }
  return hunks.filter((hunk) => hunk.lines.some((l) => l.type !== "ctx"));
}

/** after 侧下一行号。 */
function nextNew(hunk) {
  return hunk.newStart + hunk.lines.filter((l) => l.type !== "del").length;
}

/** before 侧下一行号。 */
function nextOld(hunk) {
  return hunk.oldStart + hunk.lines.filter((l) => l.type !== "add").length;
}

/**
 * 把变更注解挂到 hunk：注解锚定的 after 行区间与 hunk 的 add/ctx 行区间相交即归属。
 * @param {Array<{oldStart, newStart, lines: DiffLine[]}>} hunks
 * @param {{start: number, end: number}} range 注解锚定的 after 行区间（1-based）
 * @returns {number} 归属 hunk 下标，不相交时返回 -1
 */
export function hunkForRange(hunks, range) {
  return hunks.findIndex((hunk) => hunk.lines.some((l) => l.newNo !== null && l.newNo >= range.start && l.newNo <= range.end));
}
