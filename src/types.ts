/** One node of the opened library's file tree. */
export type FileNode = {
  /** File or directory name including extension. */
  name: string;
  /** Absolute path — used for reads/writes and asset-protocol URLs. */
  path: string;
  /** Dispatches handling: directories expand; markdown/video open; other lists only. */
  kind: "dir" | "markdown" | "video" | "other";
  /** Present only for directories. */
  children?: FileNode[];
};

/** @deprecated 旧名，Task 7 重写 main.ts 时删除。 */
export type LibraryEntry = FileNode;
