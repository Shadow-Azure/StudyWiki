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

function mergeWorkbook() {
  return {
    worksheets: [{
      name: "合并",
      rowCount: 80,
      columnCount: 2,
      model: { merges: ["A1:A10"] },
      getColumn: (column: number) => (column === 1 ? { width: 18 } : {}),
      eachRow: (_o: never, onRow: any) => onRow({
        eachCell: (_o: never, onCell: any) => {
          onCell({ text: "跨窗标题", style: { font: { bold: true }, fill: { fgColor: { argb: "FF112233" } } } }, 1);
        },
      }, 1),
    }],
  };
}

function scrollStep(scroll: HTMLElement, rows: number): void {
  scroll.scrollTop = 28 * rows;
  scroll.dispatchEvent(new Event("scroll"));
}

test("DOM：跨虚拟窗口的纵向合并渲染裁剪片段与稳定几何", async () => {
  document.body.replaceChildren();
  const { opened } = harness(mergeWorkbook());
  await opened({ name: "merge.xlsx", path: "/x/merge.xlsx", kind: "excel" });
  const scroll = document.querySelector<HTMLElement>(".excel-scroll");
  const topSpacer = document.querySelector<HTMLElement>(".excel-top-spacer");
  const bottomSpacer = document.querySelector<HTMLElement>(".excel-bottom-spacer");
  const grid = document.querySelector<HTMLElement>(".excel-grid");
  expect(scroll).not.toBeNull();
  expect(topSpacer).not.toBeNull();
  expect(bottomSpacer).not.toBeNull();
  expect(grid).not.toBeNull();
  if (!scroll || !topSpacer || !bottomSpacer || !grid) return;

  scrollStep(scroll, 5);
  const promoted = document.querySelector<HTMLElement>('[data-address="A3"]');
  expect(promoted?.textContent).toBe("跨窗标题");
  expect(promoted?.style.fontWeight).toBe("700");
  expect(promoted?.style.backgroundColor).toBe("rgb(17, 34, 51)");
  expect(promoted?.style.gridRow).toBe("1 / span 8");
  expect(promoted?.style.gridColumn).toBe("2 / span 1");
  expect(document.querySelector('[data-address="A1"]')).toBeNull();

  scrollStep(scroll, 12);
  const continuation = document.querySelector<HTMLElement>('[data-address="A10"]');
  expect(continuation?.textContent).toBe("跨窗标题");
  expect(continuation?.style.backgroundColor).toBe("rgb(17, 34, 51)");
  expect(continuation?.style.gridRow).toBe("1 / span 1");
  expect([...document.querySelectorAll<HTMLElement>(".excel-cell")].filter((cell) => cell.textContent === "跨窗标题")).toHaveLength(1);

  const top = Number.parseFloat(topSpacer.style.height);
  const bottom = Number.parseFloat(bottomSpacer.style.height);
  const trackMatch = /^repeat\((\d+), 28px\)$/.exec(grid.style.gridTemplateRows);
  expect(trackMatch).not.toBeNull();
  const visibleTracks = Number(trackMatch?.[1] ?? 0);
  expect(document.querySelectorAll(".excel-row")).toHaveLength(visibleTracks);
  expect((top + bottom) / 28 + visibleTracks + 1).toBe(81);
});

test("DOM：列宽使用显式逐列轨道", async () => {
  document.body.replaceChildren();
  const { opened } = harness(mergeWorkbook());
  await opened({ name: "widths.xlsx", path: "/x/widths.xlsx", kind: "excel" });
  const expected = "36px 152px 64px";
  expect(document.querySelector<HTMLElement>(".excel-grid")?.style.gridTemplateColumns).toBe(expected);
  expect(document.querySelector<HTMLElement>(".excel-header-row")?.style.gridTemplateColumns).toBe(expected);
});

test("DOM：迟到的 Excel 读取不能覆盖后打开的文档", async () => {
  document.body.replaceChildren();
  const oldWorkbook = { worksheets: [{ ...workbook().worksheets[0], name: "旧" }] };
  const newWorkbook = { worksheets: [{ ...workbook().worksheets[0], name: "新" }] };
  let resolveOld!: (value: unknown) => void;
  const read = vi.fn((path: string) => {
    if (path === "/x/old.xlsx") return new Promise((resolve) => { resolveOld = resolve; });
    return Promise.resolve(newWorkbook);
  });
  let opened!: (file: unknown) => void;
  const workspace = {
    activeFile: null as unknown,
    events: { on: (_k: string, fn: (f: unknown) => void) => { opened = fn; return () => {}; } },
  };
  apply({ excel: { read }, workspace, slots: { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } } } as never, {});

  opened({ name: "old.xlsx", path: "/x/old.xlsx", kind: "excel" });
  await vi.waitFor(() => expect(read).toHaveBeenCalledWith("/x/old.xlsx"));
  opened({ name: "new.xlsx", path: "/x/new.xlsx", kind: "excel" });
  await vi.waitFor(() => expect(read).toHaveBeenCalledWith("/x/new.xlsx"));
  resolveOld(oldWorkbook);
  await vi.waitFor(() => expect(document.querySelector(".excel-tab")?.textContent).toBe("新"));
  expect(document.querySelector(".excel-viewer")?.textContent).not.toContain("旧");
});

test("DOM：完全位于窗口下方的合并不产生片段或几何膨胀", async () => {
  document.body.replaceChildren();
  const belowMerge = mergeWorkbook();
  belowMerge.worksheets[0].model.merges = ["A50:A60"];
  belowMerge.worksheets[0].eachRow = () => {};
  const { opened } = harness(belowMerge);
  await opened({ name: "below.xlsx", path: "/x/below.xlsx", kind: "excel" });
  expect(document.querySelector('[data-address="A50"]')).toBeNull();
  expect(document.querySelector('[data-address="A60"]')).toBeNull();
  expect([...document.querySelectorAll<HTMLElement>(".excel-cell")]
    .filter((cell) => cell.textContent === "跨窗标题")).toHaveLength(0);
  const topSpacer = document.querySelector<HTMLElement>(".excel-top-spacer");
  const bottomSpacer = document.querySelector<HTMLElement>(".excel-bottom-spacer");
  const grid = document.querySelector<HTMLElement>(".excel-grid");
  expect(topSpacer?.style.height).toBe("0px");
  expect(bottomSpacer?.style.height).toBe("1792px");
  expect(grid?.style.gridTemplateRows).toBe("repeat(16, 28px)");
  expect(document.querySelectorAll(".excel-row")).toHaveLength(16);
  expect((Number.parseFloat(topSpacer?.style.height ?? "0") +
    Number.parseFloat(bottomSpacer?.style.height ?? "0")) / 28 + 16 + 1).toBe(81);
});
