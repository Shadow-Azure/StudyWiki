// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
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

function mountVideo() {
  let opened: (file: unknown) => Promise<void> | void = () => {};
  const files = { assetUrl: (p: string) => `asset:${p}` };
  const workspace = {
    activeFile: null as unknown,
    events: { on: (_k: string, fn: (f: unknown) => void) => {
      opened = (file: unknown) => { workspace.activeFile = file; fn(file); };
      return () => {};
    } },
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const off = apply({ files, workspace, slots } as never, {});
  const open = (file: unknown) => opened(file);
  return { off, open };
}

test("DOM: video canplay 前共享加载态，成功后移除并同步标题", async () => {
  const { off, open } = mountVideo();
  await open({ name: "v.mp4", path: "/x/v.mp4", kind: "video" });
  const video = document.querySelector<HTMLVideoElement>("video")!;
  expect(document.querySelector(".viewer-loading")?.textContent).toBe("加载中…");
  expect(document.title).toBe("v.mp4");
  video.dispatchEvent(new Event("canplay"));
  expect(document.querySelector(".viewer-loading")).toBeNull();
  off();
  document.body.replaceChildren();
});

test("DOM: video error 渲染共享错误条", async () => {
  const { off, open } = mountVideo();
  await open({ name: "bad.mp4", path: "/x/bad.mp4", kind: "video" });
  const video = document.querySelector<HTMLVideoElement>("video")!;
  video.dispatchEvent(new Event("error"));
  expect(document.querySelector(".viewer-loading")).toBeNull();
  expect(document.querySelector(".doc-error")?.textContent).toContain("视频加载失败");
  off();
  document.body.replaceChildren();
});

test("DOM: video 快捷键 Space/左右；输入控件不抢键", async () => {
  const { off, open } = mountVideo();
  await open({ name: "v.mp4", path: "/x/v.mp4", kind: "video" });
  const video = document.querySelector<HTMLVideoElement>("video")!;
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn().mockResolvedValue(undefined);
  video.currentTime = 12;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", cancelable: true }));
  expect(video.play).toHaveBeenCalledTimes(1);
  video.dispatchEvent(new Event("canplay"));
  Object.defineProperty(video, "paused", { value: false });
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", cancelable: true }));
  expect(video.pause).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
  expect(video.currentTime).toBe(17);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
  expect(video.currentTime).toBe(12);
  const input = document.createElement("input");
  document.body.append(input);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  expect(video.currentTime).toBe(12);
  off();
  document.body.replaceChildren();
});

test("DOM: 旧 video 的迟到 error 不污染下一个视频", async () => {
  const { off, open } = mountVideo();
  await open({ name: "bad.mp4", path: "/x/bad.mp4", kind: "video" });
  const oldVideo = document.querySelector<HTMLVideoElement>("video")!;
  await open({ name: "good.mp4", path: "/x/good.mp4", kind: "video" });
  oldVideo.dispatchEvent(new Event("error"));
  expect(document.querySelector(".doc-error")).toBeNull();
  off();
  document.body.replaceChildren();
});

test("DOM: 分隔条已处理的左右键不触发视频 seek", async () => {
  const { off, open } = mountVideo();
  await open({ name: "v.mp4", path: "/x/v.mp4", kind: "video" });
  const video = document.querySelector<HTMLVideoElement>("video")!;
  video.currentTime = 12;
  const separator = document.createElement("div");
  separator.setAttribute("role", "separator");
  separator.addEventListener("keydown", (event) => event.preventDefault());
  document.body.append(separator);
  separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  expect(video.currentTime).toBe(12);
  off();
  document.body.replaceChildren();
});
