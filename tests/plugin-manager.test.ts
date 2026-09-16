// @vitest-environment jsdom
import { expect, test, vi, beforeEach } from "vitest";
import { apply } from "../src/plugins/plugin-manager";
import { computePanelRows, withEnabled, withRow, withoutRow } from "../src/plugins/plugin-manager/model";
import {
  activateExternal,
  deactivateExternal,
  reloadExternal,
  runningExternals,
  activationFailures,
} from "../src/loader/activate";
import type { Manifest } from "../src/loader/manifest";
import type { PluginVersion } from "../src/host/plugins";

// 激活面（loader/activate）在面板里是"按顺序调用的运行期动作"：本文件钉住面板调
// 了谁、传了什么、清单落了什么；真装载行为由 tests/activate.test.ts 覆盖。
// R17：安装/导入即激活走 reloadExternal（内部已串行 + 先 dispose 旧 fiber），
// activateExternal 保留在 mock 里唯一用途是反向断言"面板不再直调它"。
vi.mock("../src/loader/activate", () => ({
  activateExternal: vi.fn(async () => {}),
  reloadExternal: vi.fn(async () => {}),
  deactivateExternal: vi.fn(async () => {}),
  runningExternals: vi.fn(() => new Set<string>(["demo"])),
  activationFailures: vi.fn(() => new Map<string, string>()),
}));

// 同文件的 DOM 测试共享一个 jsdom document：上一用例残留的顶栏按钮/面板会让
// 下一用例的 querySelector 点到旧 ctx 的节点，先清场保证用例间互不污染。
beforeEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const manifest = (rows: Array<[string, boolean]>): Manifest => ({
  plugins: rows.map(([id, enabled]) => ({ id, enabled, config: {} })),
});

test("model: 三源合一——boot 坏行优先，目录扫描 problem 次之，目录缺失兜底", () => {
  const m = manifest([["app-shell", true], ["ext:demo", true], ["ext:gone", false]]);
  const entries = [
    { name: "demo", version: "1.2.0", apiVersion: 1, entry: "index.js", problem: null },
    { name: "sick", version: null, apiVersion: null, entry: null, problem: "package.json 解析失败" },
  ];
  const rows = computePanelRows(m, entries, [{ id: "ext:demo", reason: "入口导出缺 apply" }], new Set(), new Map());
  expect(rows[0]).toEqual({
    id: "app-shell", externalName: null, enabled: true, version: null, problem: null, removable: false,
    runtime: null, failure: null,
  });
  expect(rows[1]).toMatchObject({ externalName: "demo", version: "1.2.0", problem: "入口导出缺 apply", removable: true });
  expect(rows[2]).toMatchObject({ externalName: "gone", problem: "插件目录缺失", enabled: false, removable: true });
});

test("model: 开关与移除是纯变换", () => {
  const m = manifest([["a", true], ["ext:b", false]]);
  expect(withEnabled(m, "a", false).plugins[0].enabled).toBe(false);
  expect(withoutRow(m, "ext:b").plugins.map((r) => r.id)).toEqual(["a"]);
});

test("model: withRow 追加 enabled 行且幂等", () => {
  const m = manifest([["app-shell", true]]);
  const m2 = withRow(m, "ext:demo");
  expect(m2.plugins.map((r) => r.id)).toEqual(["app-shell", "ext:demo"]);
  expect(m2.plugins[1]).toEqual({ id: "ext:demo", enabled: true, config: {} });
  expect(withRow(m2, "ext:demo")).toEqual(m2); // 已在则不增生
});

test("model: 四源投影——running/failed/stopped 与 failure 文案", () => {
  const m = manifest([["app-shell", true], ["ext:a", true], ["ext:b", true], ["ext:c", false]]);
  const rows = computePanelRows(
    m, [], [], new Set(["a"]), new Map([["b", "激活审计超时：声明的服务未提供？"]]),
  );
  expect(rows[0].runtime).toBeNull(); // 内置不投影运行态
  expect(rows[1].runtime).toBe("running");
  expect(rows[2].runtime).toBe("failed");
  expect(rows[2].failure).toContain("声明的服务未提供");
  expect(rows[3].runtime).toBe("stopped"); // 停用 = 清单 enabled:false
});

interface FakePlugins {
  written: string[];
  state: { rows: Array<[string, boolean]> };
  plugins: {
    readManifest: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    bootBroken: Array<{ id: string; reason: string }>;
    writeManifest: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    install: ReturnType<typeof vi.fn>;
    importFromTgz: ReturnType<typeof vi.fn>;
    loadModule: ReturnType<typeof vi.fn>;
    snapshot: ReturnType<typeof vi.fn>;
    listVersions: ReturnType<typeof vi.fn>;
    restoreVersion: ReturnType<typeof vi.fn>;
  };
  windows: { confirmDialog: ReturnType<typeof vi.fn> };
}

/** 假宿主插件服务：writeManifest 同步回写内存清单，模拟落盘后重新读取。 */
function fakePlugins(rows: Array<[string, boolean]> = [["app-shell", true], ["ext:demo", true]]): FakePlugins {
  const state = { rows };
  const written: string[] = [];
  return {
    written,
    state,
    plugins: {
      readManifest: vi.fn(async () => JSON.stringify(manifest(state.rows))),
      list: vi.fn(async () => [
        { name: "demo", version: "1.0.0", apiVersion: 1, entry: "index.js", problem: null },
      ]),
      bootBroken: [],
      writeManifest: vi.fn(async (m: Manifest) => {
        written.push(JSON.stringify(m));
        state.rows = m.plugins.map((r) => [r.id, r.enabled]);
      }),
      remove: vi.fn(async () => {}),
      install: vi.fn(async () => "demo"),
      importFromTgz: vi.fn(async () => null),
      loadModule: vi.fn(async () => ({ name: "ext-demo", apply: () => {} })),
      snapshot: vi.fn(async () => null),
      listVersions: vi.fn(async () => [] as PluginVersion[]),
      restoreVersion: vi.fn(async () => {}),
    },
    windows: { confirmDialog: vi.fn(async () => true) },
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 挂载 plugin-manager 并点开面板（顶栏按钮由 apply 注册进 body）。 */
async function openPanel(f: FakePlugins): Promise<void> {
  const slots = {
    register: (_s: string, render: (el: HTMLElement) => void) => {
      render(document.body);
      return () => {};
    },
  };
  apply({ plugins: f.plugins, slots, windows: f.windows } as never, {});
  const open = document.querySelector<HTMLButtonElement>("button")!;
  expect(open.getAttribute("aria-label")).toBe("插件");
  expect(open.title).toBe("插件");
  open.click();
  await tick();
}

function rowAt(i: number): HTMLElement {
  return document.querySelectorAll<HTMLElement>(".plugin-row")[i];
}

function clickInRow(i: number, text: string): void {
  const b = [...rowAt(i).querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent === text);
  if (!b) throw new Error(`第 ${i} 行没有按钮：${text}`);
  b.click();
}

function clickButton(text: string): void {
  const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent === text);
  if (!b) throw new Error(`找不到按钮：${text}`);
  b.click();
}

function toggles(): NodeListOf<HTMLInputElement> {
  return document.querySelectorAll<HTMLInputElement>(".plugin-row input[type=checkbox]");
}

test("面板: 列行 + 运行态徽章 + 常驻说明（重启提示元素已删）", async () => {
  const f = fakePlugins();
  await openPanel(f);
  expect(document.querySelector(".plugin-panel")).not.toBeNull();
  expect(document.querySelectorAll(".plugin-row").length).toBe(2);
  // 即时化后不再有"重启生效"提示；换常驻说明
  expect(document.querySelector(".plugin-restart-hint")).toBeNull();
  expect(document.querySelector<HTMLElement>(".plugin-note")!.textContent).toBe(
    "改动即时生效于本窗口；其他窗口重启后跟随清单。",
  );
  expect(rowAt(0).querySelector(".plugin-runtime")).toBeNull(); // 内置行无运行态
  expect(rowAt(1).querySelector<HTMLElement>(".plugin-runtime")!.textContent).toBe("运行中");
});

test("面板: 内置行开关只写清单（无运行期动作）", async () => {
  const f = fakePlugins();
  await openPanel(f);
  toggles()[0].click();
  await tick();
  expect(JSON.parse(f.written[0]).plugins[0].enabled).toBe(false);
  expect(activateExternal).not.toHaveBeenCalled();
  expect(reloadExternal).not.toHaveBeenCalled();
  expect(deactivateExternal).not.toHaveBeenCalled();
});

test("面板: 外置行开关即时启停——关走 deactivate、开走 reload，都落清单", async () => {
  const f = fakePlugins();
  await openPanel(f);
  toggles()[1].click();
  await tick();
  expect(deactivateExternal).toHaveBeenCalledWith("demo");
  expect(JSON.parse(f.written.at(-1)!).plugins[1]).toEqual({ id: "ext:demo", enabled: false, config: {} });
  // 再开：清单已落 enabled:false，勾选回来走 reloadExternal（内部已串行，面板不另包）
  expect(toggles()[1].checked).toBe(false);
  toggles()[1].click();
  await tick();
  expect(f.plugins.loadModule).toHaveBeenCalledWith("demo");
  expect(reloadExternal).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reloadExternal).mock.calls[0][1]).toBe("demo");
  expect(vi.mocked(reloadExternal).mock.calls[0][3]).toEqual({}); // 清单行 config 直传
  expect(JSON.parse(f.written.at(-1)!).plugins[1].enabled).toBe(true);
});

test("面板: 重新加载走 loadModule + reloadExternal", async () => {
  const f = fakePlugins();
  await openPanel(f);
  clickInRow(1, "重新加载");
  await tick();
  expect(f.plugins.loadModule).toHaveBeenCalledWith("demo");
  expect(reloadExternal).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reloadExternal).mock.calls[0][1]).toBe("demo");
});

test("面板: 安装写 ext: 清单行（存量缺口）并走热重载激活（R17）", async () => {
  const f = fakePlugins([["app-shell", true]]);
  await openPanel(f);
  document.querySelector<HTMLInputElement>(".plugin-panel-head input")!.value = "demo-x";
  clickButton("安装");
  await tick();
  expect(f.plugins.install).toHaveBeenCalledWith("demo-x");
  // 存量缺口修复：安装即落清单行，重启后 boot 才装得上它
  const last = JSON.parse(f.written.at(-1)!);
  expect(last.plugins.map((r: { id: string }) => r.id)).toEqual(["app-shell", "ext:demo"]);
  expect(last.plugins[1]).toEqual({ id: "ext:demo", enabled: true, config: {} });
  // R17：安装即激活走 reloadExternal（内部串行 + 先 dispose 旧 fiber + 失败回退旧模块）；
  // 面板既不自己包 serialized（同名单层嵌套会自锁），也不直调 activateExternal
  // （那会把已在跑的旧 fiber 覆盖成孤儿，任何面板动作都 dispose 不到）。
  expect(reloadExternal).toHaveBeenCalledTimes(1);
  const call = vi.mocked(reloadExternal).mock.calls[0];
  expect(call[1]).toBe("demo");
  expect(call[3]).toEqual({});
  expect(typeof (call[4] as { snapshot: unknown }).snapshot).toBe("function");
  expect(activateExternal).not.toHaveBeenCalled();
  expect(document.querySelector(".plugin-restart-hint")).toBeNull();
});

test("面板: 覆盖安装已在跑的插件同样走 reloadExternal（不留孤儿 fiber）", async () => {
  const f = fakePlugins(); // 默认清单已含 enabled 的 ext:demo
  await openPanel(f);
  document.querySelector<HTMLInputElement>(".plugin-panel-head input")!.value = "demo";
  clickButton("安装");
  await tick();
  expect(f.plugins.install).toHaveBeenCalledWith("demo");
  // 已在跑时重装 = 升级：必须经 reloadExternal 的 dispose 路径，而不是再挂一个
  // fiber 覆盖登记（旧 fiber 会存活到重启，停用/移除都看起来生效却留着插件 UI）。
  expect(reloadExternal).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reloadExternal).mock.calls[0][1]).toBe("demo");
  expect(activateExternal).not.toHaveBeenCalled();
  // withRow 幂等：覆盖安装不产生重复清单行
  expect(JSON.parse(f.written.at(-1)!).plugins.map((r: { id: string }) => r.id)).toEqual(["app-shell", "ext:demo"]);
});

test("面板: 安装到已停用的同名行会同时启用该行（R19）", async () => {
  const f = fakePlugins([["app-shell", true], ["ext:demo", false]]);
  await openPanel(f);
  document.querySelector<HTMLInputElement>(".plugin-panel-head input")!.value = "demo";
  clickButton("安装");
  await tick();
  expect(reloadExternal).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reloadExternal).mock.calls[0][1]).toBe("demo");
  // 安装是"要有这个插件"的显式意图：withRow 对已存在的停用行是空操作，不补启用
  // 就会装完在跑而清单仍说停用（下次启动又不装，面板与清单长期打架）。
  const last = JSON.parse(f.written.at(-1)!);
  expect(last.plugins.map((r: { id: string }) => r.id)).toEqual(["app-shell", "ext:demo"]);
  expect(last.plugins[1].enabled).toBe(true);
});

test("面板: 本地导入到已停用的同名行会同时启用该行（R19）", async () => {
  const f = fakePlugins([["app-shell", true], ["ext:demo", false]]);
  f.plugins.importFromTgz = vi.fn(async () => "demo");
  await openPanel(f);
  clickButton("本地导入…");
  await tick();
  expect(reloadExternal).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reloadExternal).mock.calls[0][1]).toBe("demo");
  const last = JSON.parse(f.written.at(-1)!);
  expect(last.plugins.map((r: { id: string }) => r.id)).toEqual(["app-shell", "ext:demo"]);
  expect(last.plugins[1].enabled).toBe(true);
});

test("面板: 本地导入取消不动清单，成功则同安装路径（reloadExternal）", async () => {
  const f = fakePlugins([["app-shell", true]]);
  await openPanel(f);
  clickButton("本地导入…"); // importFromTgz → null = 用户取消
  await tick();
  expect(f.written.length).toBe(0);
  expect(reloadExternal).not.toHaveBeenCalled();

  f.plugins.importFromTgz = vi.fn(async () => "demo");
  clickButton("本地导入…");
  await tick();
  expect(JSON.parse(f.written.at(-1)!).plugins.map((r: { id: string }) => r.id)).toEqual(["app-shell", "ext:demo"]);
  expect(reloadExternal).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reloadExternal).mock.calls[0][1]).toBe("demo");
  expect(activateExternal).not.toHaveBeenCalled();
});

test("面板: 安装成功但激活失败——内联报错，清单行留 enabled 待下次 boot 重试", async () => {
  const f = fakePlugins([["app-shell", true]]);
  vi.mocked(reloadExternal).mockRejectedValueOnce(new Error("激活审计超时：声明的服务未提供？"));
  await openPanel(f);
  document.querySelector<HTMLInputElement>(".plugin-panel-head input")!.value = "demo-x";
  clickButton("安装");
  await tick();
  const err = document.querySelector<HTMLElement>(".plugin-error")!;
  expect(err.hidden).toBe(false);
  expect(err.textContent).toContain("激活审计超时");
  const last = JSON.parse(f.written.at(-1)!);
  expect(last.plugins.some((r: { id: string; enabled: boolean }) => r.id === "ext:demo" && r.enabled)).toBe(true);
});

test("面板: 投影失败行显示装载失败原因", async () => {
  const f = fakePlugins();
  vi.mocked(runningExternals).mockReturnValueOnce(new Set());
  vi.mocked(activationFailures).mockReturnValueOnce(new Map([["demo", "激活审计超时：声明的服务未提供？"]]));
  await openPanel(f);
  expect(rowAt(1).textContent).toContain("装载失败：激活审计超时：声明的服务未提供？");
});

test("面板: 坏行只留移除（不提供重新加载/历史）", async () => {
  const f = fakePlugins();
  f.plugins.list = vi.fn(async () => [
    { name: "demo", version: null, apiVersion: null, entry: null, problem: "package.json 解析失败" },
  ]);
  await openPanel(f);
  const buttons = [...rowAt(1).querySelectorAll("button")].map((b) => b.textContent);
  expect(buttons).toEqual(["移除"]);
  expect(rowAt(1).textContent).toContain("待清理：package.json 解析失败");
});

test("面板: 移除先确认——确认才 deactivate + remove + 清单过滤", async () => {
  const f = fakePlugins();
  await openPanel(f);
  clickInRow(1, "移除");
  await tick();
  expect(f.windows.confirmDialog).toHaveBeenCalledTimes(1);
  expect(vi.mocked(f.windows.confirmDialog).mock.calls[0][0]).toContain("版本历史将一并删除");
  expect(deactivateExternal).toHaveBeenCalledWith("demo");
  expect(f.plugins.remove).toHaveBeenCalledWith("demo");
  expect(JSON.parse(f.written.at(-1)!).plugins.map((r: { id: string }) => r.id)).toEqual(["app-shell"]);
});

test("面板: 移除确认被拒则整体不动", async () => {
  const f = fakePlugins();
  f.windows.confirmDialog = vi.fn(async () => false);
  await openPanel(f);
  clickInRow(1, "移除");
  await tick();
  expect(f.plugins.remove).not.toHaveBeenCalled();
  expect(deactivateExternal).not.toHaveBeenCalled();
  expect(f.written.length).toBe(0);
});

test("面板: 历史展开版本列表，回退走 restoreVersion + reloadExternal", async () => {
  const f = fakePlugins();
  const versions: PluginVersion[] = [
    { id: "1700000000-abcdef123456", createdAt: 1700000000, version: "1.1.0", apiVersion: 1, hash: "abcdef123456", current: true },
    { id: "1699999999-123456abcdef", createdAt: 1699999999, version: "1.0.0", apiVersion: 1, hash: "123456abcdef", current: false },
  ];
  f.plugins.listVersions = vi.fn(async () => versions);
  await openPanel(f);
  clickInRow(1, "历史");
  await tick();
  const items = document.querySelectorAll<HTMLElement>(".plugin-version-row");
  expect(items.length).toBe(2);
  expect(items[0].textContent).toContain("（当前）");
  expect(items[0].querySelector("button")).toBeNull(); // 当前代没有回退按钮
  expect(items[1].textContent).toContain("1.0.0");
  items[1].querySelector<HTMLButtonElement>("button")!.click();
  await tick();
  expect(f.plugins.restoreVersion).toHaveBeenCalledWith("demo", "1699999999-123456abcdef");
  expect(reloadExternal).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reloadExternal).mock.calls[0][1]).toBe("demo");
});

test("面板: 停用行不给重新加载，回退只落盘不激活（R18）", async () => {
  const f = fakePlugins([["app-shell", true], ["ext:demo", false]]);
  const versions: PluginVersion[] = [
    { id: "1700000000-abcdef123456", createdAt: 1700000000, version: "1.1.0", apiVersion: 1, hash: "abcdef123456", current: true },
    { id: "1699999999-123456abcdef", createdAt: 1699999999, version: "1.0.0", apiVersion: 1, hash: "123456abcdef", current: false },
  ];
  f.plugins.listVersions = vi.fn(async () => versions);
  await openPanel(f);
  // 停用行的清单语义是"不该在跑"：重新加载会把插件装回来而清单仍说停用
  // （投影按 !enabled 先判 stopped → 行显示停用、插件却在跑）。
  expect([...rowAt(1).querySelectorAll("button")].map((b) => b.textContent)).toEqual(["历史", "移除"]);

  clickInRow(1, "历史");
  await tick();
  const rollback = document.querySelectorAll<HTMLButtonElement>(".plugin-version-row button");
  expect(rollback.length).toBe(1); // 当前代无回退按钮
  rollback[0].click();
  await tick();
  expect(f.plugins.restoreVersion).toHaveBeenCalledWith("demo", "1699999999-123456abcdef");
  // 停用行只落盘：不 loadModule、不激活，下次启用/重新加载自然按恢复后的代码跑
  expect(reloadExternal).not.toHaveBeenCalled();
  expect(f.plugins.loadModule).not.toHaveBeenCalled();
});

test("面板: 历史列表读取失败内联显示，不静默", async () => {
  const f = fakePlugins();
  f.plugins.listVersions = vi.fn(async () => {
    throw new Error("list_plugin_versions 失败：目录不存在");
  });
  await openPanel(f);
  clickInRow(1, "历史");
  await tick();
  expect(document.querySelector<HTMLElement>(".plugin-error")!.textContent).toContain("list_plugin_versions 失败");
});

test("面板: 安装失败内联显示错误（fail-loud 不静默）", async () => {
  const f = fakePlugins();
  f.plugins.install = vi.fn(async () => {
    throw new Error("查 registry demo-x 失败：404");
  });
  await openPanel(f);
  const input = document.querySelector<HTMLInputElement>(".plugin-panel-head input")!;
  input.value = "demo-x";
  clickButton("安装");
  await tick();
  const err = document.querySelector<HTMLElement>(".plugin-error");
  expect(err).not.toBeNull();
  expect(err!.textContent).toContain("demo-x");
});

test("面板: 失败后一次成功操作清掉内联错误行（不残留旧失败）", async () => {
  const f = fakePlugins();
  f.plugins.install = vi.fn(async () => {
    throw new Error("查 registry demo-x 失败：404");
  });
  await openPanel(f);
  const input = document.querySelector<HTMLInputElement>(".plugin-panel-head input")!;
  input.value = "demo-x";
  clickButton("安装");
  await tick();
  const err = document.querySelector<HTMLElement>(".plugin-error")!;
  expect(err.hidden).toBe(false);
  expect(err.textContent).toContain("404");

  // 同一面板上的成功操作（外置行停用）：错误行是跨 render 复用的同一元素，
  // 不清则陈旧失败常驻，用户无法判断当前状态。
  toggles()[1].click();
  await tick();
  expect(deactivateExternal).toHaveBeenCalledWith("demo");
  expect(err.hidden).toBe(true);
  expect(err.textContent).toBe("");
});

test("面板: Tab/Shift+Tab 圈禁焦点，Esc 关闭后归还打开按钮", async () => {
  const f = fakePlugins();
  const slots = {
    register: (_s: string, render: (el: HTMLElement) => void) => {
      render(document.body);
      return () => {};
    },
  };
  apply({ plugins: f.plugins, slots, windows: f.windows } as never, {});
  const openPanelBtn = document.querySelector<HTMLButtonElement>("button")!;
  openPanelBtn.focus();
  openPanelBtn.click();
  await tick();

  const box = document.querySelector<HTMLElement>(".plugin-panel-box")!;
  const focusable = [...box.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])")];
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  expect(document.activeElement).toBe(first);

  first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(last);

  last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(first);

  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(document.querySelector(".plugin-panel")).toBeNull();
  expect(document.activeElement).toBe(openPanelBtn);
});

test("面板: readManifest 失败内联显示，不 unhandled rejection", async () => {
  const f = fakePlugins();
  f.plugins.readManifest = vi.fn().mockRejectedValue(new Error("清单不见了"));
  await openPanel(f);
  const err = document.querySelector<HTMLElement>(".plugin-error");
  expect(err?.textContent).toContain("操作失败：清单不见了");
});
