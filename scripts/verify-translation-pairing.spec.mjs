// 门禁自测试：配对 CLI 编排层（纯逻辑层归 translation-pairing-lib.spec）——
// 语料发现、三件套完整性、hash 对账、切换行、链接 locale、豁免件的携带检查。
// 夹具走 createGateRunner：default() 无参 = 全库检查，cwd 即临时语料根。

import { afterAll, describe, expect, it } from "vitest";
import { blobHash, renderPairRecord } from "./translation-pairing-lib.mjs";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-translation-pairing.mjs", "pairing-cli");
afterAll(gate.cleanup);

const PATHS = { base: "docs/foo.md", en: "docs/foo.en.md", meta: "docs/foo.i18n.yaml" };
const MANIFEST = JSON.stringify({ excluded: [] });

/** 三件套内容：切换行严格精确；meta 由两侧内容实算（重录语义）。 */
function trio(baseBody, enBody, { stale } = {}) {
  const base = `# 文\n\n[English](foo.en.md) | 中文\n\n${baseBody}`;
  const en = `# Doc\n\nEnglish | [中文](foo.md)\n\n${enBody}`;
  const meta = renderPairRecord(PATHS, {
    baseHash: blobHash(stale ?? base),
    enHash: blobHash(stale ?? en),
  });
  return { [PATHS.base]: base, [PATHS.en]: en, [PATHS.meta]: meta };
}

describe("verify-translation-pairing（CLI 编排）", () => {
  it("完整一致的三件套 → 全过", async () => {
    const result = await gate.run({ ...trio("正文。", "Body."), "scripts/translation-pairing.manifest.json": MANIFEST });
    expect(result.ok).toBe(true);
  });

  it("改一侧未重录 → 红，指明与记录不符", async () => {
    const files = trio("正文。", "Body.");
    const drifted = { ...files, [PATHS.base]: files[PATHS.base].replace("正文", "改过的正文") };
    const result = await gate.run({ ...drifted, "scripts/translation-pairing.manifest.json": MANIFEST });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("最后确认状态不符");
  });

  it("缺英文侧 → 红，报必须双语成对", async () => {
    const result = await gate.run({
      [PATHS.base]: "# 文\n",
      "scripts/translation-pairing.manifest.json": MANIFEST,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("必须双语成对");
  });

  it("en 侧链接指 .md → locale 违规（两侧镜像结构仍需一致）", async () => {
    const files = trio("见 [a](bar.md)。", "See [a](bar.md)。");
    const result = await gate.run({ ...files, "scripts/translation-pairing.manifest.json": MANIFEST });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("应指向英文侧 bar.en.md");
  });

  it("行内代码与围栏里的链接是示例（如 i18n README 引用切换行原文）→ 不违规", async () => {
    const files = trio(
      "示例 `[English](foo.en.md) | 中文`。\n\n```md\n[English](bar.en.md) | 中文\n```\n",
      "Example `[English](foo.en.md) | 中文`.\n\n```md\n[English](bar.en.md) | 中文\n```\n",
    );
    const result = await gate.run({ ...files, "scripts/translation-pairing.manifest.json": MANIFEST });
    expect(result.ok).toBe(true);
  });

  it("切换行形状不精确 → 红（重录后 hash 对账通过，切换行检查独立暴露）", async () => {
    const files = trio("正文。", "Body.");
    const brokenEn = files[PATHS.en].replace("English | [中文](foo.md)", "English | [中文](foo.md) ");
    const rerecorded = {
      ...files,
      [PATHS.en]: brokenEn,
      [PATHS.meta]: renderPairRecord(PATHS, { baseHash: blobHash(files[PATHS.base]), enHash: blobHash(brokenEn) }),
    };
    const result = await gate.run({ ...rerecorded, "scripts/translation-pairing.manifest.json": MANIFEST });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("缺语言切换行");
  });

  it("豁免件携带英文侧 → 红", async () => {
    const files = trio("正文。", "Body.");
    const result = await gate.run({
      [PATHS.base]: files[PATHS.base],
      [PATHS.en]: files[PATHS.en],
      "scripts/translation-pairing.manifest.json": JSON.stringify({ excluded: [PATHS.base] }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("已豁免配对，英文侧必须不存在");
  });
});
