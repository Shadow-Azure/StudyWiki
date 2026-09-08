// 门禁自测试：文档 ts 围栏真实编译——诊断行号映射回 markdown 源、
// 豁免率超半即红、rust 围栏不在此列。夹具机制见 spec-fixture.mjs。
// 围栏起始行号：fixture 里 docs/ex.md 的第 1 行是标题、第 2 行空、第 3 行开栏。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("doc-typecheck.mjs", "doc-typecheck");
afterAll(gate.cleanup);

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", noEmit: true },
});

describe("doc-typecheck", () => {
  it("可编译围栏过检，rust 围栏不参与", async () => {
    const result = await gate.run({
      "tsconfig.json": TSCONFIG,
      "README.md": "# R\n",
      "docs/ex.md": "# Ex\n\n```ts\nconst answer: number = 42;\n```\n\n```rust\nfn main() {}\n```\n",
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("1 个 ts 围栏编译通过");
  });

  it("类型错误映射回 markdown 围栏行号", async () => {
    const result = await gate.run({
      "tsconfig.json": TSCONFIG,
      "README.md": "# R\n",
      "docs/ex.md": '# Ex\n\n```ts\nconst bad: number = "no";\n```\n',
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("docs/ex.md（第 3 行围栏）");
  });

  it("豁免围栏过半即红", async () => {
    const result = await gate.run({
      "tsconfig.json": TSCONFIG,
      "README.md": "# R\n",
      "docs/ex.md":
        "# Ex\n\n```ts\nconst a: number = 1;\n```\n\n```ts\nconst b: number = 2;\n```\n\n```ts ignore-check\nconst c = 3;\n```\n\n```ts ignore-check\nconst d = 4;\n```\n\n```ts ignore-check\nconst e = 5;\n```\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("豁免围栏过多（3/5）");
  });
});
