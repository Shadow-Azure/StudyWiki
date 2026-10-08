/** Shell layout geometry and local UI-state persistence. DOM is owned by index.ts. */

/** Identifies which collapsible shell rail a geometry operation targets. */
export type RailSide = "files" | "agent";

/** One collapsible rail's persisted geometry. */
export interface RailLayout {
  /** Rendered width while open, in CSS px. */
  width: number;
  /** False means zero-width but still mounted. */
  open: boolean;
}

/** Versioned shell layout state shared by persistence and cross-window updates. */
export interface ShellLayoutState {
  /** Persistence schema version; readers reject all other values. */
  version: 1;
  /** Library rail geometry. */
  files: RailLayout;
  /** Agent rail geometry. */
  agent: RailLayout;
}

/** Local-only UI preference; not a settings.json field. */
export const SHELL_LAYOUT_KEY = "studywiki.shell-layout.v1";

/** Fixed Activity Rail width reserved by every viewport calculation, in CSS px. */
export const ACTIVITY_WIDTH = 54;

/** Minimum readable main-pane width preserved while either rail is open, in CSS px. */
export const MAIN_MIN = 340;

/** Increment used by keyboard rail resizing, in CSS px. */
export const RAIL_KEYBOARD_STEP = 16;

const RAIL_LIMITS = {
  files: { min: 220, max: 440, fallback: 252 },
  agent: { min: 300, max: 520, fallback: 320 },
} as const;

/** Default reopened Files rail width, in CSS px. */
export const FILES_DEFAULT = RAIL_LIMITS.files.fallback;

/** Default reopened Agent rail width, in CSS px. */
export const AGENT_DEFAULT = RAIL_LIMITS.agent.fallback;

/**
 * Return the widest rail width that preserves Activity Rail and Reader minimums.
 * @param side — rail whose side-specific minimum and maximum apply.
 * @param viewport — current shell viewport width, in CSS px.
 * @param otherOpenWidth — rendered width of the other rail while open; callers pass 0 for a closed rail.
 * @returns the viewport-constrained width, never below the requested rail's minimum.
 */
export function maxRailWidth(side: RailSide, viewport: number, otherOpenWidth: number): number {
  const limits = RAIL_LIMITS[side];
  const available = Math.floor(viewport - ACTIVITY_WIDTH - otherOpenWidth - MAIN_MIN);
  return Math.max(limits.min, Math.min(limits.max, available));
}

/**
 * Clamp a requested width into side limits and the current viewport concession.
 * @param side — rail whose limits apply.
 * @param next — requested width; non-finite values use that rail's fallback.
 * @param viewport — current shell viewport width, in CSS px.
 * @param otherOpenWidth — rendered width of the other rail while open; defaults to 0.
 * @returns the integer width to paint.
 */
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

/**
 * Create the default shell layout.
 * @returns both rails open at their prototype widths.
 */
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

/**
 * Normalize persisted or cross-window input; invalid fields fall back individually.
 * @param value — untrusted persisted JSON or cross-window layout value.
 * @param _viewport — reserved for callers that repaint immediately; normalization applies absolute rail limits only.
 * @returns a complete version-1 layout; live shell callers must still re-clamp against the viewport.
 */
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

/**
 * Read localStorage without failing for absence, storage errors, or corruption.
 * @param viewport — viewport value forwarded to normalization; defaults to the current window.
 * @param storage — read source; null or a throwing/incompatible storage produces defaults.
 * @returns normalized persisted state or the default layout.
 */
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

/**
 * Persist layout UI state without failing for quota or private-mode storage errors.
 * @param state — complete shell layout to serialize.
 * @param storage — write sink; null disables persistence.
 */
export function saveShellLayout(
  state: ShellLayoutState,
  storage: Pick<Storage, "setItem"> | null = globalThis.localStorage,
): void {
  try {
    storage?.setItem(SHELL_LAYOUT_KEY, JSON.stringify(state));
  } catch {
    /* UI layout is non-authoritative; continue with in-memory state. */
  }
}
