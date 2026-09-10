import { expect, test, vi } from "vitest";
import { createEmitter } from "../src/host/emitter";
import { FilesService } from "../src/host/files";
import { WindowsService } from "../src/host/windows";

test("emitter: 订阅/触发/退订", () => {
  const e = createEmitter<{ ch: number }>();
  const seen: number[] = [];
  const off = e.on("ch", (p) => seen.push(p));
  e.emit("ch", 1); off(); e.emit("ch", 2);
  expect(seen).toEqual([1]);
});

test("files: readTree 透传参数、返回结果", async () => {
  const invoke = vi.fn().mockResolvedValue([{ name: "a.md", path: "/x/a.md", kind: "markdown" }]);
  const files = new FilesService({ invoke, listen: vi.fn(), openDialog: vi.fn(), assetUrl: (p) => `a:${p}` });
  await expect(files.readTree("/x")).resolves.toEqual([{ name: "a.md", path: "/x/a.md", kind: "markdown" }]);
  expect(invoke).toHaveBeenCalledWith("read_tree", { root: "/x" });
});

test("files: 命令错误原样上抛", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("boom"));
  const files = new FilesService({ invoke, listen: vi.fn(), openDialog: vi.fn(), assetUrl: (p) => p });
  await expect(files.writeText("/x/a", "t")).rejects.toThrow("boom");
});

test("files: fs://changed 桥接为 onFsChanged", async () => {
  let bridge!: (e: { payload: unknown }) => void;
  const listen = vi.fn(async (_e: string, cb: (e: { payload: unknown }) => void) => { bridge = cb; return () => {}; });
  const files = new FilesService({ invoke: vi.fn(), listen, openDialog: vi.fn(), assetUrl: (p) => p });
  await files.start();
  const seen: string[] = [];
  files.onFsChanged((p) => seen.push(p));
  bridge({ payload: "/x/a.md" });
  expect(seen).toEqual(["/x/a.md"]);
});

test("windows: fetchRoot 对 null 状态安全；confirmDialog 透传", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const confirmDialog = vi.fn().mockResolvedValue(true);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog });
  await expect(win.fetchRoot("main")).resolves.toBeNull();
  expect(invoke).toHaveBeenCalledWith("get_window_state", { label: "main" });
  await expect(win.confirmDialog("放弃修改？")).resolves.toBe(true);
  expect(confirmDialog).toHaveBeenCalledWith("放弃修改？");
});
