/** Shell layout geometry and local UI-state persistence. DOM is owned by index.ts. */

export type RailSide = "files" | "agent";

/** One collapsible rail's persisted geometry. */
export interface RailLayout {
  /** Rendered width while open, in CSS px. */
  width: number;
  /** False means zero-width but still mounted. */
  open: boolean;
}

/** Versioned shell layout state. */
export interface ShellLayoutState {
  version: 1;
  files: RailLayout;
  agent: RailLayout;
}

/** Local-only UI preference; not a settings.json field. */
export const SHELL_LAYOUT_KEY = "studywiki.shell-layout.v1";
export const ACTIVITY_WIDTH = 54;
export const MAIN_MIN = 340;
export const RAIL_KEYBOARD_STEP = 16;

const RAIL_LIMITS = {
  files: { min: 220, max: 440, fallback: 252 },
  agent: { min: 300, max: 520, fallback: 320 },
} as const;

/** Return the widest rail that still preserves Activity Rail and Reader minimums. */
export function maxRailWidth(side: RailSide, viewport: number, otherOpenWidth: number): number {
  const limits = RAIL_LIMITS[side];
  const available = Math.floor(viewport - ACTIVITY_WIDTH - otherOpenWidth - MAIN_MIN);
  return Math.max(limits.min, Math.min(limits.max, available));
}

/** Clamp a requested width into side limits and the current viewport concession. */
export function clampRailWidth(
  side: RailSide,
  next: number,
  viewport: number,
  otherOpenWidth = 0,
): number {
  if (!Number.isFinite(next)) return RAIL_LIMITS[side].fallback;
  const limits = RAIL_LIMITS[side];
  return Math.round(Math.min(maxRailWidth(side, viewport, otherOpenWidth), Math.max(limits.min, next)));
}

/** Default state is both rails open at prototype widths. */
export function defaultShellLayout(): ShellLayoutState {
  return {
    version: 1,
    files: { width: RAIL_LIMITS.files.fallback, open: true },
    agent: { width: RAIL_LIMITS.agent.fallback, open: true },
  };
}

/** Absolute rail clamp used before the live shell applies viewport concession. */
const clampAbsolute = (side: RailSide, next: unknown): number => {
  const limits = RAIL_LIMITS[side];
  const value = typeof next === "number" && Number.isFinite(next) ? next : limits.fallback;
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)));
};

/** Normalize persisted or cross-window input; invalid fields fall back individually. */
export function normalizeShellLayout(value: unknown, _viewport = window.innerWidth): ShellLayoutState {
  const fallback = defaultShellLayout();
  if (typeof value !== "object" || value === null) return fallback;
  const input = value as Record<string, Record<string, unknown>>;
  if ((input as Record<string, unknown>).version !== 1) return fallback;
  const rail = (side: RailSide): RailLayout => ({
    width: clampAbsolute(side, input[side]?.width),
    open: typeof input[side]?.open === "boolean" ? input[side].open as boolean : true,
  });
  return { version: 1, files: rail("files"), agent: rail("agent") };
}

/** Read localStorage; absence, throw, or corruption all produce defaults. */
export function loadShellLayout(
  viewport = window.innerWidth,
  storage: Pick<Storage, "getItem"> | null = globalThis.localStorage,
): ShellLayoutState {
  try {
    return normalizeShellLayout(JSON.parse(storage?.getItem(SHELL_LAYOUT_KEY) ?? "null"), viewport);
  } catch {
    return normalizeShellLayout(null, viewport);
  }
}

/** Persist atomically enough for UI state; quota/private-mode failures are non-fatal. */
export function saveShellLayout(
  state: ShellLayoutState,
  storage: Pick<Storage, "setItem"> | null = globalThis.localStorage,
): void {
  try {
    const testStore = storage as (Pick<Storage, "setItem"> & {
      set?: (key: string, value: string) => void;
    }) | null;
    if (typeof testStore?.setItem === "function") {
      testStore.setItem(SHELL_LAYOUT_KEY, JSON.stringify(state));
    } else if (typeof testStore?.set === "function") {
      testStore.set(SHELL_LAYOUT_KEY, JSON.stringify(state));
    }
  } catch {
    /* UI layout is non-authoritative; continue with in-memory state. */
  }
}
