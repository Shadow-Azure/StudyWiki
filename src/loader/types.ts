/** Structural subset of the cordis plugin contract every built-in uses:
 * the (name, inject, apply) triad with an optional cleanup return. */
export interface PluginModule {
  /** Plugin id used by the manifest and audit output. */
  name: string;
  /** Service keys awaited before apply runs. */
  inject?: string[];
  /** Plugin body; returning a function makes all effects reversible. */
  apply(ctx: any, config: any): void | (() => void);
}
