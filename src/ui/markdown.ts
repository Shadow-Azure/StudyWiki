import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** Render markdown source to HTML (raw HTML disabled — escaped, not executed).
 * 宿主共享渲染器：doc-markdown 与 app-agent 同一实例同一策略。
 * @param src Markdown source text.
 * @returns Rendered HTML. */
export function renderMarkdown(src: string): string {
  return md.render(src);
}
