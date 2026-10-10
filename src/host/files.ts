import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { createEmitter } from "./emitter";
import type { FileNode } from "../types";

/** Parameters for the agent grep tool; `path` must already be read-authorized. */
export interface GrepRequest {
  pattern: string;
  path: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

/** One grep hit, with nearby context lines and no line-number prefixes. */
export interface GrepMatch {
  path: string;
  line: number;
  text: string;
  before: string[];
  after: string[];
}

/** Agent grep output; `truncated` means the result limit stopped the search. */
export interface GrepResult {
  matches: GrepMatch[];
  truncated: boolean;
}

/** Arguments accepted by Tauri 2 raw/JSON invoke; limited to what the files commands use. */
export type FilesInvokeArgs = Record<string, unknown> | Uint8Array;

/** Tauri raw-invoke options relevant to the files service. */
export interface FilesInvokeOptions {
  headers: Record<string, string>;
}

/** Tauri bindings this service wraps; injectable so tests fake exactly one seam. */
export interface FilesDeps {
  invoke: (cmd: string, args?: FilesInvokeArgs, options?: FilesInvokeOptions) => Promise<unknown>;
  listen: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  openDialog: () => Promise<string | null>;
  assetUrl: (path: string) => string;
}

/** Accept Tauri raw bytes while preserving numeric-array mocks for test compatibility. */
function normalizeRawBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  throw new TypeError("Tauri IPC response is not raw bytes");
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

  /** Whole-file binary read — the Excel service's byte source. */
  async readBinary(path: string): Promise<Uint8Array> {
    const bytes = await this.#deps.invoke("read_binary_file", new Uint8Array(0), {
      headers: { "x-studywiki-path": encodeURIComponent(path) },
    });
    return normalizeRawBytes(bytes);
  }

  /** Whole-file binary write; Rust writes atomically and broadcasts the change. */
  writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    return this.#deps.invoke("write_binary_file", bytes, {
      headers: { "x-studywiki-path": encodeURIComponent(path) },
    }) as Promise<void>;
  }

  /** Run the agent grep tool over a read-authorized path; coded errors pass through unwrapped. */
  grepFiles(req: GrepRequest): Promise<GrepResult> {
    return this.#deps.invoke("grep_files", { req }) as Promise<GrepResult>;
  }

  /** Add an existing path to this window's dynamic read-only grants; write access stays root-only. */
  authorizeReadPath(path: string): Promise<void> {
    return this.#deps.invoke("authorize_read_path", { path }) as Promise<void>;
  }

  /** List session JSONL paths for the opened library; Rust migrates legacy in-root files. */
  agentSessionPaths(root: string): Promise<string[]> {
    return this.#deps.invoke("agent_session_paths", { root }) as Promise<string[]>;
  }

  /** Allocate the user-level per-root path for one new session. */
  agentSessionPath(root: string, id: string): Promise<string> {
    return this.#deps.invoke("agent_session_path", { root, id }) as Promise<string>;
  }

  /** Read one agent session file from the user-level per-root session domain. */
  readAgentSessionFile(path: string): Promise<string> {
    return this.#deps.invoke("read_agent_session_file", { path }) as Promise<string>;
  }

  /** Atomically rewrite one agent session file in the user-level per-root session domain. */
  writeAgentSessionFile(path: string, contents: string): Promise<void> {
    return this.#deps.invoke("write_agent_session_file", { path, contents }) as Promise<void>;
  }

  /** Append one newline-free JSONL session event inside the original authorized root. */
  appendSessionEvent(path: string, line: string): Promise<void> {
    return this.#deps.invoke("append_session_event", { path, line }) as Promise<void>;
  }

  /** Delete an agent session file confined to the user-level per-root session domain; success does not broadcast. */
  deleteSessionFile(path: string): Promise<void> {
    return this.#deps.invoke("delete_session_file", { path }) as Promise<void>;
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
