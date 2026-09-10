import type { FileNode } from "../types";
import { createEmitter, type Emitter } from "./emitter";

/** Change events emitted by the workspace. */
export type WorkspaceEvents = {
  "root-changed": string | null;
  "file-opened": FileNode | null;
};

/** Window-scoped workspace state: which root is open, which file is active. */
export class WorkspaceService {
  #root: string | null = null;
  #activeFile: FileNode | null = null;
  readonly events: Emitter<WorkspaceEvents> = createEmitter<WorkspaceEvents>();

  /** The opened folder, or null in welcome state. */
  get root(): string | null {
    return this.#root;
  }

  /** The currently open document, if any. */
  get activeFile(): FileNode | null {
    return this.#activeFile;
  }

  /** Switch the opened folder (null = welcome state); clears the active file. */
  setRoot(root: string | null): void {
    this.#root = root;
    this.#activeFile = null;
    this.events.emit("root-changed", root);
    this.events.emit("file-opened", null);
  }

  /** Make `file` the active document; viewers subscribe to file-opened. */
  openFile(file: FileNode): void {
    this.#activeFile = file;
    this.events.emit("file-opened", file);
  }
}
