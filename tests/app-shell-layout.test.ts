// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_WIDTH, MAIN_MIN, clampRailWidth, loadShellLayout,
  maxRailWidth, normalizeShellLayout, saveShellLayout, SHELL_LAYOUT_KEY,
  type ShellLayoutState,
} from "../src/plugins/app-shell/layout";

describe("shell layout geometry", () => {
  it("keeps activity rail and reader minimum while clamping either rail", () => {
    expect(ACTIVITY_WIDTH).toBe(54);
    expect(MAIN_MIN).toBe(340);
    expect(maxRailWidth("files", 1180, 320)).toBe(440);
    expect(maxRailWidth("agent", 1180, 252)).toBe(520);
    expect(clampRailWidth("files", 180, 1180, 320)).toBe(220);
    expect(clampRailWidth("files", 900, 1180, 320)).toBe(440);
    expect(clampRailWidth("agent", 900, 1180, 252)).toBe(520);
  });
});

describe("shell layout persistence", () => {
  const valid = (): ShellLayoutState => ({
    version: 1,
    files: { width: 318, open: false },
    agent: { width: 410, open: true },
  });

  it("normalizes valid state and falls back for malformed state", () => {
    expect(normalizeShellLayout({
      version: 1,
      files: { width: 318.4, open: false },
      agent: { width: 410, open: true },
    }, 1180)).toEqual(valid());
    expect(normalizeShellLayout(null, 1180)).toEqual(normalizeShellLayout({ version: 2 }, 1180));
    expect(normalizeShellLayout({ version: 1, files: { width: "x" } }, 1180).files.width).toBe(252);
  });

  it("reads corrupt storage as defaults and writes normalized JSON", () => {
    const store = new Map<string, string>([[SHELL_LAYOUT_KEY, "{bad"]]);
    expect(loadShellLayout(1180, store as unknown as Storage).files.width).toBe(252);
    saveShellLayout(valid(), store as unknown as Storage);
    expect(JSON.parse(store.get(SHELL_LAYOUT_KEY)!).files.width).toBe(318);
  });
});
