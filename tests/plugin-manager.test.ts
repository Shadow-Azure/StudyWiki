// @vitest-environment jsdom
import { expect, test, vi, beforeEach } from "vitest";
import { apply } from "../src/plugins/plugin-manager";
import { computePanelRows, withEnabled, withoutRow } from "../src/plugins/plugin-manager/model";
import type { Manifest } from "../src/loader/manifest";

// 同文件的 DOM 测试共享一个 jsdom document：上一用例残留的顶栏按钮/面板会让
// 下一用例的 querySelector 点到旧 ctx 的节点，先清场保证用例间互不污染。
beforeEach(() => {
  document.body.replaceChildren();
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
  const rows = computePanelRows(m, entries, [{ id: "ext:demo", reason: "入口导出缺 apply" }]);
  expect(rows[0]).toEqual({ id: "app-shell", externalName: null, enabled: true, version: null, problem: null, removable: false });
  expect(rows[1]).toMatchObject({ externalName: "demo", version: "1.2.0", problem: "入口导出缺 apply", removable: true });
  expect(rows[2]).toMatchObject({ externalName: "gone", problem: "插件目录缺失", enabled: false, removable: true });
});

test("model: 开关与移除是纯变换", () => {
  const m = manifest([["a", true], ["ext:b", false]]);
  expect(withEnabled(m, "a", false).plugins[0].enabled).toBe(false);
  expect(withoutRow(m, "ext:b").plugins.map((r) => r.id)).toEqual(["a"]);
});

function fakePlugins() {
  const written: string[] = [];
  return {
    written,
    plugins: {
      readManifest: vi.fn(async () =>
        JSON.stringify(manifest([["app-shell", true], ["ext:demo", true]]))),
      list: vi.fn(async () => [
        { name: "demo", version: "1.0.0", apiVersion: 1, entry: "index.js", problem: null },
      ]),
      bootBroken: [] as Array<{ id: string; reason: string }>,
      writeManifest: vi.fn(async (m: Manifest) => {
        written.push(JSON.stringify(m));
      }),
      remove: vi.fn(async () => {}),
      install: vi.fn(async () => "demo"),
      importFromTgz: vi.fn(async () => null),
    },
  };
}

test("面板: 列行 + 开关写清单 + 移除走 ctx.plugins + 重启提示", async () => {
  const f = fakePlugins();
  const slots = {
    register: (_s: string, render: (el: HTMLElement) => void) => {
      render(document.body);
      return () => {};
    },
  };
  apply({ plugins: f.plugins, slots } as never, {});
  document.querySelector<HTMLButtonElement>("button")!.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".plugin-panel")).not.toBeNull();
  expect(document.querySelectorAll(".plugin-row").length).toBe(2);

  // 开关内置行：writeManifest 收到 enabled=false + 重启提示可见
  const toggle = document.querySelectorAll<HTMLInputElement>(".plugin-row input[type=checkbox]")[0];
  toggle.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(JSON.parse(f.written[0]).plugins[0].enabled).toBe(false);
  expect(document.querySelector<HTMLElement>(".plugin-restart-hint")!.hidden).toBe(false);

  // 移除外置行：remove + 清单过滤该行
  document.querySelectorAll<HTMLButtonElement>(".plugin-row button")[0].click();
  await new Promise((r) => setTimeout(r, 0));
  expect(f.plugins.remove).toHaveBeenCalledWith("demo");
  expect(JSON.parse(f.written.at(-1)!).plugins.map((r: { id: string }) => r.id)).toEqual(["app-shell"]);
});

test("面板: 安装失败内联显示错误（fail-loud 不静默）", async () => {
  const f = fakePlugins();
  f.plugins.install = vi.fn(async () => {
    throw new Error("查 registry demo-x 失败：404");
  });
  const slots = {
    register: (_s: string, render: (el: HTMLElement) => void) => {
      render(document.body);
      return () => {};
    },
  };
  apply({ plugins: f.plugins, slots } as never, {});
  document.querySelector<HTMLButtonElement>("button")!.click();
  await new Promise((r) => setTimeout(r, 0));
  const input = document.querySelector<HTMLInputElement>(".plugin-panel-head input")!;
  input.value = "demo-x";
  [...document.querySelectorAll<HTMLButtonElement>(".plugin-panel-head button")]
    .find((b) => b.textContent === "安装")!.click();
  await new Promise((r) => setTimeout(r, 0));
  const err = document.querySelector<HTMLElement>(".plugin-error");
  expect(err).not.toBeNull();
  expect(err!.textContent).toContain("demo-x");
});

test("面板: readManifest 失败内联显示，不 unhandled rejection", async () => {
  const f = fakePlugins();
  f.plugins.readManifest = vi.fn().mockRejectedValue(new Error("清单不见了"));
  const slots = {
    register: (_s: string, render: (el: HTMLElement) => void) => {
      render(document.body);
      return () => {};
    },
  };
  apply({ plugins: f.plugins, slots } as never, {});
  document.querySelector<HTMLButtonElement>("button")!.click();
  await new Promise((r) => setTimeout(r, 0));
  const err = document.querySelector<HTMLElement>(".plugin-error");
  expect(err?.textContent).toContain("操作失败：清单不见了");
});
