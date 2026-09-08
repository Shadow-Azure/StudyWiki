// 门禁自测试：归档助手端到端——三件套整体冻结、Status 改 archived、
// sha256 记入 append-only manifest；非 implemented 路径拒绝。CLI 走子进程
// 在临时 fixture 里跑（cwd 即仓库根）。

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/archive-agent-note.mjs");
const dirs = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "studywiki-archive-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "docs"), { recursive: true }); // 归档助手扫 docs/ 与 README.md
  writeFileSync(path.join(dir, "README.md"), "# R\n");
  const trio = "2026-01-01-x";
  const notesDir = path.join(dir, ".agents/notes/implemented/process");
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(
    path.join(notesDir, `${trio}.md`),
    `# Agent Note: 测试归档\n\nStatus: implemented\n\n## Problem\np\n`,
  );
  writeFileSync(
    path.join(notesDir, `${trio}.en.md`),
    `# Agent Note: Test archive\n\nStatus: implemented\n\n## Problem\np\n`,
  );
  writeFileSync(path.join(notesDir, `${trio}.i18n.yaml`), "x: y\n");
  return { dir, trio };
}

const run = (dir, arg) =>
  spawnSync(process.execPath, [SCRIPT, arg], { cwd: dir, encoding: "utf8" });

describe("archive-agent-note", () => {
  it("三件套冻结入 archived，Status 改写，manifest 记 sha256", () => {
    const { dir, trio } = fixture();
    const result = run(dir, `.agents/notes/implemented/process/${trio}.md`);
    expect(result.status).toBe(0);

    const manifest = JSON.parse(
      readFileSync(path.join(dir, ".agents/notes/archived/manifest.json"), "utf8"),
    );
    const expected = [
      ".agents/notes/archived/process/2026-01-01-x.md",
      ".agents/notes/archived/process/2026-01-01-x.en.md",
      ".agents/notes/archived/process/2026-01-01-x.i18n.yaml",
    ];
    expect(Object.keys(manifest.entries).sort()).toEqual([...expected].sort());
    for (const rel of expected) {
      expect(manifest.entries[rel]).toMatch(/^[0-9a-f]{64}$/);
      const frozen = readFileSync(path.join(dir, rel));
      expect(manifest.entries[rel]).toBe(createHash("sha256").update(frozen).digest("hex"));
      expect(existsSync(path.join(dir, rel))).toBe(true);
    }
    expect(existsSync(path.join(dir, `.agents/notes/implemented/process/${trio}.md`))).toBe(false);

    const base = readFileSync(path.join(dir, expected[0]), "utf8").split("\n");
    expect(base[2]).toBe("Status: archived");
    const en = readFileSync(path.join(dir, expected[1]), "utf8").split("\n");
    expect(en[2]).toBe("Status: archived");
  });

  it("重复归档（源已移走）非零退出；非 implemented 路径拒绝", () => {
    const { dir, trio } = fixture();
    expect(run(dir, `.agents/notes/implemented/process/${trio}.md`).status).toBe(0);
    const again = run(dir, `.agents/notes/implemented/process/${trio}.md`);
    expect(again.status).not.toBe(0);

    const proposed = run(dir, ".agents/notes/proposed/feature/2026-01-01-y.md");
    expect(proposed.status).toBe(2);
    expect(proposed.stderr).toContain("只归档 implemented note");
  });
});
