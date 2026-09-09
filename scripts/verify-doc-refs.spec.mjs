// 门禁自测试：源码文档引用防腐——scripts/*.mjs（*.spec.mjs 除外）、
// src/**/*.ts、src-tauri/src/**/*.rs 全文里的 docs/**\/*.md 与
// .agents/notes/**\/*.md 路径引用，目标必须存在；行内代码与围栏里是示例，
// 不算数。夹具走 createGateRunner：cwd 即临时仓库根。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-doc-refs.mjs", "doc-refs");
afterAll(gate.cleanup);

describe("verify-doc-refs（源码引用防腐）", () => {
  it("三类源码注释引用存在的文档 → 绿", async () => {
    const result = await gate.run({
      "docs/architecture.md": "# 架构\n",
      ".agents/notes/README.md": "# Agent Notes\n",
      "scripts/gate.mjs": "// 契约 home：docs/architecture.md\n",
      "src/main.ts": "// 入口，见 docs/architecture.md\nexport {};\n",
      "src-tauri/src/lib.rs": "//! 规则见 .agents/notes/README.md\n",
    });
    expect(result.ok).toBe(true);
  });

  it("scripts 注释引用不存在的 docs 路径 → 红（报文件:行号与目标）", async () => {
    const result = await gate.run({
      "scripts/reader.mjs": "#!/usr/bin/env node\n// 契约见 docs/i18n/README.md\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("scripts/reader.mjs:2");
    expect(result.errors.join("\n")).toContain("docs/i18n/README.md");
  });

  it("Rust 注释引用不存在的 .agents/notes 路径 → 红", async () => {
    const result = await gate.run({
      "src-tauri/src/lib.rs": "// 规则 home：.agents/notes/README.md\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(".agents/notes/README.md");
  });

  it("字符串字面量里的引用同样算（运行时路径也会腐烂）", async () => {
    const result = await gate.run({
      "src/paths.ts": 'const docHome = "docs/gone.md";\nexport {};\n',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("docs/gone.md");
  });

  it("行内代码与围栏里是示例（用法行、围栏块）→ 不算", async () => {
    const result = await gate.run({
      "scripts/gate.mjs":
        "// 用法：pnpm record:i18n -- `docs/foo.md` 重录\n" +
        "// 示例：\n" +
        "// ```md\n" +
        "// [x](docs/bar.md)\n" +
        "// ```\n",
    });
    expect(result.ok).toBe(true);
  });

  it("*.spec.mjs 不在扫描面（夹具全是合成路径）", async () => {
    const result = await gate.run({
      "scripts/synth.spec.mjs": '// 夹具引用 docs/made-up/example.md\n',
    });
    expect(result.ok).toBe(true);
  });
});
