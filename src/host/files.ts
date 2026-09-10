import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { createEmitter } from "./emitter";
import type { FileNode } from "../types";

/** Tauri bindings this service wraps; injectable so tests fake exactly one seam. */
export interface FilesDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  openDialog: () => Promise<string | null>;
  assetUrl: (path: string) => string;
}

/** Real Tauri bindings (the only sanctioned import site for these). */
export const defaultFilesDeps: FilesDeps = {
  invoke,
  listen,
  openDialog: () => open({ directory: true, multiple: false }) as Promise<string | null>,
  assetUrl: convertFileSrc,
};

/** Window-scoped service: the only file channel plugins may use. */
export class FilesService {
  readonly #deps: FilesDeps;
  readonly #events = createEmitter<{ "fs-changed": string }>();
  #unlisten: (() => void) | null = null;

  constructor(deps: FilesDeps = defaultFilesDeps) {
    this.#deps = deps;
  }

  /** Bridge Rust `fs://changed` broadcasts into this window. */
  async start(): Promise<void> {
    this.#unlisten = await this.#deps.listen("fs://changed", (e) =>
      this.#events.emit("fs-changed", String(e.payload)));
  }

  /** Stop bridging (window teardown). */
  stop(): void {
    this.#unlisten?.();
    this.#unlisten = null;
  }

  /** Full recursive tree of an opened root. */
  readTree(root: string): Promise<FileNode[]> {
    return this.#deps.invoke("read_tree", { root }) as Promise<FileNode[]>;
  }

  /** Whole-file UTF-8 read — the document data source. */
  readText(path: string): Promise<string> {
    return this.#deps.invoke("read_text_file", { path }) as Promise<string>;
  }

  /** Whole-file write; Rust broadcasts the change (including back to us). */
  writeText(path: string, contents: string): Promise<void> {
    return this.#deps.invoke("write_text_file", { path, contents }) as Promise<void>;
  }

  /** System folder picker; null when cancelled. */
  pickFolder(): Promise<string | null> {
    return this.#deps.openDialog();
  }

  /** Asset-protocol URL for local media playback. */
  assetUrl(path: string): string {
    return this.#deps.assetUrl(path);
  }

  /** Fired with the changed file path on every fs://changed broadcast. */
  onFsChanged(fn: (path: string) => void): () => void {
    return this.#events.on("fs-changed", fn);
  }
}
