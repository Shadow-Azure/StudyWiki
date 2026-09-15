// @vitest-environment jsdom
import { expect, test } from "vitest";
import { createCodeMirror } from "../src/plugins/doc-markdown/editor";

test("editor: markdown source uses a document surface without gutter chrome", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = createCodeMirror(parent, "# Title\n\nA long paragraph that should wrap like the preview surface.", () => {}, () => {});

  expect(editor.dom.classList.contains("cm-editor")).toBe(true);
  expect(editor.dom.querySelector(".cm-gutters")).toBeNull();
  expect(editor.dom.querySelector(".cm-foldGutter")).toBeNull();
  expect(editor.dom.querySelector(".cm-content .cm-line")).not.toBeNull();
  expect(editor.dom.querySelector(".cm-content")?.textContent).toContain("A long paragraph");

  editor.destroy();
  parent.remove();
});
