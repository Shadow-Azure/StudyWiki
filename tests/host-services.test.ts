import { expect, test, vi } from "vitest";
import { createEmitter } from "../src/host/emitter";
import { FilesService } from "../src/host/files";
import { WindowsService } from "../src/host/windows";
import { WorkspaceService } from "../src/host/workspace";
import type { FileNode } from "../src/types";

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
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn(), destroy: vi.fn() });
  await win.setRoot("main", "/picked");
  expect(invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/picked" });
});

test("windows: markCloseGuardReady 向原生壳注册当前窗口", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn(), destroy: vi.fn() });
  await win.guardClose(() => false, vi.fn(async () => true));
  await win.markCloseGuardReady();
  expect(invoke).toHaveBeenCalledWith("set_close_guard_ready", { label: "main", ready: true });
});

test("windows: 无 guard 或全部退订时不启用原生同步取消", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const onCloseRequested = vi.fn(async () => () => {});
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested, confirmDialog: vi.fn(), destroy: vi.fn() });
  await win.markCloseGuardReady();
  expect(invoke).toHaveBeenCalledWith("set_close_guard_ready", { label: "main", ready: false });

  const off = await win.guardClose(() => false, vi.fn(async () => true));
  expect(invoke).toHaveBeenLastCalledWith("set_close_guard_ready", { label: "main", ready: true });
  await off();
  expect(invoke).toHaveBeenLastCalledWith("set_close_guard_ready", { label: "main", ready: false });
});

test("windows: 会话中途注册 guard 即刻武装原生壳，无需重跑 boot 标记", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(async () => () => {}), confirmDialog: vi.fn(), destroy: vi.fn() });
  await win.markCloseGuardReady();
  expect(invoke).toHaveBeenLastCalledWith("set_close_guard_ready", { label: "main", ready: false });

  await win.guardClose(() => true, vi.fn(async () => true));
  expect(invoke).toHaveBeenLastCalledWith("set_close_guard_ready", { label: "main", ready: true });
});

test("windows: macOS hook 桥接为前端聚合关窗函数", async () => {
  const global = globalThis as typeof globalThis & { __studywikiNativeClose?: () => void };
  const invoke = vi.fn().mockResolvedValue(null);
  const destroy = vi.fn(async () => {});
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(async () => () => {}), confirmDialog: vi.fn(), destroy });
  const off = await win.guardClose(() => false, vi.fn(async () => true));
  expect(typeof global.__studywikiNativeClose).toBe("function");

  global.__studywikiNativeClose?.();
  await new Promise((r) => setTimeout(r, 0));
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("set_close_guard_ready", { label: "main", ready: false });

  await off();
  expect(global.__studywikiNativeClose).toBeUndefined();
});

test("windows: changeRoot 非 null 先授权登记再切工作区；null 只清前端", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn(), destroy: vi.fn() });
  const workspace = new WorkspaceService();
  const forceSetRoot = vi.spyOn(workspace, "forceSetRoot");
  win.bindWorkspace(workspace);
  await expect(win.changeRoot("/picked")).resolves.toBe(true);
  expect(invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/picked" });
  expect(workspace.root).toBe("/picked");
  // 顺序不变式：守卫确认 + 授权登记成功才切前端（fail-closed，防欢迎态漏授权复发）。
  expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(forceSetRoot.mock.invocationCallOrder[0]);
  await expect(win.changeRoot(null)).resolves.toBe(true);
  expect(workspace.root).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("windows: changeRoot 在工作区守卫拒绝时不授权登记", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn(), destroy: vi.fn() });
  const workspace = new WorkspaceService();
  const forceSetRoot = vi.spyOn(workspace, "forceSetRoot");
  workspace.guardSwitch(() => true, () => Promise.resolve(false));
  win.bindWorkspace(workspace);
  await expect(win.changeRoot("/picked")).resolves.toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  expect(forceSetRoot).not.toHaveBeenCalled();
  expect(workspace.root).toBeNull();
});

test("windows: changeRoot 授权登记失败时 fail-closed 不切前端", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("grant denied"));
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn(), destroy: vi.fn() });
  const workspace = new WorkspaceService();
  await workspace.setRoot("/old");
  const md: FileNode = { name: "a.md", path: "/old/a.md", kind: "markdown" };
  await workspace.openFile(md);
  const forceSetRoot = vi.spyOn(workspace, "forceSetRoot");
  win.bindWorkspace(workspace);
  await expect(win.changeRoot("/new")).rejects.toThrow("grant denied");
  expect(forceSetRoot).not.toHaveBeenCalled();
  expect(workspace.root).toBe("/old");
  expect(workspace.activeFile).toBe(md);
});

test("windows: guardClose 同步拦关，干净与确认后都经 destroy 显式关窗", async () => {
  let handler!: (e: { preventDefault(): void }) => void;
  const onCloseRequested = vi.fn((cb: (e: { preventDefault(): void }) => void) => {
    handler = cb;
    return Promise.resolve(() => {});
  });
  const confirmDialog = vi.fn(async () => false);
  const destroy = vi.fn(async () => {});
  const win = new WindowsService({ invoke: vi.fn(), currentLabel: () => "main", onCloseRequested, confirmDialog, destroy });
  let dirty = false;
  await win.guardClose(() => dirty, () => win.confirmDialog("放弃修改？"));

  // 干净：原生壳先同步取消，前端回调仍必须显式 destroy，避免窗体停留。
  const clean = { preventDefault: vi.fn() };
  handler(clean);
  expect(clean.preventDefault).toHaveBeenCalledTimes(1);
  expect(confirmDialog).not.toHaveBeenCalled();
  await new Promise((r) => setTimeout(r, 0));
  expect(destroy).toHaveBeenCalledTimes(1);

  // 脏 + 取消：preventDefault 必须发生在任何 await 之前；不 destroy。
  dirty = true;
  const cancelled = { preventDefault: vi.fn() };
  handler(cancelled);
  expect(cancelled.preventDefault).toHaveBeenCalledTimes(1);
  expect(confirmDialog).toHaveBeenCalledWith("放弃修改？");
  await new Promise((r) => setTimeout(r, 0));
  expect(destroy).toHaveBeenCalledTimes(1);

  // 脏 + 确认：仍同步拦下，确认 resolve 后经 destroy 关窗。
  confirmDialog.mockResolvedValue(true);
  const confirmed = { preventDefault: vi.fn() };
  handler(confirmed);
  expect(confirmed.preventDefault).toHaveBeenCalledTimes(1);
  await new Promise((r) => setTimeout(r, 0));
  expect(destroy).toHaveBeenCalledTimes(2);
});

test("windows: 多个 guard 聚合成一次关窗判定，干净 guard 不提前 destroy", async () => {
  let handler!: (e: { preventDefault(): void }) => void;
  const onCloseRequested = vi.fn((cb: (e: { preventDefault(): void }) => void) => {
    handler = cb;
    return Promise.resolve(() => {});
  });
  const cleanConfirm = vi.fn(async () => true);
  const dirtyConfirm = vi.fn(async () => false);
  const destroy = vi.fn(async () => {});
  const win = new WindowsService({ invoke: vi.fn(), currentLabel: () => "main", onCloseRequested, confirmDialog: vi.fn(), destroy });
  await win.guardClose(() => false, cleanConfirm);
  await win.guardClose(() => true, dirtyConfirm);

  const event = { preventDefault: vi.fn() };
  handler(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(cleanConfirm).not.toHaveBeenCalled();
  await new Promise((r) => setTimeout(r, 0));
  expect(dirtyConfirm).toHaveBeenCalledTimes(1);
  expect(destroy).not.toHaveBeenCalled();
});

test("windows: bootstrap 绑定内部工作区后 changeRoot 走守卫与授权切根", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn(), destroy: vi.fn() });
  const workspace = new WorkspaceService();
  win.bindWorkspace(workspace);
  await expect(win.changeRoot("/picked")).resolves.toBe(true);
  expect(invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/picked" });
  expect(workspace.root).toBe("/picked");
});
