// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { bootstrap } from "../src/bootstrap";
import type { ModuleTable } from "../src/loader/table";

function fakeEnv(table: ModuleTable) {
  const written: string[] = [];
  const ran: string[] = [];
  const openDialog = vi.fn();
  const probe = { name: "probe", inject: ["files", "windows", "workspace", "slots"], apply(ctx: any) { ran.push(`ctx-ok:${!!ctx.files && !!ctx.windows && !!ctx.workspace && !!ctx.slots}`); } };
  table["probe"] = { plugin: probe, defaults: {} };
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "read_manifest") return null;
    if (cmd === "write_manifest") { written.push(String(args?.json)); return null; }
    if (cmd === "get_window_state") return null;
    // view-filetree（内置插件）在 root 变更后重读树；桩回空树，本文件用例不断言树内容。
    if (cmd === "read_tree") return [];
    throw new Error(`unexpected ${cmd}`);
  });
  return {
    env: {
      invoke,
      listen: vi.fn(async () => () => {}),
      openDialog,
      assetUrl: (p: string) => `a:${p}`,
      currentLabel: () => "main",
      onCloseRequested: vi.fn(async () => () => {}),
      table,
    },
    written, ran, openDialog,
  };
}

test("bootstrap: 首启生成默认清单、宿主服务齐全、插件激活", async () => {
  const f = fakeEnv({});
  const ctx = await bootstrap(f.env);
  expect(f.ran).toEqual(["ctx-ok:true"]);
  expect(JSON.parse(f.written[0]).plugins.map((p: { id: string }) => p.id)).toContain("app-shell");
  expect(document.querySelector(".main")).not.toBeNull();
  expect((ctx as any).files).toBeDefined();
});

test("bootstrap: 欢迎态按钮 → pickFolder → setRoot", async () => {
  const f = fakeEnv({});
  const ctx = await bootstrap(f.env);
  const btn = document.querySelector<HTMLButtonElement>(".welcome button");
  expect(btn).not.toBeNull();
  f.openDialog.mockResolvedValue("/picked");
  btn!.click();
  await new Promise((r) => setTimeout(r, 10));
  expect(f.openDialog).toHaveBeenCalledWith();
  // pickFolder 返回后走 setRoot：欢迎态消失（时序抖动则改为直接断言 ctx.workspace.root）
  expect(ctx.workspace.root).toBe("/picked");
  expect(document.querySelector(".welcome")).toBeNull();
});

test("bootstrap: ext: 行经宿主服务装载，坏行回填 plugins.bootBroken", async () => {
  const f = fakeEnv({});
  const okModule = { name: "ext-demo", inject: ["slots"], apply() {} };
  f.env.loadExternal = async (code: string) => {
    expect(code).toBe("export const name = 'ext-demo';");
    return okModule as unknown as Record<string, unknown>;
  };
  f.env.invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "read_manifest") {
      return JSON.stringify({
        plugins: [
          { id: "app-shell", enabled: true, config: {} },
          { id: "ext:demo", enabled: true, config: {} },
          { id: "ext:gone", enabled: true, config: {} },
        ],
      });
    }
    if (cmd === "write_manifest") return null;
    if (cmd === "get_window_state") return null;
    if (cmd === "read_tree") return [];
    if (cmd === "read_plugin_module") {
      return args?.name === "demo"
        ? { code: "export const name = 'ext-demo';", apiVersion: 1 }
        : Promise.reject(new Error("读 gone/package.json 失败：NotFound"));
    }
    throw new Error(`unexpected ${cmd}`);
  });
  const ctx = await bootstrap(f.env);
  expect((ctx as any).plugins).toBeDefined();
  expect((ctx as any).plugins.bootBroken).toEqual([
    { id: "ext:gone", reason: "读 gone/package.json 失败：NotFound" },
  ]);
});

test("bootstrap: 持久 root 启动时重授权 asset scope（set_window_root）", async () => {
  const f = fakeEnv({});
  f.env.invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "read_manifest") return null;
    if (cmd === "write_manifest") { f.written.push(String(args?.json)); return null; }
    if (cmd === "get_window_state") return "/had-root";
    if (cmd === "set_window_root") return null;
    if (cmd === "read_tree") return [];
    throw new Error(`unexpected ${cmd}`);
  });
  const ctx = await bootstrap(f.env);
  expect(ctx.workspace.root).toBe("/had-root");
  expect(f.env.invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/had-root" });
});
