/** One node of the opened library's file tree. */
export type FileNode = {
  /** File or directory name including extension. */
  name: string;
  /** Absolute path — used for reads/writes and asset-protocol URLs. */
  path: string;
  /** Dispatches handling: directories expand; markdown/video/excel open; other lists only. */
  kind: "dir" | "markdown" | "video" | "excel" | "other";
  /** Present only for directories. */
  children?: FileNode[];
};
