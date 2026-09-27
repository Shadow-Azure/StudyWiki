import type { FileNode } from "../types";
import { createEmitter, type Emitter } from "./emitter";

/** Change events emitted by the workspace. */
export type WorkspaceEvents = {
  "root-changed": string | null;
  "file-opened": FileNode | null;
};

/** One registered switch guard. */
interface SwitchGuard {
  isDirty(): boolean;
  confirmDiscard(): Promise<boolean>;
}

/** Plugin-facing workspace surface: reads, events, guarded opens, and guard registration.
 * Root mutation stays on the host controller and is reachable only through WindowsService. */
export interface WorkspaceFacade {
  /** The opened folder, or null in welcome state. */
  readonly root: string | null;
  /** The currently open document, if any. */
  readonly activeFile: FileNode | null;
  /** Root and active-file change events. */
  readonly events: Emitter<WorkspaceEvents>;
  /** Make `file` active after consulting switch guards.
   * @returns True when opened (or already active); false when rejected. */
  openFile(file: FileNode): Promise<boolean>;
  /** Register a guard consulted before file/root switches.
   * @param isDirty Returns true when this guard owns unsaved work.
   * @param confirmDiscard Resolves true to discard the unsaved work.
   * @returns Disposer removing the guard. */
  guardSwitch(isDirty: () => boolean, confirmDiscard: () => Promise<boolean>): () => void;
}

/** Window-scoped workspace state: which root is open, which file is active. */
export class WorkspaceService {
  readonly facade: WorkspaceFacade;
  #root: string | null = null;
  #activeFile: FileNode | null = null;
  readonly #switchGuards = new Set<SwitchGuard>();
  readonly events: Emitter<WorkspaceEvents> = createEmitter<WorkspaceEvents>();

  constructor() {
    const service = this;
    this.facade = Object.freeze({
      get root() { return service.root; },
      get activeFile() { return service.activeFile; },
      get events() { return service.events; },
      openFile: (file: FileNode) => service.openFile(file),
      guardSwitch: (isDirty: () => boolean, confirmDiscard: () => Promise<boolean>) =>
        service.guardSwitch(isDirty, confirmDiscard),
    });
  }

  /** The opened folder, or null in welcome state. */
  get root(): string | null {
    return this.#root;
  }

  /** The currently open document, if any. */
  get activeFile(): FileNode | null {
    return this.#activeFile;
  }

  /** Register a guard consulted before switching the active file or root.
   * @param isDirty Returns true when this guard owns unsaved work.
   * @param confirmDiscard Resolves true to discard the unsaved work.
   * @returns Disposer removing the guard. */
  guardSwitch(isDirty: () => boolean, confirmDiscard: () => Promise<boolean>): () => void {
    const guard: SwitchGuard = { isDirty, confirmDiscard };
    this.#switchGuards.add(guard);
    return () => this.#switchGuards.delete(guard);
  }

  /** Ask every registered switch guard whether unsaved work may be discarded.
   * @returns True when the pending switch may proceed. */
  async confirmSwitch(): Promise<boolean> {
    for (const guard of this.#switchGuards) {
      if (!guard.isDirty()) continue;
      if (!(await guard.confirmDiscard())) return false;
    }
    return true;
  }

  #applyRoot(root: string | null): void {
    this.#root = root;
    this.#activeFile = null;
    this.events.emit("root-changed", root);
    this.events.emit("file-opened", null);
  }

  /** Switch the opened folder (null = welcome state); clears the active file.
   * @returns True when the switch happened; false when a guard rejected it. */
  async setRoot(root: string | null): Promise<boolean> {
    if (!(await this.confirmSwitch())) return false;
    this.#applyRoot(root);
    return true;
  }

  /** Apply a root switch after {@link confirmSwitch} has already approved it.
   * Host-only seam for the authorize-before-switch {@link WindowsService.changeRoot} path. */
  forceSetRoot(root: string | null): void {
    this.#applyRoot(root);
  }

  /** Make `file` the active document; viewers subscribe to file-opened.
   * @returns True when the file opened; false when a guard rejected the switch. */
  async openFile(file: FileNode): Promise<boolean> {
    if (file.path === this.#activeFile?.path) {
      // Reopening the active dirty document is a no-op: no repeated prompt and no silent reload.
      if ([...this.#switchGuards].some((guard) => guard.isDirty())) return true;
    } else if (!(await this.confirmSwitch())) return false;
    this.#activeFile = file;
    this.events.emit("file-opened", file);
    return true;
  }
}
