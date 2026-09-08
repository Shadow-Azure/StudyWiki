// 门禁自测试：注释即契约——TS 导出面必须有 JSDoc、函数形参须 @param、
// 非 void 返回须 @returns；Rust #[tauri::command] 上方须紧邻 ///。
// 夹具机制见 spec-fixture.mjs。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-export-docs.mjs", "export-docs");
afterAll(gate.cleanup);

describe("verify-export-docs", () => {
  it("契约齐全（含 Rust /// 与白名单外的导出常量）即过", async () => {
    const result = await gate.run({
      "src/ok.ts":
        "/**\n * Contract.\n * @param a - operand\n * @returns doubled\n */\nexport function twice(a: number): number {\n  return a * 2;\n}\n\n/** Version constant. */\nexport const version = 1;\n",
      "src-tauri/src/lib.rs":
        '/// Reads a file.\n#[tauri::command]\nfn read_file(path: String) -> Result<String, String> {\n    Ok(path)\n}\n',
    });
    expect(result.ok).toBe(true);
  });

  it("缺 JSDoc、缺 @param/@returns、Rust 命令缺 /// 分别报错", async () => {
    const result = await gate.run({
      "src/bare.ts": "export function bare(x: number): number {\n  return x;\n}\n",
      "src/partial.ts":
        "/** Documented but thin. */\nexport function partial(x: number): number {\n  return x;\n}\n",
      "src-tauri/src/lib.rs":
        '#[tauri::command]\nfn read_file(path: String) -> Result<String, String> {\n    Ok(path)\n}\n',
    });
    expect(result.ok).toBe(false);
    const joined = result.errors.join("\n");
    expect(joined).toContain("src/bare.ts: 导出 bare 缺 JSDoc");
    expect(joined).toContain("partial 的形参 x 缺 @param");
    expect(joined).toContain("partial 返回 number，缺 @returns");
    expect(joined).toContain("#[tauri::command] 上方须紧邻 /// 文档注释");
  });
});
