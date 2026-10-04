import { describe, expect, it } from "vitest";
import { FilesService } from "../src/host/files";

function filesWith(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  return new FilesService({ invoke, listen: async () => () => {}, openDialog: async () => null, assetUrl: (p) => p });
}

describe("files agent facades", () => {
  it("grepFiles 命令名与参数形状", async () => {
    let seen: [string, unknown] | undefined;
    const f = filesWith(async (cmd, args) => { seen = [cmd, args]; return { matches: [], truncated: false }; });
    await f.grepFiles({ pattern: "p", path: "/lib", limit: 50 });
    expect(seen).toEqual(["grep_files", { req: { pattern: "p", path: "/lib", limit: 50 } }]);
  });

  it("grepFiles 的 coded 错误原样透传", async () => {
    const f = filesWith(async () => { throw { code: "SEARCH_INVALID_PATTERN", message: "bad regex" }; });
    await expect(f.grepFiles({ pattern: "(", path: "/lib" }))
      .rejects.toEqual({ code: "SEARCH_INVALID_PATTERN", message: "bad regex" });
  });

  it("authorizeReadPath / appendSessionEvent / deleteSessionFile 命令名与参数", async () => {
    const calls: [string, unknown][] = [];
    const f = filesWith(async (cmd, args) => { calls.push([cmd, args]); });
    await f.authorizeReadPath("/outside/a.md");
    await f.appendSessionEvent("/lib/.study-wiki/sessions/s1.jsonl", "{\"type\":\"x\"}");
    await f.deleteSessionFile("/lib/.study-wiki/sessions/s1.jsonl");
    expect(calls).toEqual([
      ["authorize_read_path", { path: "/outside/a.md" }],
      ["append_session_event", { path: "/lib/.study-wiki/sessions/s1.jsonl", line: "{\"type\":\"x\"}" }],
      ["delete_session_file", { path: "/lib/.study-wiki/sessions/s1.jsonl" }],
    ]);
  });
});
