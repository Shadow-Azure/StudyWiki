// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/doc-excel";

function workbook() {
  return {
    worksheets: [{
      name: "一",
      rowCount: 1,
      columnCount: 2,
      model: { merges: [] },
      getColumn: () => ({ width: 10 }),
      eachRow: (_o: never, onRow: any) => onRow({
        eachCell: (_o: never, onCell: any) => {
          onCell({ text: "A", style: { font: { bold: true }, fill: { fgColor: { argb: "FF112233" } } } }, 1);
          onCell({ text: "B", style: {} }, 2);
        },
      }, 1),
    }, {
      name: "二",
      rowCount: 0,
      columnCount: 0,
      model: { merges: [] },
      getColumn: () => ({}),
      eachRow: () => {},
    }],
  };
}

function harness(wb: unknown = workbook()) {
  let opened!: (f: unknown) => void;
  const workspace = {
    activeFile: null as unknown,
    events: { on: (_k: string, fn: (f: unknown) => void) => { opened = (f: unknown) => { workspace.activeFile = f; fn(f); }; return () => {}; } },
  };
  const excel = { read: vi.fn(async () => wb) };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ excel, workspace, slots } as never, {});
  return { opened, excel };
}

test("DOM：渲染 sheet 页签、样式与单元格；可切换 sheet", async () => {
  const { opened } = harness();
  await opened({ name: "a.xlsx", path: "/x/a.xlsx", kind: "excel" });
  expect(document.querySelector(".excel-tabs")?.textContent).toContain("一二");
  const cell = document.querySelector<HTMLElement>('[data-address="A1"]');
  expect(cell?.textContent).toBe("A");
  expect(cell?.style.fontWeight).toBe("700");
  expect(cell?.style.backgroundColor).toBe("rgb(17, 34, 51)");
  document.querySelectorAll<HTMLButtonElement>(".excel-tab")[1].click();
  expect(document.querySelector(".excel-empty")?.textContent).toContain("此 sheet 为空");
});

test("DOM：非 excel 清空；读取失败显示错误面板", async () => {
  const { opened } = harness();
  await opened({ name: "a.md", path: "/x/a.md", kind: "markdown" });
  expect(document.querySelector(".excel-viewer")).toBeNull();
  const failing = { read: vi.fn(async () => { throw new Error("bad zip"); }) };
  let open!: (f: unknown) => void;
  const workspace = { activeFile: null, events: { on: (_k: string, fn: (f: unknown) => void) => { open = fn; return () => {}; } } };
  apply({ excel: failing, workspace, slots: { register: (_s: string, r: (el: HTMLElement) => void) => { r(document.body); return () => {}; } } } as never, {});
  await open({ name: "bad.xlsx", path: "/x/bad.xlsx", kind: "excel" });
  await vi.waitFor(() => expect(document.querySelector(".doc-error")?.textContent).toContain("读取失败"));
});
