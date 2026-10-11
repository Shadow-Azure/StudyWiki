/** A dismissible surface registered by the window-wide layer stack. */
export interface ActiveLayer {
  /** Escape and shortcuts may ask this layer to close. */
  close(): void;
}

type ActiveLayerListener = () => void;

interface ActiveLayerEntry {
  readonly layer: object;
  readonly surface: ActiveLayer;
}

/**
 * Order dismissible surfaces so only the newest one consumes Escape. The
 * shared instance is per JavaScript window, matching browser UI ownership.
 */
export class ActiveLayerStack {
  readonly #layers: ActiveLayerEntry[] = [];
  readonly #listeners = new Set<ActiveLayerListener>();

  /** Register a surface and return an idempotent release function. */
  push(layer: object, surface: ActiveLayer): () => void {
    const entry: ActiveLayerEntry = { layer, surface };
    this.#layers.push(entry);
    this.#notify();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.#layers.lastIndexOf(entry);
      if (index !== -1) this.#layers.splice(index, 1);
      this.#notify();
    };
  }

  /** Whether this exact surface is the current Escape owner. */
  isActive(layer: object): boolean {
    return this.#layers.at(-1)?.layer === layer;
  }

  /** Whether any floating surface currently owns Escape. */
  get size(): number {
    return this.#layers.length;
  }

  /** Close only when `layer` owns the stack; report whether it consumed Escape. */
  escape(layer: object): boolean {
    const entry = this.#layers.at(-1);
    if (!entry || entry.layer !== layer) return false;
    this.#layers.pop();
    this.#notify();
    entry.surface.close();
    return true;
  }

  /** Observe push/release changes, for example to reveal a queued approval. */
  subscribe(listener: ActiveLayerListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

/** The browser-window layer stack used by built-in floating surfaces. */
export const activeLayers = new ActiveLayerStack();
