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
const MANIFEST_KEYS = new Set(["bootstrap", "lineCoverage", "reviewCoverage"]);
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
  "scale",
  "feature",
  "userFlow",
  "architectural",
  "codeMap",
  "reviewGuide",
  "verification",
  "touches",
]);
const SCALE_KEYS = new Set(["files", "additions", "deletions"]);
const CODE_MAP_GROUP_KEYS = new Set(["group", "attention", "why", "files"]);
const CODE_MAP_FILE_KEYS = new Set(["path", "note", "changes"]);
const CODE_MAP_CHANGE_KEYS = new Set(["snippet", "note"]);
const REVIEW_GUIDE_KEYS = new Set(["order", "risks", "acceptance"]);
const ACCEPTANCE_KEYS = new Set(["item", "evidence"]);
const CHANGE_ATTENTIONS = new Set(["must-read", "skim", "skip"]);
/**
 * 机械变更路径归类规则：命中任一规则的路径由机器生成/维护，不承载语义讲解。
 * 用途有二：codeMap 组里机械路径不得标 must-read；--diff 对账时机械路径
 * 不被 codeMap.files 覆盖也合法。`.github/workflows/` 刻意不在其中——
 * 流水线变更需要人读。
 */
export const MECHANICAL_PATTERNS = [
  /\.i18n\.yaml$/u,
  /^docs\/commands\./u,
  /(^|\/)pnpm-lock\.yaml$/u,
];
const ACTIVE_ISSUE_STATUSES = new Set(["in-progress", "done"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 源代码路径（must-read 组必须带 changes 检视注解的范围）。 */
export function isReviewableSourcePath(file) {
  return typeof file === "string" && /^(?:src|scripts|src-tauri)\//u.test(file) && !isMechanicalPath(file);
}

/** 判断仓库相对路径是否命中机械归类规则。 */
export function isMechanicalPath(file) {
  return typeof file === "string" && MECHANICAL_PATTERNS.some((pattern) => pattern.test(file));
}

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
  if (
    manifest.reviewCoverage !== undefined &&
    (typeof manifest.reviewCoverage !== "number" || !Number.isFinite(manifest.reviewCoverage) ||
      manifest.reviewCoverage < 0 || manifest.reviewCoverage > 1)
  ) {
    push(errors, label, "reviewCoverage 必须是 0 到 1 的数字");
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

/** change 页 scale：{files, additions, deletions} 非负整数三元组。 */
function validateScale(scale, label, errors) {
  const scaleLabel = `${label} scale`;
  if (!isObject(scale)) {
    push(errors, label, "scale 必须是 map");
    return;
  }
  if (!validateKeys(scale, SCALE_KEYS, scaleLabel, errors)) return;
  for (const field of ["files", "additions", "deletions"]) {
    const value = scale[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      push(errors, scaleLabel, `${field} 必须是非负整数`);
    }
  }
}

/** change 页 codeMap：变更地图分组；机械路径不得标 must-read。 */
function validateCodeMap(codeMap, label, errors) {
  if (!Array.isArray(codeMap) || codeMap.length === 0) {
    push(errors, label, "codeMap 必须是非空数组");
    return;
  }
  codeMap.forEach((group, index) => {
    const groupLabel = `${label} codeMap[${index}]`;
    if (!isObject(group)) {
      push(errors, groupLabel, "必须是 map");
      return;
    }
    if (!validateKeys(group, CODE_MAP_GROUP_KEYS, groupLabel, errors)) return;
    requireString(group.group, "group", groupLabel, errors);
    if (!CHANGE_ATTENTIONS.has(group.attention)) {
      push(errors, groupLabel, "attention 必须是 must-read|skim|skip 之一");
    }
    if (typeof group.why !== "string" && group.why !== null) {
      push(errors, groupLabel, "why 必须是字符串或 null");
    }
    if (!Array.isArray(group.files) || group.files.length === 0) {
      push(errors, groupLabel, "files 必须是非空数组");
      return;
    }
    group.files.forEach((file, fileIndex) => {
      const fileLabel = `${groupLabel} files[${fileIndex}]`;
      if (!isObject(file)) {
        push(errors, fileLabel, "必须是 map");
        return;
      }
      if (!validateKeys(file, CODE_MAP_FILE_KEYS, fileLabel, errors)) return;
      requireString(file.path, "path", fileLabel, errors);
      requireString(file.note, "note", fileLabel, errors);
      if (
        group.attention === "must-read" &&
        isNonEmptyString(file.path) &&
        isMechanicalPath(file.path)
      ) {
        push(errors, fileLabel, `机械变更不得标 must-read: ${file.path}`);
      }
      if (
        group.attention === "must-read" &&
        isNonEmptyString(file.path) &&
        isReviewableSourcePath(file.path) &&
        (!Array.isArray(file.changes) || file.changes.length === 0)
      ) {
        push(errors, fileLabel, `must-read 组的源代码文件必须带 changes 检视注解: ${file.path}`);
      }
    });
  });  // changes（hunk 注解）形状校验：可选，出现则必须是 {snippet,note} 列表。
  for (const group of codeMap) {
    if (!isObject(group) || !Array.isArray(group.files)) continue;
    for (const file of group.files) {
      if (!isObject(file) || file.changes === undefined) continue;
      if (!Array.isArray(file.changes)) {
        errors.push(`${label} codeMap ${file.path ?? "?"}: changes 必须是列表`);
        continue;
      }
      file.changes.forEach((change, index) => {
        if (!isObject(change) || !Object.keys(change).every((key) => CODE_MAP_CHANGE_KEYS.has(key)) || typeof change.snippet !== "string" || typeof change.note !== "string") {
          errors.push(`${label} codeMap ${file.path ?? "?"} changes[${index}]: 必须是 {snippet, note}`);
        }
      });
    }
  }

}

/** change 页 reviewGuide：阅读顺序 + 风险点 + 验收对照。 */
function validateReviewGuide(reviewGuide, label, errors) {
  const guideLabel = `${label} reviewGuide`;
  if (!isObject(reviewGuide)) {
    push(errors, label, "reviewGuide 必须是 map");
    return;
  }
  if (!validateKeys(reviewGuide, REVIEW_GUIDE_KEYS, guideLabel, errors)) return;
  if (
    !Array.isArray(reviewGuide.order) ||
    reviewGuide.order.length === 0 ||
    !reviewGuide.order.every(isNonEmptyString)
  ) {
    push(errors, guideLabel, "order 必须是非空字符串数组");
  }
  if (!isStringArray(reviewGuide.risks)) {
    push(errors, guideLabel, "risks 必须是字符串数组");
  }
  if (!Array.isArray(reviewGuide.acceptance) || reviewGuide.acceptance.length === 0) {
    push(errors, guideLabel, "acceptance 必须是非空数组");
    return;
  }
  reviewGuide.acceptance.forEach((entry, index) => {
    const entryLabel = `${guideLabel} acceptance[${index}]`;
    if (!isObject(entry)) {
      push(errors, entryLabel, "必须是 map");
      return;
    }
    if (!validateKeys(entry, ACCEPTANCE_KEYS, entryLabel, errors)) return;
    requireString(entry.item, "item", entryLabel, errors);
    requireString(entry.evidence, "evidence", entryLabel, errors);
  });
}

/** change 页的非空字符串数组字段（userFlow/verification）。 */
function requireNonEmptyStringArray(value, field, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    push(errors, label, `${field} 必须是非空字符串数组`);
  }
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
    validateScale(change.scale, label, errors);
    requireString(change.feature, "feature", label, errors);
    requireNonEmptyStringArray(change.userFlow, "userFlow", label, errors);
    requireString(change.architectural, "architectural", label, errors);
    validateCodeMap(change.codeMap, label, errors);
    validateReviewGuide(change.reviewGuide, label, errors);
    requireNonEmptyStringArray(change.verification, "verification", label, errors);
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
 * 定位整行 trim 归一化后的跨行 snippet（行首缩进差异不敏感——YAML 块标量必然剥统一缩进，顶格复制是常态）。
 * @param {string} sourceText - 源码文本。
 * @param {string} snippet - 内容锚点。
 * @returns {{start:number,end:number,count:number}|null} 1-based 首个匹配区间与匹配次数。
 */
export function locateSnippet(sourceText, snippet) {
  if (typeof sourceText !== "string" || typeof snippet !== "string" || snippet === "") {
    return null;
  }
  const normalize = (text) => text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
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
  // 变更页 changes 是历史检视注解：path 已不在当前树时按“历史归档”跳过；
  // 仍存在的源文件必须保证 snippet 可定位，防止注解漂移成无锚文本。
  for (const [slug, change] of site.changes) {
    const label = pagePath("change", slug);
    if (!isObject(change) || !Array.isArray(change.codeMap)) continue;
    for (const group of change.codeMap) {
      if (!isObject(group) || !Array.isArray(group.files)) continue;
      for (const file of group.files) {
        if (!isObject(file) || !isNonEmptyString(file.path)) continue;
        if (!existsSync(path.join(root, file.path))) continue;
        if (!Array.isArray(file.changes)) continue;
        file.changes.forEach((entry, index) => {
          const changeLabel = `${label} codeMap ${file.path} changes[${index}]`;
          if (!isObject(entry) || !isNonEmptyString(entry.snippet)) return;
          const loaded = readSource(root, file.path, cache);
          if (loaded.error || locateSnippet(loaded.text, entry.snippet) === null) {
            push(errors, file.path, `changes 注解 snippet 无法在源码中定位（${changeLabel}）`);
          }
        });
      }
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

/** 计算注解 snippet 的 after 内容行数（块标量的一个空尾行不计）。 */
function snippetLineCount(snippet) {
  const lines = String(snippet).replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

/**
 * --diff 档逐段上限：must-read 组 reviewable 源码文件的每条 changes 注解
 * 在 after 源码中最多锚定 20 行；skim/skip 与非源码路径不进入注意力骨架。
 * @param {string} root - 仓库根目录（与覆盖率对账共用调用缝）。
 * @param {object} site - 站点索引。
 * @param {string[]} targetSlugs - 本轮 review 关注的变更页 slug。
 * @returns {string[]} 错误列表。
 */
export function checkChangesSegments(root, site, targetSlugs) {
  if (root !== null && root !== undefined && typeof root !== "string") {
    return ["root 必须是字符串"];
  }
  if (!Array.isArray(targetSlugs)) return ["targetSlugs 必须是数组"];
  const errors = [];
  for (const slug of targetSlugs) {
    const page = site.changes.get(slug);
    if (!isObject(page) || !Array.isArray(page.codeMap)) continue;
    for (const group of page.codeMap) {
      if (!isObject(group) || group.attention !== "must-read" || !Array.isArray(group.files)) continue;
      for (const file of group.files) {
        if (!isObject(file) || !isReviewableSourcePath(file.path) || !Array.isArray(file.changes)) continue;
        file.changes.forEach((change, index) => {
          if (!isObject(change) || typeof change.snippet !== "string") return;
          const count = snippetLineCount(change.snippet);
          if (count > 20) {
            errors.push(`changes 注解每段不超过 20 行: ${file.path} changes[${index}] (${count} 行)`);
          }
        });
      }
    }
  }
  return errors;
}

/**
 * --diff 档注解覆盖率：must-read 组 reviewable 源码文件按 numstat additions
 * 汇总分母；各文件 changes snippet 在当前源码中的 after 区间取并集作分子。
 * 定位失败由锚点门禁单独红，这里按 0 计；无 additions 分母时不需要覆盖。
 * @param {string} root - 仓库根目录。
 * @param {object} site - 站点索引。
 * @param {Array<{additions:number, deletions:number, path:string}>} numstat - 注入的 numstat。
 * @param {string[]} targetSlugs - 本轮 review 关注的变更页 slug。
 * @returns {string[]} 错误列表。
 */
export function checkReviewCoverage(root, site, numstat, targetSlugs) {
  if (!Array.isArray(targetSlugs)) return ["targetSlugs 必须是数组"];
  if (!Array.isArray(numstat)) return ["numstat 必须是数组"];
  if (
    numstat.some((row) =>
      !isObject(row) ||
      typeof row.additions !== "number" ||
      typeof row.deletions !== "number" ||
      typeof row.path !== "string"
    )
  ) {
    return ["numstat 每项必须是 {additions, deletions, path}"];
  }
  const configured = isObject(site.manifest) ? site.manifest.reviewCoverage : undefined;
  const threshold = configured ?? 0.9;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return ["walkthrough/manifest.json: reviewCoverage 必须是 0 到 1 的数字"];
  }

  const targetPaths = new Set();
  for (const slug of targetSlugs) {
    const page = site.changes.get(slug);
    if (!isObject(page) || !Array.isArray(page.codeMap)) continue;
    for (const group of page.codeMap) {
      if (!isObject(group) || group.attention !== "must-read" || !Array.isArray(group.files)) continue;
      for (const file of group.files) {
        if (isObject(file) && isReviewableSourcePath(file.path)) targetPaths.add(normalizePath(file.path));
      }
    }
  }

  const additionsByPath = new Map(numstat.map((row) => [normalizePath(row.path), row.additions]));
  const denominator = [...targetPaths].reduce((sum, file) => sum + Math.max(0, additionsByPath.get(file) ?? 0), 0);
  if (denominator === 0) return [];

  const cache = new Map();
  const covered = new Set();
  for (const slug of targetSlugs) {
    const page = site.changes.get(slug);
    if (!isObject(page) || !Array.isArray(page.codeMap)) continue;
    for (const group of page.codeMap) {
      if (!isObject(group) || group.attention !== "must-read" || !Array.isArray(group.files)) continue;
      for (const file of group.files) {
        if (!isObject(file) || !isReviewableSourcePath(file.path) || !Array.isArray(file.changes)) continue;
        const source = normalizePath(file.path);
        if (!targetPaths.has(source)) continue;
        const loaded = readSource(root, source, cache);
        if (loaded.error) continue;
        for (const change of file.changes) {
          if (!isObject(change) || typeof change.snippet !== "string") continue;
          const located = locateSnippet(loaded.text, change.snippet);
          if (!located) continue;
          for (let line = located.start; line <= located.end; line += 1) covered.add(`${source}:${line}`);
        }
      }
    }
  }
  const ratio = covered.size / denominator;
  if (ratio >= threshold) return [];
  const actual = `${(ratio * 100).toFixed(2)}%`;
  const expected = `${threshold * 100}%`;
  return [`逐段注解覆盖率 <${expected}（实际 ${actual}）`];
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

/** 归一化 numstat 改名路径（`a/{b => c}/d` 与 `b => c` 两种形态取新路径）。 */
function normalizeNumstatPath(value) {
  return normalizePath(value)
    .replace(/\{[^{}]* => ([^{}]*)\}/u, "$1")
    .replace(/^.* => /u, "");
}

/**
 * 解析 `git diff --numstat` 输出为 {additions, deletions, path} 数组；
 * 二进制行的 `-` 计 0。坏行 fail-loud 抛错（CLI 契约边界）。
 * @param {string} text - numstat 原始输出。
 * @returns {Array<{additions:number, deletions:number, path:string}>} 行数组。
 */
export function parseNumstat(text) {
  if (typeof text !== "string") throw new Error("numstat 输出必须是字符串");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = /^(\d+|-)\t(\d+|-)\t(.+)$/u.exec(line);
      if (!match) throw new Error(`numstat 行格式非法: ${line}`);
      return {
        additions: match[1] === "-" ? 0 : Number.parseInt(match[1], 10),
        deletions: match[2] === "-" ? 0 : Number.parseInt(match[2], 10),
        path: normalizeNumstatPath(match[3]),
      };
    });
}

/**
 * --diff 档变更页对账：凡本 PR 新增/修改的 changes 页（diff 中出现
 * walkthrough/changes/<slug>.yaml 且该文件在本 PR 新建——base 无该文件，
 * 由 addedDiffFiles 给出）。scale totals 对账仅在本 PR 恰好新增一个变更页
 * 时执行——files 必须恰好相等，additions/deletions 允许 ±10% 容差（相对
 * 实际值，端点含内）；新增多页（bootstrap 型大 PR，页面描述各自的历史 PR）
 * 时 totals 结构上不可满足，退化为仅覆盖检查。codeMap 语义覆盖对全部新增
 * 变更页生效：codeMap.files 必须覆盖 diff 中全部语义路径。仅被修改的历史
 * 变更页只做 schema 静态检查：它们描述的是自己的历史 PR，scale 与本 diff
 * 无关。
 * 机械路径（MECHANICAL_PATTERNS）与 walkthrough/ 站点源自身豁免覆盖义务。
 * @param {string[]} diffFiles - `git diff --name-only base...HEAD` 的注入结果。
 * @param {object} site - 站点索引。
 * @param {Array<{additions:number, deletions:number, path:string}>} [numstat]
 *   `git diff --numstat` 解析结果；缺省时跳过 totals 对账、只做覆盖对账。
 * @param {string[]} [addedDiffFiles]
 *   `git diff --name-only --diff-filter=A base...HEAD` 的注入结果；对账对象
 *   是 changedSlugs 与它的交集；交集恰为一页时执行 totals 对账，多页时仅做
 *   覆盖检查；缺省视为空交集（不做对账）。
 * @returns {string[]} 错误列表。
 */
export function checkDiffScale(diffFiles, site, numstat, addedDiffFiles) {
  const errors = [];
  if (!Array.isArray(diffFiles)) return ["diffFiles 必须是字符串数组"];
  if (diffFiles.some((item) => typeof item !== "string")) {
    return ["diffFiles 每项必须是字符串"];
  }
  if (numstat !== undefined) {
    if (!Array.isArray(numstat)) return ["numstat 必须是数组"];
    if (
      numstat.some(
        (row) =>
          !isObject(row) ||
          typeof row.additions !== "number" ||
          typeof row.deletions !== "number" ||
          typeof row.path !== "string",
      )
    ) {
      return ["numstat 每项必须是 {additions, deletions, path}"];
    }
  }
  if (addedDiffFiles !== undefined) {
    if (!Array.isArray(addedDiffFiles)) return ["addedDiffFiles 必须是数组"];
    if (addedDiffFiles.some((item) => typeof item !== "string")) {
      return ["addedDiffFiles 每项必须是字符串"];
    }
  }
  const diff = diffFiles.map(normalizePath);
  const changedSlugs = [
    ...new Set(
      diff
        .map((file) => /^walkthrough\/changes\/([^/]+)\.yaml$/u.exec(file)?.[1])
        .filter(Boolean),
    ),
  ].sort();
  if (changedSlugs.length === 0) return errors;
  const addedSlugs = new Set(
    (addedDiffFiles ?? [])
      .map((file) => normalizePath(file))
      .map((file) => /^walkthrough\/changes\/([^/]+)\.yaml$/u.exec(file)?.[1])
      .filter(Boolean),
  );
  // 只有「本 PR 新建」的变更页参与对账；被修改的历史页豁免。
  const targetSlugs = changedSlugs.filter((slug) => addedSlugs.has(slug));
  if (targetSlugs.length === 0) return errors;

  // 裁决 G：totals 对账只在恰好新增一个变更页时执行；多页新增（bootstrap 型
  // 大 PR）页面各自描述历史 PR，任何单一 totals 都不可能同时等于全部页面，
  // 结构上不可满足，因此跳过、只保留覆盖检查。
  if (numstat !== undefined && targetSlugs.length === 1) {
    const totals = { additions: 0, deletions: 0 };
    for (const row of numstat) {
      totals.additions += row.additions;
      totals.deletions += row.deletions;
    }
    for (const slug of targetSlugs) {
      const page = site.changes.get(slug);
      // schema 规则已负责形状；这里只对形状合法的 scale 做对账。
      if (!isObject(page) || !isObject(page.scale)) continue;
      const label = pagePath("change", slug);
      const declared = page.scale;
      if (typeof declared.files === "number" && declared.files !== numstat.length) {
        push(
          errors,
          label,
          `scale.files=${declared.files} 与实际 diff 文件数 ${numstat.length} 不一致（须恰好相等）`,
        );
      }
      for (const [field, actual] of [
        ["additions", totals.additions],
        ["deletions", totals.deletions],
      ]) {
        const value = declared[field];
        if (typeof value !== "number") continue;
        if (Math.abs(value - actual) > actual * 0.1) {
          push(errors, label, `scale.${field}=${value} 超出实际 ${actual} 的 ±10% 容差`);
        }
      }
    }
  }

  const covered = new Set();
  for (const slug of targetSlugs) {
    const page = site.changes.get(slug);
    if (!isObject(page) || !Array.isArray(page.codeMap)) continue;
    for (const group of page.codeMap) {
      if (!isObject(group) || !Array.isArray(group.files)) continue;
      for (const file of group.files) {
        if (isObject(file) && isNonEmptyString(file.path)) {
          covered.add(normalizePath(file.path));
        }
      }
    }
  }
  const semantic = [
    ...new Set(
      diff.filter((file) => !file.startsWith("walkthrough/") && !isMechanicalPath(file)),
    ),
  ].sort();
  for (const file of semantic) {
    if (!covered.has(file)) errors.push(`变更页 codeMap 未覆盖语义路径: ${file}`);
  }
  return errors;
}
