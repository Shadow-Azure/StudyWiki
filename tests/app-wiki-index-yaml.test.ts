import { describe, expect, it } from "vitest";
import {
  parseMachineIndex,
  serializeMachineIndex,
  type MachineIndex,
} from "../src/plugins/app-wiki/index-yaml";

const sample: MachineIndex = {
  version: 1,
  sources: [
    {
      path: "courses/rust/ownership.md",
      kind: "text",
      sha256: "ab".repeat(32),
      size: 123,
      analyzedAt: "2026-10-18T12:00:00+08:00",
      artifact: null,
    },
    {
      path: "courses/rust/borrow.mp4",
      kind: "video",
      sha256: "cd".repeat(32),
      size: 9_000_000,
      analyzedAt: "2026-10-18T13:00:00+08:00",
      artifact: ".study-wiki/raw/courses/rust/borrow",
    },
  ],
};

describe("machine index yaml 子集", () => {
  it("serialize/parse 恒等", () => {
    expect(parseMachineIndex(serializeMachineIndex(sample))).toEqual(sample);
  });

  it("字段齐全的单源最小文件", () => {
    const text = [
      "version: 1",
      "sources:",
      '  - path: "a.md"',
      "    kind: text",
      '    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"',
      "    size: 0",
      '    analyzedAt: "2026-10-18T00:00:00+08:00"',
      "    artifact: null",
      "",
    ].join("\n");
    expect(parseMachineIndex(text)).toEqual({
      version: 1,
      sources: [
        {
          path: "a.md",
          kind: "text",
          sha256:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          size: 0,
          analyzedAt: "2026-10-18T00:00:00+08:00",
          artifact: null,
        },
      ],
    });
  });

  it.each([
    ["version 缺失", 'sources:\n  - path: "a"\n'],
    ["version 非 1", "version: 2\nsources: []\n"],
    ["未知顶层键", "version: 1\nbogus: 1\nsources: []\n"],
    ["列表缩进错", 'version: 1\nsources:\n - path: "a"\n'],
    ["未知字段键", 'version: 1\nsources:\n  - path: "a"\nwat: 1\n'],
    ["未引号字符串", "version: 1\nsources:\n  - path: a.md\n"],
    ["kind 越界", 'version: 1\nsources:\n  - path: "a"\n    kind: doc\n'],
    ["size 非整数", 'version: 1\nsources:\n  - path: "a"\n    size: 1.5\n'],
  ])("损坏输入 → null：%s", (_name, text) => {
    expect(parseMachineIndex(text)).toBeNull();
  });

  it("空 sources 合法", () => {
    expect(parseMachineIndex("version: 1\nsources: []\n")).toEqual({
      version: 1,
      sources: [],
    });
    expect(parseMachineIndex("version: 1\nsources:\n")).toEqual({
      version: 1,
      sources: [],
    });
  });
});
