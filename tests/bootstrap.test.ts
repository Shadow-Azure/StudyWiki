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
