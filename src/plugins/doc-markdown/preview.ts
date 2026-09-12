import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** Render markdown source to HTML (raw HTML disabled — escaped, not executed).
 * @param src Markdown source text.
 * @returns Rendered HTML. */
export function renderMarkdown(src: string): string {
  return md.render(src);
}
