/** All UI slot names the shell provides containers for. */
export type SlotName = "topbar.left" | "sidebar.tree" | "main.viewer";

/** Renders into its own child element; decides its own visibility. */
export type SlotRenderer = (el: HTMLElement) => void;

/** Typed vanilla-DOM slot registry: renderers run in registration order, each
 * in its own element — no single-slot competition. */
export class SlotsService {
  readonly #entries = new Map<SlotName, Array<{ el: HTMLElement; render: SlotRenderer }>>();
  readonly #containers = new Map<SlotName, HTMLElement>();

  /** Register a renderer into a slot; returns its disposer. */
  register(slot: SlotName, render: SlotRenderer): () => void {
    const list = this.#entries.get(slot) ?? [];
    const el = document.createElement("div");
    el.className = `slot slot-${slot.replace(".", "-")}`;
    const entry = { el, render };
    list.push(entry);
    this.#entries.set(slot, list);
    const container = this.#containers.get(slot);
    if (container) {
      container.appendChild(el);
      this.#render(entry);
    }
    return () => {
      const cur = this.#entries.get(slot) ?? [];
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
