// @vitest-environment jsdom
import { expect, test } from "vitest";
import { apply } from "../src/plugins/doc-video";

test("DOM: kind=video 渲染 video 并用 assetUrl；其他 kind 不画", async () => {
  // 蓝本无名外层参数表是语法错误，补形参名 fn:（T10 先例，运行时语义不变）。
  let opened: (fn: (f: unknown) => void) => () => {};
  const files = { assetUrl: (p: string) => `asset:${p}` };
  // 真实契约（host/workspace.ts openFile）：先设 activeFile 再 emit file-opened；
  // 蓝本桩漏设 activeFile，render 读到恒 null（T10 同 genre 用例缺陷）——桩补上这一步。
  const workspace = {
    activeFile: null as unknown,
    events: { on: (_k: string, fn: (f: unknown) => void) => { opened = (f: unknown) => { workspace.activeFile = f; fn(f); }; return () => {}; } },
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, workspace, slots } as never, {});
  await opened({ name: "v.mp4", path: "/x/v.mp4", kind: "video" });
  const video = document.querySelector<HTMLVideoElement>("video");
  expect(video?.controls).toBe(true);
  expect(video?.getAttribute("src")).toBe("asset:/x/v.mp4");
  await opened({ name: "a.md", path: "/x/a.md", kind: "markdown" });
  expect(document.querySelector("video")).toBeNull();
});
