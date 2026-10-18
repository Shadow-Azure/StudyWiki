import { describe, expect, it } from "vitest";
import { classifySource, createProbeCache, reconcileIndex, type MachineIndex } from "../src/plugins/app-wiki/state";
import type { ProbeSample } from "../src/host/files";

const rec = (path: string, sha256 = "aa".repeat(32), artifact: string | null = null) =>
  ({ path, kind: "text" as const, sha256, size: 10, analyzedAt: "2026-10-18T12:00:00+08:00", artifact });

const sample = (sha256 = "aa".repeat(32), mtimeMs = 1000): ProbeSample =>
  ({ size: 10, mtimeMs, sha256 });

describe("classifySource 判定序", () => {
  const index: MachineIndex = { version: 1, sources: [rec("a.md"), rec("old/b.md", "bb".repeat(32))] };

  it("path 命中且 sha256 一致 → fresh", () => {
    expect(classifySource(index, "a.md", sample())).toEqual({ state: "fresh", record: rec("a.md") });
  });

  it("path 命中 sha256 不一致 → stale", () => {
    const s = sample("cc".repeat(32));
    expect(classifySource(index, "a.md", s)).toEqual({ state: "stale", record: rec("a.md"), sample: s });
  });

  it("path 未命中、sha256 反查命中 → moved", () => {
    const s = sample("bb".repeat(32));
    expect(classifySource(index, "new/b.md", s)).toEqual({ state: "moved", record: rec("old/b.md", "bb".repeat(32)), sample: s });
  });

  it("均未命中 → unknown；索引 null 同", () => {
    expect(classifySource(index, "x.md", sample("cc".repeat(32)))).toEqual({ state: "unknown" });
    expect(classifySource(null, "x.md", sample())).toEqual({ state: "unknown" });
  });
});

describe("probeCache", () => {
  it("size+mtimeMs 命中返回缓存 sha256；失配更新", () => {
    const cache = createProbeCache();
    const first = cache.get("/lib/a.md", sample("aa".repeat(32), 1000));
    expect(first.sha256).toBe("aa".repeat(32));
    // 调用方（probe 命令快路径）已保证元数据一致，这里直接给同 mtime 新样本：
    expect(cache.get("/lib/a.md", { size: 10, mtimeMs: 1000, sha256: "ignored" }).sha256).toBe("aa".repeat(32));
    expect(cache.get("/lib/a.md", { size: 10, mtimeMs: 2000, sha256: "dd".repeat(32) }).sha256).toBe("dd".repeat(32));
    cache.invalidate();
    expect(cache.get("/lib/a.md", { size: 10, mtimeMs: 2000, sha256: "ee".repeat(32) }).sha256).toBe("ee".repeat(32));
  });
});

describe("reconcileIndex", () => {
  it("证据存在的源才有行；analyzedAt 取产物最新 mtime", () => {
    const iso = new Date(5000).toISOString();
    const out = reconcileIndex(null, [{ source: "a.md", newestArtifactMtimeMs: 5000 }],
      new Map([["a.md", sample()]]));
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({ path: "a.md", sha256: "aa".repeat(32), analyzedAt: iso });
    expect(out.sources[0].artifact).toBeNull();
  });

  it("证据消失的行被丢弃（产物即真值）", () => {
    const prev: MachineIndex = { version: 1, sources: [rec("gone.md")] };
    expect(reconcileIndex(prev, [], new Map()).sources).toEqual([]);
  });

  it("moved：证据路径与旧行不同且 sha256 同 → 保留 artifact 只改 path", () => {
    const prev: MachineIndex = { version: 1, sources: [{ ...rec("old/b.md", "bb".repeat(32)), artifact: ".study-wiki/raw/old/b" }] };
    const out = reconcileIndex(prev, [{ source: "new/b.md", newestArtifactMtimeMs: 9000 }],
      new Map([["new/b.md", sample("bb".repeat(32))]]));
    expect(out.sources[0].path).toBe("new/b.md");
    expect(out.sources[0].artifact).toBe(".study-wiki/raw/old/b");
    expect(out.sources[0].sha256).toBe("bb".repeat(32));
  });
});
