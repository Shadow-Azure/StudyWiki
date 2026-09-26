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

test("files: readBinary 使用 raw IPC 并归一响应字节", async () => {
  const path = "/库/工作簿.xlsx";
  const invoke = vi.fn()
    .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
    .mockResolvedValueOnce(new ArrayBuffer(3))
    .mockResolvedValueOnce([4, 5, 6])
    .mockResolvedValueOnce(42);
  const files = new FilesService({ invoke, listen: vi.fn(), openDialog: vi.fn(), assetUrl: (p) => p });
  await expect(files.readBinary(path)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  expect(invoke).toHaveBeenNthCalledWith(1, "read_binary_file", new Uint8Array(0), {
    headers: { "x-studywiki-path": encodeURIComponent(path) },
  });
  await expect(files.readBinary(path)).resolves.toEqual(new Uint8Array(3));
  await expect(files.readBinary(path)).resolves.toEqual(new Uint8Array([4, 5, 6]));
  await expect(files.readBinary(path)).rejects.toThrow(/raw byte/);
});

test("files: writeBinary 直接发送 raw IPC 字节与 UTF-8 安全路径头", async () => {
  const path = "/库/工作簿.xlsx";
  const bytes = new Uint8Array([4, 5]);
  const invoke = vi.fn().mockResolvedValue(null);
  const files = new FilesService({ invoke, listen: vi.fn(), openDialog: vi.fn(), assetUrl: (p) => p });
  await files.writeBinary(path, bytes);
  expect(invoke).toHaveBeenCalledWith("write_binary_file", bytes, {
    headers: { "x-studywiki-path": encodeURIComponent(path) },
  });
  invoke.mockRejectedValueOnce(new Error("denied"));
  await expect(files.writeBinary(path, new Uint8Array())).rejects.toThrow("denied");
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

test("windows: setRoot 透传 label+root（注册表更新 + asset 授权的命令面）", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn() });
  await win.setRoot("main", "/picked");
  expect(invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/picked" });
});

test("windows: changeRoot 非 null 先授权登记再切工作区；null 只清前端", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn() });
  const workspace = { setRoot: vi.fn() };
  await win.changeRoot(workspace, "/picked");
  expect(invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/picked" });
  expect(workspace.setRoot).toHaveBeenCalledWith("/picked");
  // 顺序不变式：授权+登记成功才切前端（fail-closed，防欢迎态漏授权复发）。
  expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(workspace.setRoot.mock.invocationCallOrder[0]);
  await win.changeRoot(workspace, null);
  expect(workspace.setRoot).toHaveBeenLastCalledWith(null);
  expect(invoke).toHaveBeenCalledTimes(1);
});
