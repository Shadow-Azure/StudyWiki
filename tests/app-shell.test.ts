// @vitest-environment jsdom
import { expect, test } from "vitest";
import { apply } from "../src/plugins/app-shell";

test("shell: separator drags sidebar width within stable bounds", () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const events = new Map<string, (payload?: unknown) => void>();
  const slots = {
    mount: (_slot: string, host: HTMLElement) => host.replaceChildren(),
  };
  const workspace = {
    root: null,
    activeFile: null,
    events: { on: (name: string, handler: (payload?: unknown) => void) => {
      events.set(name, handler);
      return () => events.delete(name);
    } },
  };

  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const body = root.querySelector<HTMLElement>(".body")!;
  const separator = root.querySelector<HTMLElement>(".workspace-resizer")!;
  expect(separator.classList.contains("line-resizer")).toBe(true);
  expect(separator.getAttribute("role")).toBe("separator");
  expect(separator.getAttribute("aria-orientation")).toBe("vertical");
  expect(separator.getAttribute("aria-valuemin")).toBe("210");
  expect(separator.getAttribute("aria-valuemax")).toBe("380");
  expect(separator.getAttribute("aria-valuenow")).toBe("252");

  const pointer = (target: EventTarget, type: string, clientX: number): void => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, buttons: 1 }));
  };
  pointer(separator, "pointerdown", 252);
  pointer(document, "pointermove", 320);
  pointer(document, "pointerup", 320);
  expect(body.style.getPropertyValue("--sidebar-size")).toBe("320px");
  expect(separator.getAttribute("aria-valuenow")).toBe("320");

  pointer(separator, "pointerdown", 320);
  pointer(document, "pointermove", 500);
  pointer(document, "pointerup", 500);
  expect(body.style.getPropertyValue("--sidebar-size")).toBe("380px");

  pointer(separator, "pointerdown", 380);
  pointer(document, "pointermove", 20);
  pointer(document, "pointerup", 20);
  expect(body.style.getPropertyValue("--sidebar-size")).toBe("210px");

  separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(body.style.getPropertyValue("--sidebar-size")).toBe("226px");
  separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(body.style.getPropertyValue("--sidebar-size")).toBe("210px");

  teardown();
  root.remove();
});
