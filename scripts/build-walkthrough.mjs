#!/usr/bin/env node
// Walkthrough 静态站生成器：装载并校验站点 YAML，构建期定位真实源码锚点，
// 产零外链、零脚本的多页 HTML。架构组成树直接按 code-map manifest 渲染两列
// 文本树（目录顺序复用 gen-code-map 的 SCAN_ROOTS，不在构建器里重复扫描/推导依赖）。

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import { checkAnchors, locateSnippet, parseSite, validateSchema } from "./walkthrough-lib.mjs";
import { SCAN_ROOTS } from "./gen-code-map.mjs";

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
  return `<nav class="site-nav" aria-label="站点导航">${group("总览", [{ href: "index.html", label: "站点总览" }])}${group("架构", [{ href: "architecture.html", label: "架构组成" }])}${group("功能", [...site.features.keys()].sort().map((slug) => ({ href: `features/${slug}.html`, label: site.features.get(slug).title ?? slug })))}${group("文件", [...site.filePages.keys()].sort().map((source) => ({ href: `files/${source}.html`, label: source })))}${group("变更史", [...site.changes.keys()].sort().map((issue) => ({ href: `changes/${issue}.html`, label: site.changes.get(issue).title ?? issue })))}</nav>`;
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
:root { color-scheme: light dark; --line:#d9d9e3; --text:#1c1c21; --muted:#5f6068; --surface:#fff; --panel:#f5f5f7; --accent:#7452ff; }
@media (prefers-color-scheme: dark) { :root { --line:#3a3a42; --text:#ededf0; --muted:#a7a7b0; --surface:#17171a; --panel:#202024; --accent:#a48fff; } }
* { box-sizing:border-box } body { margin:0; display:grid; grid-template-columns:270px minmax(0,1fr); min-height:100vh; background:var(--surface); color:var(--text); font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif } .sidebar { padding:24px 18px; border-right:1px solid var(--line); background:var(--panel) } .brand,.site-nav a { display:block; color:inherit; text-decoration:none } .brand { font-weight:700; margin-bottom:20px } .nav-group { margin:0 0 20px } .nav-group h2 { margin:0 0 7px; font-size:12px; line-height:1.2; color:var(--muted); text-transform:uppercase; letter-spacing:.06em } .site-nav a { padding:5px 7px; border-radius:6px; overflow-wrap:anywhere } .site-nav a:hover,.site-nav a.active { background:color-mix(in srgb,var(--accent) 16%,transparent) } main { padding:min(6vw,52px); max-width:1080px } .breadcrumb,.back-link { color:var(--muted); font-size:13px } .breadcrumb { display:flex; gap:7px; flex-wrap:wrap } .breadcrumb a,.back-link,.annotated-code figcaption a { color:var(--accent) } .back-link { display:inline-block; margin-top:10px } h1 { font-size:clamp(28px,4vw,38px); line-height:1.15; margin:16px 0 20px } h2 { margin-top:34px; font-size:23px } .content :not(pre)>code { background:var(--panel); padding:.1em .32em; border-radius:4px } .annotated-code { margin:22px 0; padding:0; border:1px solid var(--line); border-radius:10px; overflow:hidden } .annotated-code figcaption { padding:9px 13px; border-bottom:1px solid var(--line); background:var(--panel); font-size:13px } .code-note { display:grid; grid-template-columns:minmax(0,1fr) minmax(220px,34%); align-items:start } pre { margin:0; padding:14px; overflow:auto; font:13px/1.55 ui-monospace,SFMono-Regular,monospace; background:color-mix(in srgb,var(--panel) 48%,transparent) } .code-note pre { min-height:100% } .code-line { display:block } .line-number { display:inline-block; width:2.7em; margin-right:.7em; color:var(--muted); text-align:right; user-select:none } aside.note { padding:14px; font-size:14px; background:var(--panel); border-left:1px solid var(--line) } .card-list,.touch-list { padding-left:0; list-style:none } .card-list li,.touch-list li { margin:10px 0 } .meta { color:var(--muted); font-size:13px } @media (max-width:820px) { body { grid-template-columns:1fr } .sidebar { border-right:0; border-bottom:1px solid var(--line) } .code-note { grid-template-columns:1fr } aside.note { border-left:0; border-top:1px solid var(--line) } }
</style>
</head>
<body><aside class="sidebar"><a class="brand" href="${relativeHref(current, "index.html")}">StudyWiki 讲解站</a>${renderNavigation(current, site)}</aside><main>${breadcrumb}<article class="content">${content}</article></main></body>
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

/** 渲染变更史页。 */
function renderChangePage(issue, page, current, site) {
  const content = `<h1>${escapeHtml(page.title)}</h1><p class="meta">Issue ${escapeHtml(issue)}</p>${renderTouches(page.touches, current, site)}<section><h2>功能层</h2>${renderMarkdown(page.functional)}</section><section><h2>架构层</h2>${renderMarkdown(page.architectural)}</section><section><h2>代码细节层</h2>${renderMarkdown(page.code)}</section>`;
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
  const entries = (title, id, items) => `<section id="${escapeHtml(id)}"><h2>${escapeHtml(title)}</h2><ul class="card-list">${items.map((item) => `<li><a href="${relativeHref("index.html", item.href)}">${escapeHtml(item.label)}</a>${item.description ? `<span class="meta"> — ${escapeHtml(item.description)}</span>` : ""}</li>`).join("")}</ul></section>`;
  const content = `<h1>StudyWiki Walkthrough</h1>${overview}${entries("功能导览", "features", [...site.features.keys()].sort().map((slug) => ({ href: `features/${slug}.html`, label: site.features.get(slug).title ?? slug, description: site.featureIndex?.features?.find((feature) => feature.slug === slug)?.summary })))}${entries("文件注解", "files", [...site.filePages.keys()].sort().map((source) => ({ href: `files/${source}.html`, label: source, description: site.filePages.get(source).summary })))}${entries("变更史", "changes", [...site.changes.keys()].sort().map((issue) => ({ href: `changes/${issue}.html`, label: site.changes.get(issue).title ?? issue })))}`;
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
export function buildSite(root, outDir) {
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
  }

  const assets = path.join(resolvedRoot, "walkthrough/assets");
  if (existsSync(assets) && readdirSync(assets).length > 0) {
    cpSync(assets, path.join(resolvedOut, "assets"), { recursive: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rootArg, outArg] = process.argv.slice(2);
  try {
    buildSite(rootArg ?? process.cwd(), outArg);
  } catch (error) {
    console.error(`build-walkthrough: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
