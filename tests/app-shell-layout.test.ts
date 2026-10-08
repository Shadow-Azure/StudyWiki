// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_WIDTH, MAIN_MIN, clampRailWidth, defaultShellLayout, loadShellLayout,
  maxRailWidth, normalizeShellLayout, saveShellLayout, SHELL_LAYOUT_KEY,
  type ShellLayoutState,
} from "../src/plugins/app-shell/layout";

class MemoryStorage {
  readonly entries = new Map<string, string>();

  constructor(entries: Array<[string, string]> = []) {
    for (const [key, value] of entries) this.entries.set(key, value);
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

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

  it("clamps persisted widths and replaces invalid open flags independently", () => {
    const state = normalizeShellLayout({
      version: 1,
      files: { width: 180, open: "yes" },
      agent: { width: 900, open: 0 },
    }, 1180);
    expect(state.files).toEqual({ width: 220, open: true });
    expect(state.agent).toEqual({ width: 520, open: true });
  });

  it("reads corrupt storage as defaults and writes through setItem", () => {
    const store = new MemoryStorage([[SHELL_LAYOUT_KEY, "{bad"]]);
    expect(loadShellLayout(1180, store).files.width).toBe(252);
    saveShellLayout(valid(), store);
    expect(JSON.parse(store.entries.get(SHELL_LAYOUT_KEY)!)).toEqual(valid());
  });

  it("uses defaults when storage is absent", () => {
    expect(loadShellLayout(1180, null)).toEqual(defaultShellLayout());
  });

  it("keeps saving non-fatal when setItem throws", () => {
    let calls = 0;
    const store = {
      getItem: () => null,
      setItem: () => {
        calls += 1;
        throw new Error("quota exceeded");
      },
    };
    expect(() => saveShellLayout(valid(), store)).not.toThrow();
    expect(calls).toBe(1);
  });
});
