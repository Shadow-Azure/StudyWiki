// 门禁自测试：自测覆盖对账——scripts/ 下每个门禁/工具脚本必须有同名 spec，
// 或在覆盖映射表里显式登记由哪个 spec 覆盖（登记的 spec 必须真实存在）。
// "每个门禁有自测试"这条不变量如果自己没有门禁背书，新增无 spec 的门禁
// 不会惊动任何检查（meta-guards note 宣称的全叶覆盖就是这么失守的）。

import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 非同名覆盖的登记：脚本 → 覆盖它的 spec 文件（须真实存在，防映射表腐烂）。 */
const COVERED_BY = {
  "run-gates.mjs": ["ci-wiring.spec.mjs"], // 模式组合与接线（LEAVES/MODES）
  "install-merge-driver.mjs": ["install-git-hooks.spec.mjs"], // registerMergeDriver 的 .git/config 断言
  "verify-translation-pairing.mjs": [
    "translation-pairing-lib.spec.mjs", // 纯逻辑层
    "verify-translation-pairing.spec.mjs", // CLI 编排（checkPair/切换行/locale/发现）
  ],
};

/** 测试基建，不是门禁。 */
const NOT_GATES = new Set(["spec-fixture.mjs"]);

const scriptFiles = readdirSync(SCRIPTS_DIR).filter(
  (name) => name.endsWith(".mjs") && !name.endsWith(".spec.mjs"),
);

describe("门禁自测覆盖对账", () => {
  it("每个脚本都有 spec（同名，或映射表登记）", () => {
    const missing = scriptFiles.filter(
      (name) =>
        !NOT_GATES.has(name) &&
        !COVERED_BY[name] &&
        !existsSync(path.join(SCRIPTS_DIR, name.replace(/\.mjs$/, ".spec.mjs"))),
    );
    expect(missing, `无自测试的脚本：${missing.join("、")}——补同名 spec，或进 COVERED_BY 显式登记`).toEqual([]);
  });

  it("映射表登记的脚本与 spec 都真实存在", () => {
    for (const [script, specs] of Object.entries(COVERED_BY)) {
      expect(scriptFiles, `映射表登记了 ${script}，但该脚本不存在`).toContain(script);
      for (const spec of specs)
        expect(existsSync(path.join(SCRIPTS_DIR, spec)), `${script} 登记的 ${spec} 不存在`).toBe(true);
    }
  });
});
