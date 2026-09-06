/** A playable or readable file inside the opened library. */
export type LibraryEntry = {
  /** File name including extension. */
  name: string;
  /** Absolute path, used for reads and asset-protocol URLs. */
  path: string;
  /** Dispatches the viewer: markdown or video. */
  kind: "markdown" | "video";
};
