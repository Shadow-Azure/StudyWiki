#!/usr/bin/env node
// Walkthrough 静态站生成器：装载并校验站点 YAML，构建期定位真实源码锚点，
// 产零外部资源、（除变更史搜索框外）零脚本的多页 HTML；变更页头部的 Issue
// 链接是唯一的出站锚点（链向 flow issue 登记的 github.url，仅导航不加载资源）。
// 架构组成树直接按 code-map manifest 渲染两列
// 文本树（目录顺序复用 gen-code-map 的 SCAN_ROOTS，不在构建器里重复扫描/推导依赖）。

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import { checkAnchors, locateSnippet, parseSite, validateSchema } from "./walkthrough-lib.mjs";
import { parseFlowDocument } from "./flow-lib.mjs";
import { SCAN_ROOTS } from "./gen-code-map.mjs";
import { collectReviewDiff, hunkForRange } from "./walkthrough-review.mjs";

const markdown = new MarkdownIt({ html: false, linkify: false });

/** 判断值是否是普通对象。 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** HTML 文本与属性统一转义。 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 逐段百分号编码产物内 URL path；分隔符 `/` 与锚点 `#` 保留结构语义。 */
function encodeHrefPath(value) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/** 生成任意两个站点产物间的 POSIX 相对链接；path 与 anchor 分开传入，避免字面 # 歧义。 */
function relativeHref(fromPage, toPage, anchor = "") {
  const relative = posix.relative(posix.dirname(fromPage), toPage);
  const href = relative === "" ? posix.basename(toPage) : relative;
  const path = anchor ? `${encodeHrefPath(href)}#${encodeURIComponent(anchor)}` : encodeHrefPath(href);
  return escapeHtml(path);
}

/** 拒绝能逃出站点或使用绝对 URL 的产物内链接。 */
function safeSitePath(value, label) {
  if (typeof value !== "string" || value === "") throw new Error(`${label}: 必须是非空字符串`);
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label}: 不能指向站点外（${value}）`);
  }
  return normalized;
}

/** 读取 code-map manifest；构建产物没有它就无法生成可信架构页。 */
function readCodeMap(root) {
  const relative = "scripts/code-map.manifest.json";
  let value;
  try {
    value = JSON.parse(readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    throw new Error(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isPlainObject(value)) throw new Error(`${relative}: 必须是扁平对象映射`);
  for (const [key, description] of Object.entries(value)) {
    if (key !== "//" && typeof description !== "string") {
      throw new Error(`${relative}: ${key} 职责必须是字符串`);
    }
  }
  return value;
}

/** 计算文本显示宽度；中文按两列，保证实际仓库里的树仍可读。 */
function displayWidth(value) {
  let width = 0;
  for (const char of value) width += /[\u3000-\u9fff\uff00-\uffef]/u.test(char) ? 2 : 1;
  return width;
}

/**
 * 按 code-map manifest 渲染两列组成树。选型理由：build 只需要同源登记快照；
 * gen-code-map 的依赖推导属于仓库扫描职责，重复进构建器会让临时夹具站点更难装配。
 * 信任边界：未知键、缺 scan root 与磁盘新鲜度故意保持原样渲染，不在这里重建
 * gen-code-map 对账；该职责归 code-map/文档新鲜度门禁。
 * @param {Record<string, string>} codeMap - code-map 登记处。
 * @returns {string} `<pre><code>` 内的树文本。
 */
function renderCodeMapTree(codeMap) {
  const rows = [];
  for (const { display, dir } of SCAN_ROOTS) {
    const rootDescription = codeMap[display];
    if (typeof rootDescription !== "string") continue;
    const files = Object.keys(codeMap)
      .filter((key) => key.startsWith(`${dir}/`) && key !== "//")
      .sort();
    const labels = [`${display}/`, ...files.map((file) => `  ${file.slice(dir.length + 1)}`)];
    const width = Math.max(...labels.map((label) => displayWidth(label))) + 2;
    rows.push(`${display}/`.padEnd(width) + rootDescription);
    for (const file of files) {
      const label = `  ${file.slice(dir.length + 1)}`;
      rows.push(label.padEnd(width) + codeMap[file]);
    }
  }
  return rows.join("\n");
}

/** 渲染 markdown-it 叙述字段；安全策略与 src/ui/markdown.ts 相同。 */
function renderMarkdown(text) {
  return markdown.render(typeof text === "string" ? text.trim() : "");
}

/** 渲染包含锚定真实源码的代码块，并把 note 放在代码旁边。 */
function renderAnnotatedCode(source, located, noteHtml, sourceHref, anchorPrefix, sourceLabel) {
  const lines = source.replaceAll(/\r\n?/g, "\n").split("\n");
  const used = new Set();
  const rendered = [];
  for (let line = located.start; line <= located.end; line += 1) {
    const text = lines[line - 1] ?? "";
    const anchor = anchorPrefix ? `${anchorPrefix}-L${line}` : `L${line}`;
    const id = used.has(line) ? "" : ` id="${anchor}"`;
    used.add(line);
    rendered.push(
      `<span class="code-line"${id}><span class="line-number">${line}</span><span class="line-text">${escapeHtml(text)}</span></span>`,
    );
  }
  const range = located.start === located.end ? `L${located.start}` : `L${located.start}-L${located.end}`;
  const label = `${sourceLabel}:${located.start}${located.end === located.start ? "" : `-${located.end}`}`;
  return `<figure class="annotated-code"><figcaption><a href="${sourceHref}#${range}">${escapeHtml(label)}</a></figcaption><div class="code-note"><pre><code>${rendered.join("\n")}</code></pre><aside class="note">${noteHtml}</aside></div></figure>`;
}

/** 渲染页首面包屑和显式返回链接。 */
function renderBreadcrumb(fromPage, segments) {
  const trail = segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    return isLast || !segment.href
      ? `<span aria-current="page">${escapeHtml(segment.label)}</span>`
      : `<a href="${relativeHref(fromPage, segment.href, segment.anchor)}">${escapeHtml(segment.label)}</a>`;
  });
  const back = segments.length > 1 ? segments[segments.length - 2] : { href: "index.html" };
  return `<nav class="breadcrumb" aria-label="面包屑">${trail.join('<span class="separator">/</span>')}</nav><a class="back-link" href="${relativeHref(fromPage, back.href, back.anchor)}">返回</a>`;
}

/** 生成所有页共用的左侧导航。 */
function renderNavigation(fromPage, site) {
  const group = (title, items) => `
    <section class="nav-group"><h2>${escapeHtml(title)}</h2>${items.map((item) => `<a href="${relativeHref(fromPage, item.href)}">${escapeHtml(item.label)}</a>`).join("")}</section>`;
  const fileTree = renderFileTreeNav(fromPage, site);
  const fileSection = `
    <section class="nav-group"><h2>文件</h2>${fileTree}</section>`;
  const reviewGroup = activeReviewNav
    ? `<section class="nav-group"><h2>本 PR</h2><a href="${relativeHref(fromPage, "review.html")}">本 PR 检视</a></section>`
    : "";
  return `<nav class="site-nav" aria-label="站点导航">${reviewGroup}${group("总览", [{ href: "index.html", label: "站点总览" }])}${group("架构", [{ href: "architecture.html", label: "架构组成" }])}${group("功能", [...site.features.keys()].sort().map((slug) => ({ href: `features/${slug}.html`, label: site.features.get(slug).title ?? slug })))}${fileSection}${group("变更史", sortedChanges(site).map(([issue, page]) => ({ href: `changes/${issue}.html`, label: page.title ?? issue })))}</nav>`;
}

/** 变更史排序：标题以 #PR 编号开头者降序，无编号者按 slug 排后。 */
function sortedChanges(site) {
  const num = (title) => Number((/^#(\d+)/.exec(title ?? "") ?? [])[1] ?? -1);
  return [...site.changes.entries()].sort((a, b) => num(b[1].title) - num(a[1].title) || a[0].localeCompare(b[0]));
}

/** 文件页导航树：按源码目录嵌套为可折叠 details（纯 HTML，零脚本），summary 带目录下文件总数。 */
function renderFileTreeNav(fromPage, site) {
  const root = { dirs: new Map(), files: [] };
  for (const source of [...site.filePages.keys()].sort()) {
    let node = root;
    const parts = source.split("/");
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(source);
  }
  const count = (node) => node.files.length + [...node.dirs.values()].reduce((sum, child) => sum + count(child), 0);
  const render = (node) => {
    const dirs = [...node.dirs.entries()].map(([name, child]) => `<details class="nav-dir"><summary>${escapeHtml(name)}/ (${count(child)})</summary>${render(child)}</details>`).join("");
    const files = node.files.map((source) => `<a href="${relativeHref(fromPage, `files/${source}.html`)}">${escapeHtml(source.split("/").pop())}</a>`).join("");
    return dirs + files;
  };
  return render(root);
}

/** 生成 HTML 外壳、内联 CSS 与共同导航。 */
function renderPage({ title, current, site, breadcrumb, content }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · StudyWiki Walkthrough</title>
<style>
:root { color-scheme: light dark;
  --bg:#f7f7f8; --surface:#ffffff; --panel:#f4f4f6; --panel-strong:#ebebef;
  --line:#e6e6ec; --line-strong:#d7d7e0;
  --text:#1a1b1f; --muted:#676975; --faint:#9b9da8;
  --accent:#5454d4; --accent-soft:color-mix(in srgb,var(--accent) 9%,transparent);
  --add:#1a7f37; --del:#cf222e; --risk:#b45309;
  --risk-soft:color-mix(in srgb,var(--risk) 9%,transparent);
  --code-bg:#f8f8fa; --shadow:0 1px 2px rgba(18,18,28,.04),0 10px 28px -14px rgba(18,18,28,.14);
}
@media (prefers-color-scheme: dark) { :root {
  --bg:#111114; --surface:#191a1f; --panel:#202127; --panel-strong:#282932;
  --line:#282932; --line-strong:#393a45;
  --text:#e9e9ee; --muted:#a0a1ad; --faint:#6f707c;
  --accent:#9a9af5; --accent-soft:color-mix(in srgb,var(--accent) 13%,transparent);
  --add:#56d364; --del:#ff7b72; --risk:#e3a55b;
  --risk-soft:color-mix(in srgb,var(--risk) 13%,transparent);
  --code-bg:#15161a; --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -14px rgba(0,0,0,.5);
} }
* { box-sizing:border-box }
html { scroll-behavior:smooth }
body { margin:0; display:grid; grid-template-columns:288px minmax(0,1fr); min-height:100vh; background:var(--bg); color:var(--text); font:15px/1.75 system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; -webkit-font-smoothing:antialiased }
::selection { background:color-mix(in srgb,var(--accent) 22%,transparent) }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:6px }

/* ---- 侧栏 ---- */
.sidebar { position:sticky; top:0; height:100vh; overflow-y:auto; padding:22px 16px 32px; border-right:1px solid var(--line); background:var(--surface); scrollbar-width:thin }
.sidebar::-webkit-scrollbar { width:8px }
.sidebar::-webkit-scrollbar-thumb { background:var(--panel-strong); border-radius:99px }
.brand { display:block; font-weight:800; font-size:15px; letter-spacing:-.01em; color:inherit; text-decoration:none; padding:0 8px }
.brand::before { content:""; display:inline-block; width:9px; height:9px; border-radius:3px; background:var(--accent); margin-right:8px; transform:translateY(-1px) }
.brand-sub { display:block; font-size:11px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.14em; margin:3px 0 20px; padding-left:17px }
.nav-group { margin:0 0 22px }
.nav-group h2 { margin:0 0 6px; padding:0 8px; font-size:11px; font-weight:700; line-height:1.2; color:var(--faint); text-transform:uppercase; letter-spacing:.1em }
.site-nav a { display:block; color:inherit; text-decoration:none; padding:5px 8px; border-radius:8px; font-size:13.5px; overflow-wrap:anywhere; transition:background .12s,color .12s }
.site-nav a:hover { background:var(--accent-soft) }
.site-nav a.active { background:var(--accent-soft); color:var(--accent); font-weight:600 }

/* 折叠文件树 */
.site-nav details { margin:1px 0 }
.site-nav details details { margin-left:10px; padding-left:8px; border-left:1px solid var(--line) }
.site-nav summary { display:flex; align-items:center; gap:6px; cursor:pointer; list-style:none; padding:4px 8px; font-size:13px; color:var(--muted); border-radius:8px; user-select:none; transition:background .12s }
.site-nav summary::-webkit-details-marker { display:none }
.site-nav summary::before { content:""; width:0; height:0; border-left:4.5px solid var(--faint); border-top:3.5px solid transparent; border-bottom:3.5px solid transparent; transition:transform .15s }
.site-nav details[open] > summary::before { transform:rotate(90deg) }
.site-nav summary:hover { background:var(--accent-soft); color:var(--text) }
.site-nav details a { margin-left:6px }

/* ---- 主区 ---- */
main { min-width:0 }
.topbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:11px 24px; border-bottom:1px solid var(--line); background:color-mix(in srgb,var(--surface) 86%,transparent); backdrop-filter:blur(10px) }
.breadcrumb { display:flex; gap:8px; flex-wrap:wrap; align-items:center; color:var(--muted); font-size:13px }
.breadcrumb .separator { color:var(--faint) }
.breadcrumb a,.back-link,.annotated-code figcaption a { color:var(--accent); text-decoration:none }
.breadcrumb a:hover,.back-link:hover { text-decoration:underline }
.back-link { margin-left:auto; font-size:13px }
article.content { max-width:920px; margin:0 auto; padding:34px 40px 90px }
h1 { font-size:clamp(26px,3.4vw,34px); font-weight:800; letter-spacing:-.02em; line-height:1.2; margin:10px 0 22px }
h2 { font-size:19px; font-weight:700; letter-spacing:-.01em; margin:42px 0 16px; padding-bottom:9px; border-bottom:1px solid var(--line) }
h3 { font-size:16px; margin:26px 0 10px }
p { margin:10px 0 }
.content :not(pre)>code { background:var(--panel); border:1px solid var(--line); padding:.08em .34em; border-radius:5px; font-size:.88em }
.meta { color:var(--muted); font-size:12.5px }

/* 注解代码块 */
.annotated-code { margin:24px 0; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--surface); box-shadow:var(--shadow) }
.annotated-code figcaption { display:flex; align-items:center; gap:8px; padding:9px 14px; border-bottom:1px solid var(--line); background:var(--panel); font:12.5px ui-monospace,SFMono-Regular,monospace; color:var(--muted) }
.annotated-code figcaption::before { content:""; width:8px; height:8px; border-radius:99px; background:var(--accent) }
.code-note { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(240px,38%); align-items:stretch }
pre { margin:0; padding:14px 0; overflow:auto; font:13px/1.6 ui-monospace,SFMono-Regular,"SF Mono",Consolas,monospace; background:var(--code-bg) }
.code-note pre { min-height:100% }
.code-line { display:block; padding:0 16px }
.code-line:hover { background:var(--accent-soft) }
.line-number { display:inline-block; width:2.9em; margin-right:12px; color:var(--faint); text-align:right; user-select:none }
aside.note { position:relative; padding:16px 18px; font-size:13.5px; background:var(--panel); border-left:1px solid var(--line) }
aside.note::before { content:"讲解"; display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:.12em; color:var(--accent); border:1px solid color-mix(in srgb,var(--accent) 45%,transparent); border-radius:99px; padding:1px 9px; margin-bottom:10px }
aside.note p { margin:8px 0 }

/* 列表：卡片与 chips */
.card-list { display:grid; gap:10px; padding:0; list-style:none }
.card-list li { margin:0 }
.card-list li > a { display:block; padding:13px 16px; border:1px solid var(--line); border-radius:12px; background:var(--surface); color:inherit; text-decoration:none; transition:border-color .12s,transform .12s,box-shadow .12s }
.card-list li > a:hover { border-color:color-mix(in srgb,var(--accent) 55%,var(--line)); transform:translateY(-1px); box-shadow:var(--shadow) }
.card-list .card-title { display:block; font-weight:650; font-size:14px; color:var(--text) }
.card-list li > a:hover .card-title { color:var(--accent) }
.card-list .card-desc { display:block; margin-top:3px; font-size:13px; color:var(--muted) }
.touch-list { display:flex; flex-wrap:wrap; gap:8px; padding:0; list-style:none }
.touch-list li { margin:0 }
.touch-list a,.touch-list code { display:inline-flex; align-items:center; padding:3px 11px; border:1px solid var(--line-strong); border-radius:999px; font-size:12.5px; background:var(--surface); color:var(--text); text-decoration:none }
.touch-list a:hover { border-color:var(--accent); color:var(--accent) }
.backlinks { margin:14px 0 }

/* 变更页：头部徽章、变更地图、检视指引 */
.change-head { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin:-8px 0 4px }
.issue-link { font-size:13px; font-weight:600; color:var(--muted); text-decoration:none }
a.issue-link:hover { color:var(--accent) }
.scale-chips { display:flex; flex-wrap:wrap; gap:8px }
.chip { display:inline-flex; align-items:center; padding:2px 11px; border:1px solid var(--line-strong); border-radius:999px; background:var(--accent-soft); font-size:12.5px; font-weight:600 }
.chip.add { color:var(--add); background:color-mix(in srgb,var(--add) 10%,transparent); border-color:color-mix(in srgb,var(--add) 35%,transparent) }
.chip.del { color:var(--del); background:color-mix(in srgb,var(--del) 8%,transparent); border-color:color-mix(in srgb,var(--del) 32%,transparent) }
.badge { display:inline-flex; align-items:center; padding:1px 9px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.08em; white-space:nowrap }
.badge-must-read { color:var(--accent); background:var(--accent-soft); border:1px solid color-mix(in srgb,var(--accent) 45%,transparent) }
.badge-skim,.badge-skip { color:var(--muted); background:var(--panel); border:1px solid var(--line-strong) }
.map-group { margin:16px 0; border:1px solid var(--line); border-radius:12px; background:var(--surface); box-shadow:var(--shadow); overflow:hidden }
.map-group .group-head,.map-group > summary { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:11px 16px; background:var(--panel); border-bottom:1px solid var(--line) }
.map-group .group-head h3 { margin:0; font-size:14.5px }
.map-group > summary { cursor:pointer; list-style:none; font-weight:650; font-size:14px }
.map-group > summary::-webkit-details-marker { display:none }
.map-group > summary::before { content:"▸"; color:var(--faint); font-size:11px }
.map-group[open] > summary::before { content:"▾" }
details.map-group:not([open]) > summary { border-bottom:0 }
details.map-group.skim > summary { opacity:.72 }
details.map-group.skip > summary { opacity:.55 }
.map-group .group-why { padding:10px 16px 0; font-size:13px; color:var(--muted) }
.map-files { width:100%; border-collapse:collapse; font-size:13px }
.map-files td { padding:7px 16px; border-top:1px solid var(--line); vertical-align:top }
.map-files tr:first-child td { border-top:0 }
.map-files td.map-path { width:46%; font-family:ui-monospace,SFMono-Regular,monospace; font-size:12.5px; overflow-wrap:anywhere }
.map-files td.map-note { color:var(--muted) }
.map-files td.map-note p { margin:0 }
ol.user-flow { padding-left:22px }
ol.user-flow li { margin:5px 0 }
.risk-list { display:grid; gap:8px; padding:0; list-style:none }
.risk-list li { margin:0; padding:8px 13px; border-left:3px solid var(--risk); border-radius:8px; background:var(--risk-soft); font-size:13.5px }
.risk-list li p { margin:0 }
.acceptance { width:100%; border-collapse:collapse; font-size:13.5px; border:1px solid var(--line); background:var(--surface) }
.acceptance th,.acceptance td { padding:8px 14px; border-top:1px solid var(--line); text-align:left; vertical-align:top }
.acceptance thead th { border-top:0; background:var(--panel); font-size:12.5px; color:var(--muted) }
.acceptance td p { margin:0 }
.verify-list { padding:0; list-style:none }
.verify-list li { margin:5px 0; padding-left:24px; position:relative; font-size:13.5px }
.verify-list li::before { content:"✓"; position:absolute; left:2px; color:var(--add); font-weight:700 }

.search { width:100%; margin:0 0 12px; padding:8px 12px; border:1px solid var(--line-strong); border-radius:10px; background:var(--surface); color:var(--text); font:inherit; font-size:13.5px } .search::placeholder { color:var(--faint) } .search:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft) } .diff-file { margin:14px 0; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--surface) } .diff-file h4 { margin:0; padding:10px 14px; background:var(--panel); border-bottom:1px solid var(--line); font:12.5px ui-monospace,SFMono-Regular,monospace; font-weight:600; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap } .diff-file > .meta { padding:8px 14px; border-bottom:1px solid var(--line); font-size:13px }
.hunk { border-top:1px solid var(--line) } .hunk-head { padding:5px 14px; background:var(--panel); font-size:12px; font-family:ui-monospace,SFMono-Regular,monospace }
.diff-pre { padding:8px 0; background:var(--code-bg) } .diff-line { display:flex; padding:0; white-space:pre-wrap; word-break:break-all }
.diff-line .line-number { flex:0 0 3.4em; padding:0 10px 0 14px } .diff-line .diff-sign { flex:0 0 1.4em; text-align:center; user-select:none } .diff-line .diff-text { flex:1; padding-right:14px }
.diff-add { background:color-mix(in srgb,#2da44e 12%,transparent) } .diff-add .diff-sign { color:#2da44e } .diff-del { background:color-mix(in srgb,#cf222e 11%,transparent) } .diff-del .diff-sign { color:#cf222e } .diff-ctx { color:var(--muted) }
.attention-badge { display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:.08em; padding:1px 9px; border-radius:99px; vertical-align:middle; margin-left:8px }
.attention-must-read .attention-badge { color:#cf222e; border:1px solid color-mix(in srgb,#cf222e 45%,transparent) } .attention-skim .attention-badge { color:var(--muted); border:1px solid var(--line-strong) } .attention-skip .attention-badge { color:var(--faint); border:1px solid var(--line) }
.attention-skim .diff-file,.attention-skip .diff-file { opacity:.86 }
.diff-note { margin:0; border-left:3px solid var(--accent); border-radius:0 }
table { border-collapse:collapse; width:100%; font-size:13.5px } th,td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top } th { color:var(--muted); font-size:12.5px }
@media (max-width:860px) {
  body { grid-template-columns:1fr }
  .sidebar { position:static; height:auto; max-height:42vh; border-right:0; border-bottom:1px solid var(--line) }
  .topbar { position:static }
  article.content { padding:24px 20px 70px }
  .code-note { grid-template-columns:1fr }
  aside.note { border-left:0; border-top:1px solid var(--line) }
}
</style>
</head>
<body><aside class="sidebar"><a class="brand" href="${relativeHref(current, "index.html")}">StudyWiki<span class="brand-sub">工程讲解站 · Walkthrough</span></a>${renderNavigation(current, site)}</aside><main><div class="topbar">${breadcrumb}</div><article class="content">${content}</article></main></body>
</html>
`;
}

/** 渲染 overview/architecture 共用的 section 页。 */
function renderSectionPage(page, current, site, { heading, groupLabel, target }) {
  const sections = page.sections.map((section) => {
    const generated = section.generated === "code-map"
      ? `<h3>generated: code-map</h3><pre><code>${escapeHtml(renderCodeMapTree(site.codeMap))}</code></pre>`
      : "";
    const images = Array.isArray(section.images)
      ? section.images.map((image) => `<img src="${relativeHref(current, safeSitePath(image, "section.images"))}" alt="${escapeHtml(section.heading)}">`).join("")
      : "";
    return `<section><h2>${escapeHtml(section.heading)}</h2>${renderMarkdown(section.body)}${images}${generated}</section>`;
  }).join("");
  const breadcrumb = renderBreadcrumb(current, [
    { label: "首页", href: "index.html" },
    { label: groupLabel, href: target },
    { label: heading },
  ]);
  return renderPage({ title: heading, current, site, breadcrumb, content: `<h1>${escapeHtml(heading)}</h1>${sections}` });
}

/** 计算文件页反向引用：feature steps 与 modules 都算引用。 */
function backlinksFor(site, source) {
  const references = new Map();
  for (const [slug, feature] of site.features) {
    const steps = Array.isArray(feature.steps) ? feature.steps : [];
    const modules = Array.isArray(feature.modules) ? feature.modules : [];
    const referenced = steps.some((step) => step?.ref?.file === source) || modules.includes(source);
    if (referenced) references.set(slug, feature.title ?? slug);
  }
  return [...references].sort(([a], [b]) => a.localeCompare(b));
}

/** 定位构建用锚点；多处命中时保留首个区间并向构建日志发 WARN。 */
function locateForRender(source, snippet, file) {
  const located = locateSnippet(source, snippet);
  if (!located) return null;
  if (located.count > 1) {
    console.log(`WARN: snippet 在 ${file} 命中 ${located.count} 处，取首次（第 ${located.start} 行）`);
  }
  return located;
}

/** 渲染功能页。 */
function renderFeaturePage(slug, feature, current, site) {
  const backlinkLabel = (source) => {
    const references = backlinksFor(site, source);
    return references.length ? `（被 ${references.map(([key]) => key).join("、")} 引用）` : "";
  };
  const modules = feature.modules.map((module) => {
    const target = site.filePages.has(module) ? `files/${module}.html` : null;
    return `<li>${target ? `<a href="${relativeHref(current, target)}">${escapeHtml(module)}</a>` : `<code>${escapeHtml(module)}</code>`}${backlinkLabel(module)}</li>`;
  }).join("");
  const steps = feature.steps.map((step, index) => {
    const source = readFileSync(path.join(site.root, step.ref.file), "utf8");
    const located = locateForRender(source, step.ref.snippet, step.ref.file);
    if (!located) throw new Error(`锚点定位失败（walkthrough/features/${slug}.yaml steps[${index}]）`);
    const sourceHref = relativeHref(current, `files/${step.ref.file}.html`);
    return `<section><h2>步骤 ${index + 1}</h2>${renderAnnotatedCode(source, located, renderMarkdown(step.note), sourceHref, `step-${index + 1}`, step.ref.file)}</section>`;
  }).join("");
  const related = Array.isArray(feature.related?.notes)
    ? `<section><h2>相关决策</h2><ul>${feature.related.notes.map((note) => `<li>${markdown.renderInline(note)}</li>`).join("")}</ul></section>`
    : "";
  const content = `<h1>${escapeHtml(feature.title)}</h1><section><h2>用户可见行为</h2>${renderMarkdown(feature.behavior)}</section><section><h2>模块地图</h2><ul class="touch-list">${modules}</ul></section>${steps}${related}`;
  return renderPage({
    title: feature.title,
    current,
    site,
    breadcrumb: renderBreadcrumb(current, [
      { label: "首页", href: "index.html" },
      { label: "功能", href: "index.html", anchor: "features" },
      { label: feature.title },
    ]),
    content,
  });
}

/** 渲染文件页，头部建立功能页反向链接。 */
function renderFilePage(source, page, current, site) {
  const references = backlinksFor(site, source);
  const backlinks = references.length
    ? `<div class="backlinks">被引用：<ul class="touch-list">${references.map(([slug, title]) => `<li><a href="${relativeHref(current, `features/${slug}.html`)}">${escapeHtml(title)}</a></li>`).join("")}</ul></div>`
    : '<div class="backlinks meta">暂无功能页引用。</div>';
  const loaded = readFileSync(path.join(site.root, page.source), "utf8");
  const segments = page.segments.map((segment, index) => {
    const located = locateForRender(loaded, segment.snippet, page.source);
    if (!located) throw new Error(`锚点定位失败（walkthrough/files/${source}.yaml segments[${index}]）`);
    return renderAnnotatedCode(loaded, located, renderMarkdown(segment.note), "", "", page.source);
  }).join("");
  const content = `<h1>${escapeHtml(source)}</h1>${backlinks}<section><h2>文件职责</h2>${renderMarkdown(page.summary)}</section><section><h2>逐段注解</h2>${segments}</section>`;
  return renderPage({
    title: source,
    current,
    site,
    breadcrumb: renderBreadcrumb(current, [
      { label: "首页", href: "index.html" },
      { label: "文件", href: "index.html", anchor: "files" },
      { label: source },
    ]),
    content,
  });
}

/** 把 touches 封闭语法渲染成站点内链接。 */
function renderTouches(touches, current, site) {
  return `<ul class="touch-list">${touches.map((touch) => {
    if (touch.startsWith("file:")) {
      const source = safeSitePath(touch.slice("file:".length), "touches file");
      return site.filePages.has(source)
        ? `<li><a href="${relativeHref(current, `files/${source}.html`)}">${escapeHtml(source)}</a></li>`
        : `<li><code>${escapeHtml(source)}</code></li>`;
    }
    if (touch.startsWith("feature:")) {
      const slug = touch.slice("feature:".length);
      return site.features.has(slug)
        ? `<li><a href="${relativeHref(current, `features/${slug}.html`)}">${escapeHtml(site.features.get(slug).title ?? slug)}</a></li>`
        : `<li><code>${escapeHtml(slug)}</code></li>`;
    }
    return `<li>${markdown.renderInline(touch)}</li>`;
  }).join("")}</ul>`;
}

/** 读取 flow issue 登记的 github.url；缺失或损坏时软降级为 null（纯文本展示）。 */
function resolveIssueUrl(root, issue) {
  try {
    const file = path.join(root, ".agents/flow/issues", `${issue}.md`);
    if (!existsSync(file)) return null;
    const { data } = parseFlowDocument(readFileSync(file, "utf8"), file);
    const url = data?.github?.url;
    return typeof url === "string" && url !== "" ? url : null;
  } catch {
    return null;
  }
}

const ATTENTION_BADGES = { "must-read": "必读", skim: "可扫读", skip: "可跳过" };

/** attention 徽章；未知值已先被 schema 拦截，这里只做兜底转义。 */
function attentionBadge(attention) {
  return `<span class="badge badge-${escapeHtml(attention)}">${ATTENTION_BADGES[attention] ?? escapeHtml(attention)}</span>`;
}

/** 渲染变更地图：must-read 组展开置顶，skim/skip 组默认 <details> 折叠。 */
function renderCodeMapGroups(codeMap, current, site) {
  const order = { "must-read": 0, skim: 1, skip: 2 };
  const groups = codeMap
    .map((group, index) => ({ group, index }))
    .sort(
      (a, b) =>
        (order[a.group.attention] ?? 3) - (order[b.group.attention] ?? 3) ||
        a.index - b.index,
    );
  return groups
    .map(({ group }) => {
      const why =
        typeof group.why === "string" && group.why !== ""
          ? `<div class="group-why">${markdown.renderInline(group.why)}</div>`
          : "";
      const rows = group.files
        .map((file) => {
          const target = site.filePages.has(file.path) ? `files/${file.path}.html` : null;
          const cell = target
            ? `<a href="${relativeHref(current, target)}">${escapeHtml(file.path)}</a>`
            : `<code>${escapeHtml(file.path)}</code>`;
          const notes = Array.isArray(file.changes)
            ? file.changes.map((change) => `<tr class="map-change-note"><td></td><td class="map-note"><aside class="note diff-note"><span class="meta">检视注解：</span>${markdown.renderInline(change.note)}</aside></td></tr>`).join("")
            : "";
          return `<tr><td class="map-path">${cell}</td><td class="map-note">${markdown.renderInline(file.note)}</td></tr>${notes}`;
        })
        .join("");
      const table = `<table class="map-files"><tbody>${rows}</tbody></table>`;
      if (group.attention === "must-read") {
        return `<section class="map-group must-read"><div class="group-head"><h3>${escapeHtml(group.group)}</h3>${attentionBadge(group.attention)}</div>${why}${table}</section>`;
      }
      return `<details class="map-group ${escapeHtml(group.attention)}"><summary>${escapeHtml(group.group)}${attentionBadge(group.attention)}</summary>${why}${table}</details>`;
    })
    .join("");
}

/** 渲染变更史页（v2 schema：scale 徽章 + feature/userFlow/codeMap/reviewGuide/verification）。 */
function renderChangePage(issue, page, current, site) {
  const issueUrl = resolveIssueUrl(site.root, issue);
  const issuePart = issueUrl
    ? `<a class="issue-link" href="${escapeHtml(issueUrl)}">Issue ${escapeHtml(issue)}</a>`
    : `<span class="issue-link">Issue ${escapeHtml(issue)}</span>`;
  const chips = `<div class="scale-chips"><span class="chip">${page.scale.files} 个文件</span><span class="chip add">+${page.scale.additions}</span><span class="chip del">−${page.scale.deletions}</span></div>`;
  const userFlow = `<ol class="user-flow">${page.userFlow.map((step) => `<li>${markdown.renderInline(step)}</li>`).join("")}</ol>`;
  const guide = page.reviewGuide;
  const reviewOrder = `<ol class="review-order">${guide.order.map((item) => `<li>${markdown.renderInline(item)}</li>`).join("")}</ol>`;
  const risks = guide.risks.length
    ? `<ul class="risk-list">${guide.risks.map((risk) => `<li>${markdown.renderInline(risk)}</li>`).join("")}</ul>`
    : '<p class="meta">无登记风险。</p>';
  const acceptance = `<table class="acceptance"><thead><tr><th>验收项</th><th>证据</th></tr></thead><tbody>${guide.acceptance.map((entry) => `<tr><td>${markdown.renderInline(entry.item)}</td><td>${markdown.renderInline(entry.evidence)}</td></tr>`).join("")}</tbody></table>`;
  const verification = `<ul class="verify-list">${page.verification.map((item) => `<li>${markdown.renderInline(item)}</li>`).join("")}</ul>`;
  const content = `<h1>${escapeHtml(page.title)}</h1><div class="change-head">${issuePart}${chips}</div><section><h2>功能变化</h2>${renderMarkdown(page.feature)}</section><section><h2>用户操作路径</h2>${userFlow}</section><section><h2>架构影响</h2>${renderMarkdown(page.architectural)}</section><section><h2>变更地图</h2>${renderCodeMapGroups(page.codeMap, current, site)}</section><section><h2>检视指引</h2><h3>建议阅读顺序</h3>${reviewOrder}<h3>风险点</h3>${risks}<h3>验收对照</h3>${acceptance}</section><section><h2>验证清单</h2>${verification}</section><section><h2>触及清单</h2>${renderTouches(page.touches, current, site)}</section>`;
  return renderPage({
    title: page.title,
    current,
    site,
    breadcrumb: renderBreadcrumb(current, [
      { label: "首页", href: "index.html" },
      { label: "变更史", href: "index.html", anchor: "changes" },
      { label: page.title },
    ]),
    content,
  });
}

/** 渲染总览首页，并提供五层站点的入口列表。 */
function renderOverviewPage(site) {
  const overview = site.overview.sections.map((section) => {
    const images = Array.isArray(section.images)
      ? section.images.map((image) => `<img src="${relativeHref("index.html", safeSitePath(image, "section.images"))}" alt="${escapeHtml(section.heading)}">`).join("")
      : "";
    return `<section><h2>${escapeHtml(section.heading)}</h2>${renderMarkdown(section.body)}${images}</section>`;
  }).join("");
  const entries = (title, id, items) => `<section id="${escapeHtml(id)}"><h2>${escapeHtml(title)}</h2><ul class="card-list">${items.map((item) => `<li><a href="${relativeHref("index.html", item.href)}"><span class="card-title">${escapeHtml(item.label)}</span>${item.description ? `<span class="card-desc">${escapeHtml(item.description)}</span>` : ""}</a></li>`).join("")}</ul></section>`;
  const content = `<h1>StudyWiki Walkthrough</h1>${overview}${entries("功能导览", "features", [...site.features.keys()].sort().map((slug) => ({ href: `features/${slug}.html`, label: site.features.get(slug).title ?? slug, description: site.featureIndex?.features?.find((feature) => feature.slug === slug)?.summary })))}${entries("文件注解", "files", [...site.filePages.keys()].sort().map((source) => ({ href: `files/${source}.html`, label: source, description: site.filePages.get(source).summary })))}${(() => {
  const cards = sortedChanges(site).map(([issue, page]) => `<li><a href="${relativeHref("index.html", `changes/${issue}.html`)}"><span class="card-title">${escapeHtml(page.title ?? issue)}</span><span class="card-desc">Issue ${escapeHtml(issue)}</span></a></li>`).join("");
  const filter = `<input class="search" type="search" placeholder="搜索 PR 编号或关键词…" aria-label="搜索变更史" data-filter="changes-cards">`;
  const script = `<script>(() => { const input = document.querySelector('input[data-filter="changes-cards"]'); const list = document.getElementById('changes-cards'); if (!input || !list) return; input.addEventListener('input', () => { const q = input.value.trim().toLowerCase(); for (const li of list.children) li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none'; }); })();<\/script>`;
  return `<section id="changes"><h2>变更史</h2>${filter}<ul class="card-list" id="changes-cards">${cards}</ul></section>${script}`;
})()}`;
  return renderPage({
    title: "总览",
    current: "index.html",
    site,
    breadcrumb: renderBreadcrumb("index.html", [{ label: "首页" }]),
    content,
  });
}

/**
 * 构建 walkthrough 多页静态站。
 * @param {string} root - 站点仓库根目录。
 * @param {string} [outDir] - 输出目录；默认解析到 root 下的 walkthrough/dist。
 * @returns {void} 构建成功时无返回值；多处锚点命中会向 stdout 输出 WARN。
 */
let activeReviewNav = false;

export function buildSite(root, outDir, options = {}) {
  activeReviewNav = Boolean(options.review);
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir ?? path.join(resolvedRoot, "walkthrough/dist"));
  const site = parseSite(resolvedRoot);

  if (site.parseErrors.length > 0) {
    throw new Error(`walkthrough 解析失败:\n  ${site.parseErrors.join("\n  ")}`);
  }
  const schemaErrors = validateSchema(site);
  if (schemaErrors.length > 0) {
    throw new Error(`walkthrough schema 校验失败:\n  ${schemaErrors.join("\n  ")}`);
  }
  const anchorErrors = checkAnchors(resolvedRoot, site);
  if (anchorErrors.length > 0) {
    throw new Error(`walkthrough 锚点校验失败:\n  ${anchorErrors.join("\n  ")}`);
  }

  site.codeMap = readCodeMap(resolvedRoot);
  site.root = resolvedRoot;

  rmSync(resolvedOut, { recursive: true, force: true });
  mkdirSync(resolvedOut, { recursive: true });
  const output = (relative, html) => {
    const file = path.join(resolvedOut, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, html);
  };

  output("index.html", renderOverviewPage(site));
  output("architecture.html", renderSectionPage(site.architecture, "architecture.html", site, {
    heading: "架构",
    groupLabel: "架构",
    target: "architecture.html",
  }));
  for (const [slug, feature] of site.features) {
    output(`features/${slug}.html`, renderFeaturePage(slug, feature, `features/${slug}.html`, site));
  }
  for (const [source, page] of site.filePages) {
    output(`files/${source}.html`, renderFilePage(source, page, `files/${source}.html`, site));
  }
  for (const [issue, change] of site.changes) {
    output(`changes/${issue}.html`, renderChangePage(issue, change, `changes/${issue}.html`, site));
  if (options.review) {
    output("review.html", renderReviewPage(site, options.review, root));
  }
  }

  const assets = path.join(resolvedRoot, "walkthrough/assets");
  if (existsSync(assets) && readdirSync(assets).length > 0) {
    cpSync(assets, path.join(resolvedOut, "assets"), { recursive: true });
  }
}


/** 从 flow 树读 issue 状态（review 模式探测当前 PR 页用）。 */
function flowStatuses(root) {
  const statuses = new Map();
  const dir = path.join(root, ".agents/flow/issues");
  if (!existsSync(dir)) return statuses;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md") || name.endsWith(".en.md")) continue;
    const text = readFileSync(path.join(dir, name), "utf8");
    const status = /status: (\w[\w-]*)/u.exec(text)?.[1];
    if (status) statuses.set(name.replace(/\.md$/u, ""), status);
  }
  return statuses;
}

/** 探测当前 PR 对应的变更页：提交标题 (#N) → issue 编号 → slug；其次 in-progress issue 且其页在 diff 中。 */
function detectReviewPage(root, site, diffFiles, base) {
  const numbers = new Set(
    (execGit(root, ["log", "--format=%s", `${base}..HEAD`]).match(/\(#(\d+)\)/gu) ?? [])
      .map((tag) => Number(tag.replace(/\D/gu, ""))),
  );
  if (numbers.size > 0) {
    const dir = path.join(root, ".agents/flow/issues");
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      if (!name.endsWith(".md") || name.endsWith(".en.md")) continue;
      const text = readFileSync(path.join(dir, name), "utf8");
      const number = /number: (\d+)/u.exec(text)?.[1];
      if (number && numbers.has(Number(number))) {
        const slug = name.replace(/\.md$/u, "");
        if (site.changes.has(slug)) return slug;
      }
    }
  }
  const statuses = flowStatuses(root);
  const changed = new Set(diffFiles
    .map((file) => /^walkthrough\/changes\/([^/]+)\.yaml$/u.exec(file)?.[1])
    .filter(Boolean)
    .filter((slug) => site.changes.has(slug)));
  for (const [slug] of site.changes) {
    if (statuses.get(slug) === "in-progress" && changed.has(slug)) return slug;
  }
  if (changed.size > 0) return [...changed][0];
  throw new Error("review 模式：未找到当前 PR 的变更页（提交标题无 (#N) 可映射到带 changes 页的 issue）");
}

/** git 命令出口（review 探测用）。 */
function execGit(root, argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8" });
}

/** 渲染 PR 检视页：v2 叙事区 + 真实 before/after diff 区（must-read 组展开）。 */
function renderReviewPage(site, review, root) {
  const { base } = review;
  const diff = collectReviewDiff(root, base);
  const byPath = new Map(diff.files.map((file) => [file.path, file]));
  const slug = detectReviewPage(root, site, diff.files.map((file) => file.path), base);
  const page = site.changes.get(slug);
  const current = "review.html";
  const prNumber = /^#(\d+)/u.exec(page.title ?? "")?.[1];
  const prLink = prNumber ? `https://github.com/Shadow-Azure/StudyWiki/pull/${prNumber}/files` : null;
  const scale = page.scale ?? {};
  const meta = `<p class="meta">Issue ${escapeHtml(page.issue ?? slug)} · 检视基线 ${escapeHtml(base)} · ${Number(scale.files ?? diff.files.length)} 个文件 · +${Number(scale.additions ?? 0)} −${Number(scale.deletions ?? 0)}${prLink ? ` · <a href="${escapeHtml(prLink)}">在 GitHub 看完整 diff</a>` : ""}</p>`;
  const flowSection = `<section><h2>功能</h2>${renderMarkdown(page.feature ?? "")}</section>`;
  const userFlow = `<section><h2>用户操作路径</h2><ol>${(page.userFlow ?? []).map((step) => `<li>${renderMarkdown(String(step))}</li>`).join("")}</ol></section>`;
  const archSection = `<section><h2>架构变化</h2>${renderMarkdown(page.architectural ?? "")}</section>`;

  const rank = { "must-read": 0, skim: 1, skip: 2 };
  const groups = [...(page.codeMap ?? [])].sort((a, b) => (rank[a.attention] ?? 1) - (rank[b.attention] ?? 1));
  const covered = new Set(groups.flatMap((group) => (group.files ?? []).map((file) => file.path)));
  const groupHtml = groups.map((group) => {
    const files = (group.files ?? []).map((entry) => {
      const file = byPath.get(entry.path);
      const stats = file ? `+${file.additions} −${file.deletions}` : "本 PR 未改动";
      const status = file ? (file.status === "A" ? "新增" : file.status === "D" ? "删除" : "修改") : "";
      const link = site.filePages.has(entry.path) ? `<a href="${relativeHref(current, `files/${entry.path}.html`)}">${escapeHtml(entry.path)}</a>` : `<code>${escapeHtml(entry.path)}</code>`;
      let body = "";
      if (group.attention === "must-read" && file && file.hunks.length > 0) {
        body = renderDiffHunks(file, entry, site, root);
      }
      return `<div class="diff-file"><h4>${link} <span class="meta">${escapeHtml(status)} ${escapeHtml(stats)}</span></h4><div class="meta">${renderMarkdown(entry.note ?? "")}</div>${body}</div>`;
    }).join("");
    return `<section class="codemap-group attention-${escapeHtml(group.attention)}"><h3>${escapeHtml(group.group)} <span class="attention-badge">${escapeHtml(group.attention)}</span></h3><p class="meta">${renderMarkdown(group.why ?? "")}</p>${files}</section>`;
  }).join("");
  const rest = diff.files.filter((file) => !covered.has(file.path));
  const restHtml = rest.length
    ? `<details class="diff-rest"><summary>未归类的其余变更文件（${rest.length}）</summary><ul class="touch-list">${rest.map((file) => `<li><code>${escapeHtml(file.path)}</code> <span class="meta">+${file.additions} −${file.deletions}</span></li>`).join("")}</ul></details>`
    : "";
  const codeSection = `<section><h2>代码变更（before/after）</h2>${groupHtml}${restHtml}</section>`;
  const guide = page.reviewGuide
    ? `<section><h2>检视指引</h2><h3>建议阅读顺序</h3><ol>${page.reviewGuide.order.map((item) => `<li>${renderMarkdown(item)}</li>`).join("")}</ol><h3>风险点</h3><ul>${page.reviewGuide.risks.map((item) => `<li>${renderMarkdown(item)}</li>`).join("")}</ul><h3>验收对照</h3><table><thead><tr><th>验收项</th><th>证据</th></tr></thead><tbody>${page.reviewGuide.acceptance.map((row) => `<tr><td>${renderMarkdown(row.item)}</td><td>${renderMarkdown(row.evidence)}</td></tr>`).join("")}</tbody></table></section>`
    : "";
  const verification = `<section><h2>验证证据</h2><ul>${(page.verification ?? []).map((item) => `<li>${renderMarkdown(item)}</li>`).join("")}</ul></section>`;
  const content = `<h1>本 PR 检视：${escapeHtml(page.title ?? slug)}</h1>${meta}${flowSection}${userFlow}${archSection}${codeSection}${guide}${verification}`;
  return renderPage({
    title: `本 PR 检视 · ${page.title ?? slug}`,
    current,
    site,
    breadcrumb: renderBreadcrumb(current, [{ label: "首页", href: "index.html" }, { label: "本 PR 检视" }]),
    content,
  });
}

/** 渲染单文件的 diff hunks：+ 绿 / − 红 / 上下文灰，变更注解挂到所属 hunk 下方。 */
function renderDiffHunks(file, entry, site, root) {
  const sourceText = existsSync(path.join(root, file.path)) ? readFileSync(path.join(root, file.path), "utf8") : "";
  const notes = (entry.changes ?? []).map((change) => {
    const located = sourceText ? locateSnippet(sourceText, change.snippet) : null;
    return { note: change.note, hunkIndex: located ? hunkForRange(file.hunks, located) : -1 };
  });
  const looseNotes = notes.filter((note) => note.hunkIndex === -1);
  const headerNotes = looseNotes.length
    ? looseNotes.map((note) => `<aside class="note diff-note">${renderMarkdown(note.note)}</aside>`).join("")
    : "";
  const hunks = file.hunks.map((hunk, index) => {
    const lines = hunk.lines.map((line) => {
      const sign = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";
      const no = line.newNo ?? line.oldNo ?? "";
      return `<span class="diff-line diff-${line.type}"><span class="line-number">${no}</span><span class="diff-sign">${sign}</span><span class="diff-text">${escapeHtml(line.text)}</span></span>`;
    }).join("");
    const attached = notes.filter((note) => note.hunkIndex === index);
    const attachedHtml = attached.map((note) => `<aside class="note diff-note">${renderMarkdown(note.note)}</aside>`).join("");
    return `<div class="hunk"><div class="hunk-head meta">@@ 旧 ${hunk.oldStart} → 新 ${hunk.newStart} @@</div><pre class="diff-pre">${lines}</pre>${attachedHtml}</div>`;
  }).join("");
  return `${headerNotes}${hunks}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const reviewIndex = argv.indexOf("--review");
  if (argv.some((arg) => arg.startsWith("--") && arg !== "--review")) {
    console.error(`build-walkthrough: 未知参数（仅支持 [root] [outDir] [--review <base>]）`);
    process.exit(2);
  }
  if (reviewIndex !== -1 && argv[reviewIndex + 1] === undefined) {
    console.error("build-walkthrough: --review 需要 <base> 值");
    process.exit(2);
  }
  const positional = argv.filter((_, index) => index !== reviewIndex && index !== reviewIndex + 1);
  const [rootArg, outArg] = positional;
  try {
    const options = reviewIndex === -1 ? {} : { review: { base: argv[reviewIndex + 1] } };
    buildSite(rootArg ?? process.cwd(), outArg, options);
  } catch (error) {
    console.error(`build-walkthrough: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
