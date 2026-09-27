import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WorkspaceService } from "./workspace";

/** Tauri bindings this service wraps; injectable for tests. */
export interface WindowsDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  currentLabel: () => string;
  onCloseRequested: (cb: (e: { preventDefault(): void }) => void) => Promise<() => void>;
  confirmDialog: (message: string) => Promise<boolean>;
}

/** Real Tauri bindings. */
export const defaultWindowsDeps: WindowsDeps = {
  invoke,
  currentLabel: () => getCurrentWebviewWindow().label,
  onCloseRequested: (cb) => getCurrentWebviewWindow().onCloseRequested(cb),
  confirmDialog: (message) => confirm(message, { title: "StudyWiki" }),
};

/** Window-scoped service: window identity, creation, close guarding. */
export class WindowsService {
  readonly #deps: WindowsDeps;
  #workspace: WorkspaceService | null = null;

  constructor(deps: WindowsDeps = defaultWindowsDeps) {
    this.#deps = deps;
  }

  /** This window's Tauri label. */
  currentLabel(): string {
    return this.#deps.currentLabel();
  }

  /** Create a new window, optionally opening `root`; returns the new label. */
  async create(root?: string): Promise<string> {
    return this.#deps.invoke("create_window", { root }) as Promise<string>;
  }

  /** Fetch this window's registered workspace root (null = welcome state). */
  async fetchRoot(label: string): Promise<string | null> {
    const state = await this.#deps.invoke("get_window_state", { label });
    return (state as string | null) ?? null;
  }

  /** Persist this window's workspace root Rust-side (registry upsert + asset
   * scope grant, recursive). Idempotent; also called at boot to re-grant. */
  async setRoot(label: string, root: string | null): Promise<void> {
    await this.#deps.invoke("set_window_root", { label, root });
  }

  /** Bind this window-scoped service to its private workspace controller.
   * @param workspace Host-owned WorkspaceService; never the plugin-facing facade. */
  bindWorkspace(workspace: WorkspaceService): void {
    this.#workspace = workspace;
  }

  /** Full root change in one call: Rust-side grant + registry upsert first
   * (fail-closed), then the workspace switch. Every root change goes through
   * here — topbar button, welcome-state button, boot re-grant — so the
   * grant-before-switch ordering is structural, not conventional. Passing
   * null clears the frontend only (no Rust call).
   * @returns True when the root changed; false when a workspace switch guard rejected it. */
  async changeRoot(root: string | null): Promise<boolean> {
    if (!this.#workspace) throw new Error("windows service is not bound to a workspace controller");
    const workspace = this.#workspace;
    if (!(await workspace.confirmSwitch())) return false;
    if (root !== null) await this.setRoot(this.currentLabel(), root);
    workspace.forceSetRoot(root);
    return true;
  }

  /** Native confirm dialog (close-guard prompt); true = proceed. */
  confirmDialog(message: string): Promise<boolean> {
    return this.#deps.confirmDialog(message);
  }

  /** Intercept close while `isDirty()` holds; `confirmDiscard` resolves true
   * to close anyway (discarding), false to cancel the close. */
  async guardClose(isDirty: () => boolean, confirmDiscard: () => Promise<boolean>): Promise<() => void> {
    return this.#deps.onCloseRequested(async (e) => {
      if (isDirty() && !(await confirmDiscard())) e.preventDefault();
    });
  }
}
