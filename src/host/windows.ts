import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WorkspaceService } from "./workspace";

/** Tauri bindings this service wraps; injectable for tests. */
export interface WindowsDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  currentLabel: () => string;
  onCloseRequested: (cb: (e: { preventDefault(): void }) => void | Promise<void>) => Promise<() => void>;
  confirmDialog: (message: string) => Promise<boolean>;
  destroy: () => Promise<void>;
}

/** Real Tauri bindings. */
export const defaultWindowsDeps: WindowsDeps = {
  invoke,
  currentLabel: () => getCurrentWebviewWindow().label,
  onCloseRequested: (cb) => getCurrentWebviewWindow().onCloseRequested(cb),
  confirmDialog: (message) => confirm(message, { title: "StudyWiki" }),
  destroy: () => getCurrentWebviewWindow().destroy(),
};

/** Window-scoped service: window identity, creation, close guarding. */
export class WindowsService {
  readonly #deps: WindowsDeps;
  #workspace: WorkspaceService | null = null;
  #guards = new Map<number, { isDirty: () => boolean; confirmDiscard: () => Promise<boolean> }>();
  #nextGuardId = 0;
  #offNativeClose: (() => void | Promise<void>) | null = null;
  #closing = false;

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
   * here — Activity Rail button, welcome-state button, boot re-grant — so the
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

  /** Mark this window's close listener as ready; the native shell can now
   * synchronously cancel native close requests before asking the webview. */
  async markCloseGuardReady(): Promise<void> {
    await this.#syncNativeReady();
  }

  /** Force this window's native close-guard flag, bypassing live state. */
  async #setNativeReady(ready: boolean): Promise<void> {
    await this.#deps.invoke("set_close_guard_ready", { label: this.currentLabel(), ready });
  }

  /** Arm the native shell only while the aggregated listener is installed, so
   * startup, guard-less and already-confirmed windows keep native direct close. */
  async #syncNativeReady(): Promise<void> {
    await this.#setNativeReady(this.#offNativeClose !== null);
  }

  /** Aggregate document guards into one close decision. Every native request
   * is synchronously cancelled first; only when every dirty guard confirms the
   * discard does this method close through the destroy seam. */
  async guardClose(isDirty: () => boolean, confirmDiscard: () => Promise<boolean>): Promise<() => void> {
    const id = this.#nextGuardId++;
    this.#guards.set(id, { isDirty, confirmDiscard });
    if (!this.#offNativeClose) {
      this.#offNativeClose = await this.#deps.onCloseRequested((e) => void this.#handleClose(e));
      (globalThis as typeof globalThis & { __studywikiNativeClose?: () => void }).__studywikiNativeClose = () => {
        void this.#handleClose({ preventDefault: () => {} });
      };
      await this.#syncNativeReady();
    }
    return async () => {
      this.#guards.delete(id);
      if (this.#guards.size === 0 && this.#offNativeClose) {
        const off = this.#offNativeClose;
        this.#offNativeClose = null;
        await off();
        delete (globalThis as typeof globalThis & { __studywikiNativeClose?: () => void }).__studywikiNativeClose;
        await this.#syncNativeReady();
      }
    };
  }

  async #handleClose(e: { preventDefault(): void }): Promise<void> {
    e.preventDefault();
    if (this.#closing) return;
    this.#closing = true;
    try {
      for (const guard of this.#guards.values()) {
        if (!guard.isDirty()) continue;
        if (!(await guard.confirmDiscard())) return;
      }
      await this.#setNativeReady(false);
      await this.#deps.destroy();
    } finally {
      this.#closing = false;
    }
  }
}
