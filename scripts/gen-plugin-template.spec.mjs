import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateName, renderTemplate } from "./gen-plugin-template.mjs";

test("validateName：小写/数字/连字符，禁大写点斜杠空", () => {
  expect(validateName("demo-hello")).toBe(true);
  expect(validateName("a")).toBe(true);
  expect(validateName("Demo")).toBe(false);
  expect(validateName("../evil")).toBe(false);
  expect(validateName("demo/hello")).toBe(false);
  expect(validateName("")).toBe(false);
});

test("renderTemplate：渲染字节钉死（契约漂移即红）", () => {
  const files = renderTemplate("demo-hello");
  expect(Object.keys(files).sort()).toEqual([
    "package.json",
    "scripts/check.mjs",
    "src/host.d.ts",
    "src/index.ts",
  ]);
  const pkg = JSON.parse(files["package.json"]);
  expect(pkg.name).toBe("demo-hello");
  expect(pkg.keywords).toContain("studywiki-plugin");
  expect(pkg.dependencies).toEqual({});
  expect(pkg.studywiki).toEqual({ apiVersion: 1, entry: "index.js" });
  expect(pkg.files).toEqual(["index.js"]);
  expect(pkg.scripts.prepublishOnly).toContain("build");
  expect(files["src/index.ts"]).toContain('export const name = "demo-hello";');
  // check.mjs 钉契约镜像断言的存在（防静默弱化）
  expect(files["scripts/check.mjs"]).toContain("studywiki-plugin");
  expect(files["scripts/check.mjs"]).toContain("npm pack");
});

test("check.mjs：好发布面过、三文件发布面拒（真实 npm pack --dry-run）", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sw-plugin-check-"));
  try {
    for (const [rel, content] of Object.entries(renderTemplate("demo-hello"))) {
      const t = path.join(dir, rel);
      mkdirSync(path.dirname(t), { recursive: true });
      writeFileSync(t, content);
    }
    writeFileSync(path.join(dir, "index.js"), "export const name='demo-hello';\n");
    const run = () =>
      execFileSync(process.execPath, [path.join(dir, "scripts", "check.mjs")], {
        cwd: dir,
        encoding: "utf8",
      });
    expect(run()).toContain("check: OK");
    writeFileSync(path.join(dir, "README.md"), "# hi\n");
    expect(() => run()).toThrow(/发布面/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
