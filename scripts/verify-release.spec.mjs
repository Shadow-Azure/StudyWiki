// 门禁自测试：发布版本一致性——三处版本号必须相同，--tag 须与之相等。
// CLI 走子进程在临时 fixture 里跑（cwd 即仓库根），退出码即裁决。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/verify-release.mjs");
const dirs = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** 版本三件套 fixture；overrides 替换任一文件内容。 */
function fixture({ pkg = "0.1.0", conf = "0.1.0", cargo = "0.1.0" } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "studywiki-verify-release-"));
  dirs.push(dir);
  const files = {
    "package.json": `{"version": "${pkg}"}`,
    "src-tauri/tauri.conf.json": `{"version": "${conf}"}`,
    "src-tauri/Cargo.toml": `[package]\nname = "study-wiki"\nversion = "${cargo}"\n`,
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const run = (dir, args = []) =>
  execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });

describe("verify-release", () => {
  it("三处一致 → ok，无 tag 时只查内部一致", () => {
    const dir = fixture();
    expect(run(dir)).toContain("ok (v0.1.0)");
  });
  it("Cargo.toml 漂移 → 红，报漂移文件与差异", () => {
    const dir = fixture({ cargo: "0.2.0" });
    try {
      run(dir);
      expect.unreachable("应退出非零");
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("Cargo.toml");
      expect(error.stderr).toContain("0.2.0 != 0.1.0");
    }
  });
  it("--tag 与版本一致 → ok；不一致 → 红", () => {
    const dir = fixture();
    expect(run(dir, ["--tag", "v0.1.0"])).toContain("ok (v0.1.0 == v0.1.0)");
    try {
      run(dir, ["--tag", "v9.9.9"]);
      expect.unreachable("应退出非零");
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("tag");
    }
  });
});
