// walkthrough 纯函数库：装载站点、校验封闭 schema，并执行锚点/登记/覆盖率/diff 对账。
// 待办：code-map 读取逻辑收敛 lib；覆盖率豁免残留检测。
// 除 checkAnchors、checkLineCoverage 与 parseSite 的明确读盘外，这里不做 IO 副作用。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseWalkthroughYaml } from "./walkthrough-yaml.mjs";

const OVERVIEW_KEYS = new Set(["kind", "sections"]);
const OVERVIEW_SECTION_KEYS = new Set(["heading", "body", "images"]);
const SECTION_KEYS = new Set(["heading", "body", "images", "generated"]);
const FEATURE_INDEX_KEYS = new Set(["features"]);
const FEATURE_INDEX_ITEM_KEYS = new Set(["slug", "title", "summary", "issue"]);
const MANIFEST_KEYS = new Set(["bootstrap", "lineCoverage"]);
const LINE_COVERAGE_KEYS = new Set(["threshold", "exemptions"]);
const FILE_PAGE_KEYS = new Set(["kind", "source", "summary", "segments"]);
const SEGMENT_KEYS = new Set(["snippet", "note"]);
const FEATURE_KEYS = new Set([
  "kind",
  "slug",
  "title",
  "behavior",
  "modules",
  "steps",
  "related",
]);
const STEP_KEYS = new Set(["ref", "note"]);
const REF_KEYS = new Set(["file", "snippet"]);
const RELATED_KEYS = new Set(["notes"]);
const CHANGE_KEYS = new Set([
  "kind",
  "issue",
  "title",
  "functional",
  "architectural",
  "code",
  "touches",
]);
const ACTIVE_ISSUE_STATUSES = new Set(["in-progress", "done"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 判断值是否是可校验的普通对象（不含数组与 null）。 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断值是否是非空字符串。 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** 判断值是否是非空字符串数组。 */
function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/** 判断值是否是字符串数组（可为空）。 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** 推导 walkthrough 页在仓库内的规范相对路径。 */
function pagePath(kind, key) {
  if (kind === "overview") return "walkthrough/overview.yaml";
  if (kind === "architecture") return "walkthrough/architecture.yaml";
  if (kind === "feature") return `walkthrough/features/${key}.yaml`;
  if (kind === "change") return `walkthrough/changes/${key}.yaml`;
  return `walkthrough/files/${key}.yaml`;
}

/** 向 errors 追加一条 `路径: 原因` 信息。 */
function push(errors, label, message) {
  errors.push(`${label}: ${message}`);
}

/** 键集合封闭校验；返回是否为普通对象。 */
function validateKeys(value, allowed, label, errors) {
  if (!isObject(value)) {
    push(errors, label, "必须是 map");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) push(errors, label, `未知键 ${key}`);
  }
  return true;
}

/** 必填字符串校验。 */
function requireString(value, field, label, errors) {
  if (!isNonEmptyString(value)) {
    push(errors, label, `${field} 必须是非空字符串`);
    return false;
  }
  return true;
}

/** overview 与 architecture 共用的 section schema；generated 仅 architecture 支持。 */
function validateSectionPage(page, kind, key, errors) {
  const label = pagePath(kind, key);
  if (!isObject(page)) {
    push(errors, label, `${kind} 页缺失或必须是 map`);
    return;
  }
  if (page.kind !== kind) {
    push(errors, label, "kind 必须是封闭集合之一");
  }
  if (!validateKeys(page, OVERVIEW_KEYS, label, errors)) return;
  if (!Array.isArray(page.sections) || page.sections.length === 0) {
    push(errors, label, "sections 必须是非空数组");
    return;
  }
  const sectionKeys = kind === "architecture" ? SECTION_KEYS : OVERVIEW_SECTION_KEYS;
  page.sections.forEach((section, index) => {
    const itemLabel = `${label} sections[${index}]`;
    if (kind === "overview" && section.generated !== undefined) {
      push(errors, itemLabel, "generated 仅 architecture 支持");
    }
    if (!validateKeys(section, sectionKeys, itemLabel, errors)) return;
    requireString(section.heading, "heading", itemLabel, errors);
    requireString(section.body, "body", itemLabel, errors);
    if (section.images !== undefined && !isNonEmptyStringArray(section.images)) {
      push(errors, itemLabel, "images 必须是非空字符串数组");
    }
    if (
      kind === "architecture" &&
      section.generated !== undefined &&
      (!isNonEmptyString(section.generated) || section.generated !== "code-map")
    ) {
      push(errors, itemLabel, "generated 只能是 code-map");
    }
  });
}

/** features.yaml 登记处：顶层封闭，登记项必填四个契约字段。 */
function validateFeatureIndex(site, errors) {
  const label = "features.yaml";
  const registry = site.featureIndex;
  if (!isObject(registry)) {
    push(errors, label, "必须是 map");
    return;
  }
  if (!validateKeys(registry, FEATURE_INDEX_KEYS, label, errors)) return;
  if (!Array.isArray(registry.features)) {
    push(errors, label, "features 必须是数组");
    return;
  }
  registry.features.forEach((item, index) => {
    const itemLabel = `${label} features[${index}]`;
    if (!isObject(item)) {
      push(errors, itemLabel, "必须是 map");
      return;
    }
    if (!validateKeys(item, FEATURE_INDEX_ITEM_KEYS, itemLabel, errors)) return;
    requireString(item.slug, "slug", itemLabel, errors);
    requireString(item.title, "title", itemLabel, errors);
    requireString(item.summary, "summary", itemLabel, errors);
    requireString(item.issue, "issue", itemLabel, errors);
    if (isNonEmptyString(item.slug) && !SLUG_PATTERN.test(item.slug)) {
      push(errors, itemLabel, "slug 必须是 kebab-case");
    }
  });
}

/** manifest 键封闭：bootstrap 布尔，覆盖率只接受 threshold 与 exemptions。 */
function validateManifest(site, errors) {
  const label = "walkthrough/manifest.json";
  const manifest = site.manifest;
  if (manifest === null || manifest === undefined) return;
  if (!isObject(manifest)) {
    push(errors, label, "必须是 map");
    return;
  }
  if (!validateKeys(manifest, MANIFEST_KEYS, label, errors)) return;
  if (manifest.bootstrap !== undefined && typeof manifest.bootstrap !== "boolean") {
    push(errors, label, "bootstrap 必须是 boolean");
  }
  const coverage = manifest.lineCoverage;
  if (!isObject(coverage)) {
    push(errors, label, "lineCoverage 必须是 map");
    return;
  }
  const coverageLabel = `${label}.lineCoverage`;
  if (!validateKeys(coverage, LINE_COVERAGE_KEYS, coverageLabel, errors)) return;
  if (typeof coverage.threshold !== "number" || !Number.isFinite(coverage.threshold) ||
      coverage.threshold < 0 || coverage.threshold > 1) {
    push(errors, coverageLabel, "threshold 必须是 0 到 1 的数字");
  }
  if (!isObject(coverage.exemptions)) {
    push(errors, coverageLabel, "exemptions 必须是 map");
  }
}

/** file-page 的 segment schema。 */
function validateSegment(segment, label, index, errors) {
  const itemLabel = `${label} segments[${index}]`;
  if (!isObject(segment)) {
    push(errors, itemLabel, "segment 必须是 map");
    return;
  }
  if (!validateKeys(segment, SEGMENT_KEYS, itemLabel, errors)) return;
  requireString(segment.snippet, "snippet", itemLabel, errors);
  requireString(segment.note, "note", itemLabel, errors);
}

/** feature step 的 ref schema。 */
function validateStep(step, label, index, errors) {
  const itemLabel = `${label} steps[${index}]`;
  if (!isObject(step)) {
    push(errors, itemLabel, "step 必须是 map");
    return;
  }
  if (!validateKeys(step, STEP_KEYS, itemLabel, errors)) return;
  requireString(step.note, "note", itemLabel, errors);
  if (!isObject(step.ref)) {
    push(errors, itemLabel, "ref 必须是 map");
    return;
  }
  if (!validateKeys(step.ref, REF_KEYS, itemLabel, errors)) return;
  requireString(step.ref.file, "ref.file", itemLabel, errors);
  requireString(step.ref.snippet, "ref.snippet", itemLabel, errors);
}

/**
 * 校验 site 中全部页面的封闭 schema。
 * @param {object} site - parseSite 产出的站点对象。
 * @returns {string[]} 带源页相对路径的错误列表。
 */
export function validateSchema(site) {
  const errors = [];
  validateFeatureIndex(site, errors);
  validateManifest(site, errors);
  validateSectionPage(site.overview, "overview", "overview", errors);
  validateSectionPage(site.architecture, "architecture", "architecture", errors);

  for (const [slug, feature] of site.features) {
    const label = pagePath("feature", slug);
    if (!isObject(feature)) {
      push(errors, label, "feature 页必须是 map");
      continue;
    }
    if (feature.kind !== "feature") {
      push(errors, label, "kind 必须是封闭集合之一");
    }
    if (!validateKeys(feature, FEATURE_KEYS, label, errors)) continue;
    requireString(feature.slug, "slug", label, errors);
    if (isNonEmptyString(feature.slug) && !SLUG_PATTERN.test(feature.slug)) {
      push(errors, label, "slug 必须是 kebab-case");
    }
    requireString(feature.title, "title", label, errors);
    requireString(feature.behavior, "behavior", label, errors);
    if (!isNonEmptyStringArray(feature.modules)) {
      push(errors, label, "modules 必须是非空字符串数组");
    }
    if (!Array.isArray(feature.steps) || feature.steps.length === 0) {
      push(errors, label, "steps 必须是非空数组");
    } else {
      feature.steps.forEach((step, index) => validateStep(step, label, index, errors));
    }
    // related.notes 的相对链接可达性校验由后续接线任务处理；这里只封闭形状。
    if (feature.related !== undefined) {
      if (!isObject(feature.related)) {
        push(errors, label, "related 必须是 map");
      } else {
        if (!validateKeys(feature.related, RELATED_KEYS, label, errors)) {
          // 已输出结构错误。
        } else if (!isStringArray(feature.related.notes)) {
          push(errors, label, "related.notes 必须是字符串数组");
        }
      }
    }
  }

  for (const [source, page] of site.filePages) {
    const label = pagePath("file-page", source);
    if (!isObject(page)) {
      push(errors, label, "file 页必须是 map");
      continue;
    }
    if (page.kind !== "file-page") {
      push(errors, label, "kind 必须是封闭集合之一");
    }
    if (!validateKeys(page, FILE_PAGE_KEYS, label, errors)) continue;
    requireString(page.source, "source", label, errors);
    requireString(page.summary, "summary", label, errors);
    if (!Array.isArray(page.segments) || page.segments.length === 0) {
      push(errors, label, "segments 必须是非空数组");
    } else {
      page.segments.forEach((segment, index) =>
        validateSegment(segment, label, index, errors),
      );
    }
  }

  for (const [issue, change] of site.changes) {
    const label = pagePath("change", issue);
    if (!isObject(change)) {
      push(errors, label, "change 页必须是 map");
      continue;
    }
    if (change.kind !== "change") {
      push(errors, label, "kind 必须是封闭集合之一");
    }
    if (!validateKeys(change, CHANGE_KEYS, label, errors)) continue;
    requireString(change.issue, "issue", label, errors);
    requireString(change.title, "title", label, errors);
    requireString(change.functional, "functional", label, errors);
    requireString(change.architectural, "architectural", label, errors);
    requireString(change.code, "code", label, errors);
    if (!isNonEmptyStringArray(change.touches)) {
      push(errors, label, "touches 必须是非空字符串数组");
    }
  }

  return errors;
}

/** 递归列出目录中的 yaml 文件，返回仓库相对 POSIX 路径。 */
function listYamlFiles(root, relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  const entries = readdirSync(absoluteDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listYamlFiles(root, relative));
    else if (entry.isFile() && entry.name.endsWith(".yaml")) files.push(relative);
  }
  return files;
}

/** 读取并解析一个 YAML 页；失败时写入 parseErrors 并返回 null。 */
function readYaml(root, relative, parseErrors) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) {
    parseErrors.push(`${relative}: 文件缺失`);
    return null;
  }
  try {
    return parseWalkthroughYaml(readFileSync(absolute, "utf8"), relative);
  } catch (error) {
    parseErrors.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** 设置 map 键并机械发现重复页。 */
function setUnique(map, key, value, label, parseErrors) {
  if (map.has(key)) parseErrors.push(`${label}: 重复页面键 ${key}`);
  map.set(key, value);
}

/**
 * 读取 walkthrough/ 全部 YAML 与 manifest，并按源路径/slug/issue 建索引。
 * @param {string} root - 仓库根目录。
 * @returns {object} Site 索引；解析失败不抛出，而是累积在 parseErrors。
 */
export function parseSite(root) {
  if (!isNonEmptyString(root)) throw new Error("root 必须是非空字符串");
  const parseErrors = [];
  const site = {
    overview: readYaml(root, "walkthrough/overview.yaml", parseErrors),
    architecture: readYaml(root, "walkthrough/architecture.yaml", parseErrors),
    featureIndex: readYaml(root, "walkthrough/features.yaml", parseErrors),
    features: new Map(),
    filePages: new Map(),
    changes: new Map(),
    manifest: null,
    parseErrors,
  };

  const manifestPath = "walkthrough/manifest.json";
  try {
    site.manifest = JSON.parse(readFileSync(path.join(root, manifestPath), "utf8"));
  } catch (error) {
    parseErrors.push(`${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const relative of listYamlFiles(root, "walkthrough/features")) {
    const slug = path.basename(relative, ".yaml");
    const page = readYaml(root, relative, parseErrors);
    if (!isObject(page)) continue;
    if (isNonEmptyString(page.slug) && page.slug !== slug) {
      parseErrors.push(`${relative}: slug 与文件名不一致`);
    }
    setUnique(site.features, isNonEmptyString(page.slug) ? page.slug : slug, page, relative, parseErrors);
  }

  for (const relative of listYamlFiles(root, "walkthrough/files")) {
    const source = relative.replace(/^walkthrough\/files\//u, "").replace(/\.yaml$/u, "");
    const page = readYaml(root, relative, parseErrors);
    if (!isObject(page)) continue;
    if (isNonEmptyString(page.source) && page.source !== source) {
      parseErrors.push(`${relative}: source 与镜像路径不一致`);
    }
    setUnique(site.filePages, isNonEmptyString(page.source) ? page.source : source, page, relative, parseErrors);
  }

  for (const relative of listYamlFiles(root, "walkthrough/changes")) {
    const issue = path.basename(relative, ".yaml");
    const page = readYaml(root, relative, parseErrors);
    if (!isObject(page)) continue;
    if (isNonEmptyString(page.issue) && page.issue !== issue) {
      parseErrors.push(`${relative}: issue 与文件名不一致`);
    }
    setUnique(site.changes, isNonEmptyString(page.issue) ? page.issue : issue, page, relative, parseErrors);
  }

  return site;
}

/**
 * 定位 trimEnd 归一化后的跨行 snippet。
 * @param {string} sourceText - 源码文本。
 * @param {string} snippet - 内容锚点。
 * @returns {{start:number,end:number,count:number}|null} 1-based 首个匹配区间与匹配次数。
 */
export function locateSnippet(sourceText, snippet) {
  if (typeof sourceText !== "string" || typeof snippet !== "string" || snippet === "") {
    return null;
  }
  const normalize = (text) => text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  const haystack = normalize(sourceText).join("\n");
  // 块标量天然保留末尾换行；定位前只剥掉恰好一个归一化换行，
  // 使 end 表示内容最后一行，并避免空尾行灌大覆盖率。
  let needle = normalize(snippet).join("\n");
  if (needle.endsWith("\n")) needle = needle.slice(0, -1);
  if (!haystack || !needle) return null;

  let cursor = haystack.indexOf(needle);
  if (cursor < 0) return null;
  const start = cursor;
  let count = 0;
  while (cursor >= 0) {
    count++;
    cursor = haystack.indexOf(needle, cursor + 1);
  }
  const lineAt = (position) => haystack.slice(0, position).split("\n").length;
  const startLine = lineAt(start);
  const endLine = startLine + (needle.match(/\n/g)?.length ?? 0);
  return { start: startLine, end: endLine, count };
}

/** 读取锚点目标；错误由调用方转为门禁信息。 */
function readSource(root, source, cache) {
  if (cache.has(source)) return cache.get(source);
  let text;
  try {
    text = readFileSync(path.join(root, source), "utf8");
  } catch (error) {
    text = null;
    cache.set(source, { error: error instanceof Error ? error.message : String(error) });
    return cache.get(source);
  }
  const value = { text };
  cache.set(source, value);
  return value;
}

/** 校验一个锚点并写入错误。 */
function checkAnchor(root, source, snippet, label, cache, errors) {
  const loaded = readSource(root, source, cache);
  if (loaded.error) {
    push(errors, source, `无法读取源文件（${label}）: ${loaded.error}`);
    return;
  }
  if (locateSnippet(loaded.text, snippet) === null) {
    push(errors, source, `锚点定位失败（${label}）`);
  }
}

/**
 * 校验 site 中全部内容锚点能在当前源码定位。
 * @param {string} root - 仓库根目录。
 * @param {object} site - 站点索引。
 * @returns {string[]} 错误列表。
 */
export function checkAnchors(root, site) {
  const errors = [];
  const cache = new Map();
  for (const [source, page] of site.filePages) {
    const label = pagePath("file-page", source);
    if (isObject(page) && Array.isArray(page.segments)) {
      page.segments.forEach((segment, index) => {
        if (isObject(segment) && isNonEmptyString(segment.snippet)) {
          checkAnchor(root, source, segment.snippet, `${label} segments[${index}]`, cache, errors);
        }
      });
    }
  }
  for (const [slug, feature] of site.features) {
    const label = pagePath("feature", slug);
    if (isObject(feature) && Array.isArray(feature.steps)) {
      feature.steps.forEach((step, index) => {
        if (isObject(step) && isObject(step.ref)) {
          const { file, snippet } = step.ref;
          if (isNonEmptyString(file) && isNonEmptyString(snippet)) {
            checkAnchor(root, file, snippet, `${label} steps[${index}]`, cache, errors);
          }
        }
      });
    }
  }
  return errors;
}

/** 从 code-map 扁平登记处取需对账的源文件路径。 */
function codeMapSources(codeMap) {
  if (!isObject(codeMap)) return [];
  return Object.entries(codeMap)
    .filter(([key, value]) =>
      typeof value === "string" &&
      key.includes("/") &&
      !key.startsWith("//") &&
      !key.startsWith("vendor/") &&
      !key.endsWith("/") &&
      path.posix.extname(key) !== "",
    )
    .map(([key]) => key)
    .sort();
}

/**
 * 对账文件页与 code-map 登记处，并校验 summary 逐字一致。
 * @param {object} site - 站点索引。
 * @param {object} codeMap - code-map.manifest.json 的扁平 map。
 * @returns {string[]} 错误列表。
 */
export function checkFilePages(site, codeMap) {
  const errors = [];
  const registered = codeMapSources(codeMap);
  const pageSources = new Set(site.filePages.keys());
  for (const source of registered) {
    if (!pageSources.has(source)) {
      errors.push(`文件页缺失: ${source}`);
      continue;
    }
    const page = site.filePages.get(source);
    if (isObject(page) && page.summary !== codeMap[source]) {
      errors.push(`summary 与 code-map 不一致: ${source}`);
    }
  }
  const registeredSet = new Set(registered);
  for (const source of [...pageSources].sort()) {
    if (!registeredSet.has(source)) errors.push(`孤儿文件页: ${source}`);
  }
  return errors;
}

/**
 * 对账 features.yaml 登记处与 features/ 页面目录。
 * @param {object} site - 站点索引。
 * @returns {string[]} 错误列表。
 */
export function checkFeatures(site) {
  const errors = [];
  const registry = isObject(site.featureIndex) ? site.featureIndex.features : null;
  if (!Array.isArray(registry)) {
    return ["features.yaml: features 必须是数组"];
  }
  const expected = new Set();
  for (const item of registry) {
    if (!isObject(item) || !isNonEmptyString(item.slug)) {
      errors.push("features.yaml: 每个 feature 必须有非空 slug");
      continue;
    }
    if (!SLUG_PATTERN.test(item.slug)) {
      errors.push(`features.yaml: 非法 feature slug ${item.slug}`);
    }
    if (expected.has(item.slug)) errors.push(`features.yaml: 重复 feature slug ${item.slug}`);
    expected.add(item.slug);
  }
  const pages = new Set(site.features.keys());
  for (const slug of [...expected].sort()) {
    if (!pages.has(slug)) errors.push(`功能页缺失: ${slug}`);
  }
  for (const slug of [...pages].sort()) {
    if (!expected.has(slug)) errors.push(`未登记功能页: ${slug}`);
  }
  return errors;
}

/**
 * 对账 changes 页与调用方读入的 flow issue 状态。
 * @param {object} site - 站点索引。
 * @param {Array<{slug:string,status:string}>} issues - flow issue 轻量投影。
 * @returns {string[]} 错误列表。
 */
export function checkChanges(site, issues) {
  const errors = [];
  if (!Array.isArray(issues)) return ["flow issues 必须是数组"];
  const allSlugs = new Set();
  const activeSlugs = new Set();
  for (const issue of issues) {
    if (!isObject(issue) || !isNonEmptyString(issue.slug)) continue;
    if (allSlugs.has(issue.slug)) errors.push(`重复 flow issue: ${issue.slug}`);
    allSlugs.add(issue.slug);
    if (ACTIVE_ISSUE_STATUSES.has(issue.status)) activeSlugs.add(issue.slug);
  }
  for (const slug of [...activeSlugs].sort()) {
    if (!site.changes.has(slug)) errors.push(`变更页缺失: ${slug}`);
  }
  for (const issue of [...site.changes.keys()].sort()) {
    if (!allSlugs.has(issue)) errors.push(`变更页指向不存在 issue: ${issue}`);
  }
  return errors;
}

/**
 * 校验每个文件页覆盖的行区间比例。
 * @param {string} root - 仓库根目录。
 * @param {object} site - 站点索引。
 * @returns {string[]} 错误列表。
 */
export function checkLineCoverage(root, site) {
  const errors = [];
  const coverage = isObject(site.manifest) ? site.manifest.lineCoverage : null;
  if (!isObject(coverage) || typeof coverage.threshold !== "number" ||
      !Number.isFinite(coverage.threshold) || coverage.threshold < 0 || coverage.threshold > 1) {
    return ["walkthrough/manifest.json: lineCoverage.threshold 必须是 0 到 1 的数字"];
  }
  if (!isObject(coverage.exemptions)) {
    return ["walkthrough/manifest.json: lineCoverage.exemptions 必须是 map"];
  }

  const cache = new Map();
  for (const source of [...site.filePages.keys()].sort()) {
    const exemption = coverage.exemptions[source];
    if (exemption !== undefined && !isNonEmptyString(exemption)) {
      push(errors, source, "覆盖率豁免理由必须是非空字符串");
      continue;
    }
    if (exemption !== undefined) continue;

    const page = site.filePages.get(source);
    const loaded = readSource(root, source, cache);
    if (loaded.error) {
      push(errors, source, `无法读取源文件: ${loaded.error}`);
      continue;
    }
    const nonEmptyTotal = loaded.text.split("\n").filter((line) => line.trim() !== "").length;
    const covered = new Set();
    if (isObject(page) && Array.isArray(page.segments)) {
      for (const segment of page.segments) {
        if (!isObject(segment)) continue;
        const located = locateSnippet(loaded.text, segment.snippet);
        if (!located) continue;
        for (let line = located.start; line <= located.end; line++) covered.add(line);
      }
    }
    if (nonEmptyTotal === 0) {
      push(errors, source, "源文件没有非空行可计入覆盖率");
      continue;
    }
    const ratio = covered.size / nonEmptyTotal;
    if (ratio < coverage.threshold) {
      const percent = (value) => `${(value * 100).toFixed(2)}%`;
      errors.push(`行覆盖率低于阈值: ${source} (${percent(ratio)} < ${percent(coverage.threshold)})`);
    }
  }
  return errors;
}

/** 归一化 git 输出中的路径分隔符。 */
function normalizePath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/") : "";
}

/** 判断 diff 文件是否属于强制文件页对账的源码域。 */
function isForcedSource(file) {
  return file.startsWith("src/") || file.startsWith("src-tauri/src/");
}

/**
 * 校验注入的 PR diff 与 walkthrough 页/touches 的增量同步。
 * touches 的 file:/feature: 前缀封闭语法与引用可达性留给后续接线任务；
 * 本函数只检查 file: 字符串对 diff 源文件的覆盖。
 * @param {string[]} diffFiles - `git diff --name-only base...HEAD` 的注入结果。
 * @param {object} site - 站点索引。
 * @returns {string[]} 错误列表。
 */
export function checkDiff(diffFiles, site) {
  const errors = [];
  if (!Array.isArray(diffFiles)) return ["diffFiles 必须是字符串数组"];
  // diff 列表是 CLI 契约边界：坏项整条 fail-loud，不做静默归一化。
  if (diffFiles.some((item) => typeof item !== "string")) {
    return ["diffFiles 每项必须是字符串"];
  }
  const diff = new Set(diffFiles.map(normalizePath));
  const changedSources = [...diff].filter(isForcedSource);

  for (const source of changedSources) {
    const page = `walkthrough/files/${source}.yaml`;
    if (!site.filePages.has(source)) errors.push(`改码但缺少文件页: ${source}`);
    else if (!diff.has(page)) errors.push(`改码但 ${page} 未在同一 diff 修改`);
  }

  const touched = new Set();
  for (const change of site.changes.values()) {
    const touches = isObject(change) && Array.isArray(change.touches) ? change.touches : [];
    for (const touch of touches) {
      if (typeof touch === "string" && touch.startsWith("file:")) {
        touched.add(normalizePath(touch.slice("file:".length)));
      }
    }
  }
  for (const source of changedSources) {
    if (!touched.has(source)) errors.push(`changes touches 缺少 file 引用: ${source}`);
  }
  return errors;
}
