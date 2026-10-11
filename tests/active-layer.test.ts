import { describe, expect, it } from "vitest";
import { ActiveLayerStack } from "../src/ui/active-layer";

describe("active layer stack", () => {
  it("gives Escape to the newest surface only", () => {
    const layers = new ActiveLayerStack();
    const closed: string[] = [];
    const lowerRelease = layers.push("lower", { close: () => closed.push("lower") });
    const upperRelease = layers.push("upper", { close: () => closed.push("upper") });

    expect(layers.isActive("lower")).toBe(false);
    expect(layers.escape("lower")).toBe(false);
    expect(layers.escape("upper")).toBe(true);

    expect(closed).toEqual(["upper"]);
    expect(layers.isActive("lower")).toBe(true);
    lowerRelease();
    expect(layers.isActive("lower")).toBe(false);
  });

  it("ignores repeated release calls and hidden lower layers", () => {
    const layers = new ActiveLayerStack();
    const lowerRelease = layers.push("lower", { close: () => {} });
    const upperRelease = layers.push("upper", { close: () => {} });
    upperRelease();
    upperRelease();

    expect(layers.isActive("lower")).toBe(true);
    expect(layers.size).toBe(1);
    lowerRelease();
    expect(layers.size).toBe(0);
  });
});
