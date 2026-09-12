// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { renderBootError } from "../src/boot-error";

afterEach(() => vi.restoreAllMocks());

test("renderBootError: 向 #app 内联渲染错误与指引，替代白屏；错误进 console", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  renderBootError(new Error("装载审计失败：p-x（state=1）未激活"));
  const app = document.querySelector<HTMLElement>("#app")!;
  expect(app.querySelector("h1")!.textContent).toBe("StudyWiki 启动失败");
  expect(app.querySelector("pre")!.textContent).toContain("p-x");
  expect(app.querySelector("p")!.textContent!.length).toBeGreaterThan(0); // 清理指引非空
  expect(err).toHaveBeenCalled();
});

test("renderBootError: 非 Error 值 String 化；无 #app 不抛", () => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(console, "error").mockImplementation(() => {});
  renderBootError("boom");
  expect(document.querySelector("pre")!.textContent).toBe("boom");
  document.body.innerHTML = "";
  expect(() => renderBootError(new Error("x"))).not.toThrow();
});
