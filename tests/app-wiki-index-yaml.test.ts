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

  it("完整记录中的无效字符串 → null", () => {
    const indexText = (path: string) =>
      [
        "version: 1",
        "sources:",
        `  - path: ${path}`,
        "    kind: text",
        '    sha256: "ab".repeat(32)',
        "    size: 0",
        '    analyzedAt: "2026-10-18T00:00:00+08:00"',
        "    artifact: null",
      ].join("\n");

    expect(parseMachineIndex(indexText("a.md"))).toBeNull();
    expect(parseMachineIndex(indexText('"a.md'))).toBeNull();
    expect(parseMachineIndex(indexText('"a\\\\q.md"'))).toBeNull();
    expect(parseMachineIndex(indexText('""a.md""'))).toBeNull();
  });

  it.each([
    ["超过安全整数", `${Number.MAX_SAFE_INTEGER + 2}`],
    ["溢出为 Infinity", "9".repeat(400)],
  ])("完整记录的 size 溢出 → null：%s", (_name, size) => {
    const text = [
      "version: 1",
      "sources:",
      '  - path: "a.md"',
      "    kind: text",
      '    sha256: "ab".repeat(32)',
      `    size: ${size}`,
      '    analyzedAt: "2026-10-18T00:00:00+08:00"',
      "    artifact: null",
    ].join("\n");
    expect(parseMachineIndex(text)).toBeNull();
  });

  it("CRLF 拒收", () => {
    expect(parseMachineIndex("version: 1\r\nsources: []\r\n")).toBeNull();
    expect(parseMachineIndex("version: 1\nsources: []\n\r\n")).toBeNull();
  });

  it("转义与数值边界 round-trip", () => {
    const bounded: MachineIndex = {
      version: 1,
      sources: [
        {
          path: 'a\\b"c.md',
          kind: "text",
          sha256: "ab".repeat(32),
          size: Number.MAX_SAFE_INTEGER,
          analyzedAt: "2026-10-18T00:00:00+08:00",
          artifact: 'a\\b"c',
        },
      ],
    };
    expect(parseMachineIndex(serializeMachineIndex(bounded))).toEqual(bounded);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["负数", -1],
    ["非整数", 1.5],
  ])("不可表示 size 序列化抛错：%s", (_name, size) => {
    const invalid = {
      ...sample,
      sources: [{ ...sample.sources[0], size }],
    };
    expect(() => serializeMachineIndex(invalid as MachineIndex)).toThrow();
  });

  it.each([
    ["path 含 LF", "a\nb", "artifact"],
    ["path 含 CR", "a\rb", "artifact"],
    ["artifact 含 LF", "artifact", "a\nb"],
  ])("不可表示字符串序列化抛错：%s", (_name, path, artifact) => {
    const invalid = {
      ...sample,
      sources: [{ ...sample.sources[0], path, artifact }],
    };
    expect(() => serializeMachineIndex(invalid as MachineIndex)).toThrow();
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
