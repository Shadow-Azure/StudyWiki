import { expect, test } from "vitest";
import { scanPluginSource, scanLoadingSeams } from "./verify-layering.mjs";

test("插件层: @tauri-apps 值导入红、type 导入放行", () => {
  expect(scanPluginSource("src/plugins/a/index.ts", `import { invoke } from "@tauri-apps/api/core";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `import type { Foo } from "@tauri-apps/api/core";`).length).toBe(0);
});

test("插件层: host 值导入红、type 导入放行", () => {
  expect(scanPluginSource("src/plugins/a/index.ts", `import { FilesService } from "../../host/files";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `import type { FilesService } from "../../host/files";`).length).toBe(0);
});

test("装载缝: 动态 import / eval / new Function 红；白名单文件放行", () => {
  expect(scanLoadingSeams("src/x.ts", `const m = await import("./y");`, []).length).toBe(1);
  expect(scanLoadingSeams("src/x.ts", `eval(code);`, []).length).toBe(1);
  expect(scanLoadingSeams("src/x.ts", `new Function("return 1");`, []).length).toBe(1);
  expect(scanLoadingSeams("src/allowed.ts", `const m = await import("./y");`, ["src/allowed.ts"]).length).toBe(0);
  // 注释里的词不算（粗剪枝后仍以整词匹配）
  expect(scanLoadingSeams("src/x.ts", `// we do not use import( here`, []).length).toBe(0);
});

test("插件层: 副作用导入与转口导出同样红；type 转口放行", () => {
  expect(scanPluginSource("src/plugins/a/index.ts", `import "@tauri-apps/api/core";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `export { invoke } from "@tauri-apps/api/core";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `export * from "@tauri-apps/api/core";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `import "../../host/files";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `export { readTree } from "../../host/files";`).length).toBe(1);
  // type 转口编译期擦除，与 import type 同等放行
  expect(scanPluginSource("src/plugins/a/index.ts", `export type { Foo } from "@tauri-apps/api/core";`).length).toBe(0);
  expect(scanPluginSource("src/plugins/a/index.ts", `export type * from "../../host/types";`).length).toBe(0);
  // 不误伤普通语句（from 作属性、import 作标识符片段）
  expect(scanPluginSource("src/plugins/a/index.ts", `const steps = { from: (x) => x };\nsteps.from("@tauri-apps/api/core");`).length).toBe(0);
  expect(scanPluginSource("src/plugins/a/index.ts", `export const from = "a";`).length).toBe(0);
});
