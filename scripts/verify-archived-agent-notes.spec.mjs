// 门禁自测试：归档冻结清单解析与三件套分组（纯逻辑层）。

import { describe, expect, it } from "vitest";
import { groupTriplets, parseArchivedManifest } from "./verify-archived-agent-notes.mjs";

const HASH = "a".repeat(64);

describe("parseArchivedManifest", () => {
  it("合法清单解析为 path → sha256", () => {
    const manifest = parseArchivedManifest(
      JSON.stringify({ "//": "c", entries: { ".agents/notes/archived/process/x.md": HASH } }),
    );
    expect(manifest.entries).toEqual({ ".agents/notes/archived/process/x.md": HASH });
  });
  it("只允许 entries 与 // 键；hash 须 64 位十六进制", () => {
    expect(() => parseArchivedManifest("[]")).toThrow(/顶层/);
    expect(() => parseArchivedManifest('{"foo": 1}')).toThrow(/不支持/);
    expect(() => parseArchivedManifest('{"entries": []}')).toThrow(/entries/);
    expect(() => parseArchivedManifest(`{"entries": {"a.md": "${"z".repeat(63)}"}}`)).toThrow(/64 位/);
  });
});

describe("groupTriplets", () => {
  it("完整三件套分组成功", () => {
    const { triplets, errors } = groupTriplets([
      "process/2026-01-01-x.md",
      "process/2026-01-01-x.en.md",
      "process/2026-01-01-x.i18n.yaml",
    ]);
    expect(errors).toEqual([]);
    expect(triplets).toEqual([
      {
        base: "process/2026-01-01-x.md",
        en: "process/2026-01-01-x.en.md",
        meta: "process/2026-01-01-x.i18n.yaml",
      },
    ]);
  });
  it("缺件报缺什么", () => {
    const { errors } = groupTriplets(["process/2026-01-01-x.md"]);
    expect(errors[0]).toContain("缺 en/meta");
  });
  it("非法路径形状逐项报错", () => {
    const { errors } = groupTriplets([
      "process/2026-01-01-x.en.md", // 孤儿英文侧（无 base）
      "nope/2026-01-01-x.md", // 非法 class
      "process/2026-01-01-x.txt", // 非三件套工件
      "process/nested/2026-01-01-x.md", // 层级过深
      "process/bad-stem.md", // 词干缺日期
    ]);
    expect(errors).toHaveLength(5);
  });
});
