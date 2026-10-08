/** All current slot names the shell mounts. */
export type SlotName = "activity.left" | "sidebar.tree" | "main.viewer" | "sidebar.right";
/** API v1 external plugins may still register the old topbar slot. */
export type SlotRegistration = SlotName | "topbar.left";

/** Renders into its own child element; decides its own visibility. */
export type SlotRenderer = (el: HTMLElement) => void;

const SLOT_ALIASES: Record<string, SlotName> = { "topbar.left": "activity.left" };

const normalizeSlot = (slot: SlotRegistration): SlotName => SLOT_ALIASES[slot] ?? slot;

/** Typed vanilla-DOM slot registry: renderers run in registration order, each
 * in its own element — no single-slot competition. */
export class SlotsService {
  readonly #entries = new Map<SlotName, Array<{ el: HTMLElement; render: SlotRenderer }>>();
  readonly #containers = new Map<SlotName, HTMLElement>();

  /** Register a renderer into a slot; returns its disposer. */
  register(slot: SlotRegistration, render: SlotRenderer): () => void {
    const key = normalizeSlot(slot);
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
