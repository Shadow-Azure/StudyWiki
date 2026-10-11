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

  it("agent session storage commands use the user-level per-root session domain", async () => {
    const calls: [string, unknown][] = [];
    const f = filesWith(async (cmd, args) => { calls.push([cmd, args]); });
    await f.agentSessionPaths("/lib/root");
    await f.agentSessionPath("/lib/root", "s1");
    await f.readAgentSessionFile("/home/.study-wiki/sessions/root-key/s1.jsonl");
    await f.writeAgentSessionFile("/home/.study-wiki/sessions/root-key/s1.jsonl", "header\n");
    await f.appendSessionEvent("/home/.study-wiki/sessions/root-key/s1.jsonl", "{\"type\":\"x\"}");
    await f.deleteSessionFile("/home/.study-wiki/sessions/root-key/s1.jsonl");
    expect(calls).toEqual([
      ["agent_session_paths", { root: "/lib/root" }],
      ["agent_session_path", { root: "/lib/root", id: "s1" }],
      ["read_agent_session_file", { path: "/home/.study-wiki/sessions/root-key/s1.jsonl" }],
      ["write_agent_session_file", { path: "/home/.study-wiki/sessions/root-key/s1.jsonl", contents: "header\n" }],
      ["append_session_event", { path: "/home/.study-wiki/sessions/root-key/s1.jsonl", line: "{\"type\":\"x\"}" }],
      ["delete_session_file", { path: "/home/.study-wiki/sessions/root-key/s1.jsonl" }],
    ]);
  });
});
