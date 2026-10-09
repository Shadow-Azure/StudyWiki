/** All current slot names the shell mounts. */
export type SlotName = "activity.left" | "sidebar.tree" | "main.viewer" | "sidebar.right";
/** API v1 plugins may register "topbar.left"; it is normalized to "activity.left". Only current SlotName values may be mounted. */
export type SlotRegistration = SlotName | "topbar.left";

/** Renders into its own child element; decides its own visibility. */
export type SlotRenderer = (el: HTMLElement) => void;

const SLOT_ALIASES = new Map<string, SlotName>([["topbar.left", "activity.left"]]);

/** Normalize an API v1 registration to its current slot; unknown preview slot
 * names pass through unchanged.
 * @param slot Declared registration slot, including the API v1 alias.
 * @returns Current slot name for known registrations; otherwise the input. */
export function normalizeSlotRegistration<T extends string>(
  slot: T,
): T extends SlotRegistration ? SlotName : T {
  return (SLOT_ALIASES.get(slot) ?? slot) as T extends SlotRegistration ? SlotName : T;
}

/** Typed vanilla-DOM slot registry: renderers run in registration order, each
 * in its own element — no single-slot competition. */
export class SlotsService {
  readonly #entries = new Map<SlotName, Array<{ el: HTMLElement; render: SlotRenderer }>>();
  readonly #containers = new Map<SlotName, HTMLElement>();

  /** Register a renderer into a slot; returns its disposer. */
  register(slot: SlotRegistration, render: SlotRenderer): () => void {
    const key = normalizeSlotRegistration(slot);
    const list = this.#entries.get(key) ?? [];
    const el = document.createElement("div");
    el.className = `slot slot-${key.replace(".", "-")}`;
    const entry = { el, render };
    list.push(entry);
    this.#entries.set(key, list);
    const container = this.#containers.get(key);
    if (container) {
      container.appendChild(el);
      this.#render(entry);
    }
    return () => {
      const cur = this.#entries.get(key) ?? [];
      const i = cur.indexOf(entry);
      if (i >= 0) {
        cur.splice(i, 1);
        entry.el.remove();
      }
    };
  }

  /** Bind (or rebind) a slot's container; owned by the shell plugin. */
  mount(slot: SlotName, container: HTMLElement): void {
    this.#containers.set(slot, container);
    container.replaceChildren();
    for (const entry of this.#entries.get(slot) ?? []) {
      container.appendChild(entry.el);
      this.#render(entry);
    }
  }

  #render(entry: { el: HTMLElement; render: SlotRenderer }): void {
    entry.el.replaceChildren();
    entry.render(entry.el);
  }
}
