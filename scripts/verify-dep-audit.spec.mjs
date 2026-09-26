import { expect, test } from "vitest";
import { auditDependencies } from "./verify-dep-audit.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__/dep-audit", n);

test("clean fixture 通过", () => {
  const r = auditDependencies(
    { dependencies: { sample: "1.0.0" } },
    ["sample"],
    fx("clean/node_modules"),
  );
  expect(r.errors).toEqual([]);
});

test("dirty fixture: 未登记依赖 + node: 引用点名", () => {
  const r = auditDependencies(
    { dependencies: { sample: "1.0.0", sneaky: "2.0.0" } },
    ["sample"],
    fx("dirty/node_modules"),
  );
  expect(r.errors.some((e) => e.includes("sneaky") && e.includes("未登记"))).toBe(true);
  expect(r.errors.some((e) => e.includes("node:fs") && e.includes("sample"))).toBe(true);
});

test("白名单过期（登记未用）也红", () => {
  const r = auditDependencies({ dependencies: {} }, ["sample"], fx("clean/node_modules"));
  expect(r.errors.some((e) => e.includes("过期"))).toBe(true);
});

test("nodeRefExempt 按包内相对路径豁免：命中文件放行，同表下非豁免文件仍红", () => {
  const r = auditDependencies(
    { dependencies: { sample: "1.0.0", sneaky: "2.0.0" } },
    ["sample"],
    fx("dirty/node_modules"),
    { sample: ["index.js"] },
  );
  expect(r.errors.some((e) => e.includes("sample/index.js"))).toBe(false); // 豁免文件放行
  expect(r.errors.some((e) => e.includes("sample/other.js") && e.includes("node:path"))).toBe(true); // 非豁免命中仍红（防退化成包级豁免）
  expect(r.errors.some((e) => e.includes("sneaky") && e.includes("未登记"))).toBe(true); // 白名单检查不受影响
});

test("裸内建引用：无 browser 字段即红（require/from 两种形态都点名）", () => {
  const r = auditDependencies({ dependencies: { plain: "1.0.0" } }, ["plain"], fx("bare/node_modules"));
  expect(r.errors.some((e) => e.includes("plain/index.js") && e.includes('require("fs")'))).toBe(true);
  expect(r.errors.some((e) => e.includes("plain/index.js") && e.includes('from "util"'))).toBe(true);
});

test("裸内建引用：browser string 改道包——node 入口跳过，browser 入口自身仍红", () => {
  const r = auditDependencies({ dependencies: { redirected: "1.0.0" } }, ["redirected"], fx("bare/node_modules"));
  expect(r.errors.some((e) => e.includes("redirected/node.js"))).toBe(false); // 改道包的 node 入口不进产物
  expect(r.errors.some((e) => e.includes("redirected/browser.js") && e.includes('require("os")'))).toBe(true); // 入口自身会进产物
});

test("裸内建引用：browser object 映射整包豁免", () => {
  const r = auditDependencies({ dependencies: { mapped: "1.0.0" } }, ["mapped"], fx("bare/node_modules"));
  expect(r.errors).toEqual([]);
});
