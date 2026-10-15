// walkthrough 专用 YAML 子集解析器。只支持 walkthrough 源页用到的声明式形状：
// 顶层 map、一层嵌套 map、标量/行内列表/块标量，以及标量或 map 列表。
// 这里刻意不引入 YAML 依赖；超出子集的语法必须 fail-loud。

const MAX_MAP_DEPTH = 1;

/** 本子集的 map 不继承 Object.prototype，防止 `__proto__` 特殊键绕过校验。 */
function newMap() {
  return Object.create(null);
}

/** 返回缩进空格数；本子集不接受 tab 缩进。 */
function indentOf(line, file, lineNo) {
  const match = /^( *)(.*)$/.exec(line);
  if (match[2].startsWith("\t"))
    throw new Error(`${file}:${lineNo}: 缩进只能使用空格`);
  return match[1].length;
}

/** 解析裸标量；引号、锚点、tag 和负整数不属于本子集。 */
function parseScalar(raw, file, lineNo) {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^["']/.test(value))
    throw new Error(`${file}:${lineNo}: 不支持引号字符串`);
  if (/^[&*!]/.test(value))
    throw new Error(`${file}:${lineNo}: 不支持锚点或 YAML tag`);
  if (/^[-+]\d+$/.test(value))
    throw new Error(`${file}:${lineNo}: 只支持非负整数`);
  if (/^[|>{[]/.test(value))
    throw new Error(`${file}:${lineNo}: 不支持的 YAML 值形式`);
  if (!value)
    throw new Error(`${file}:${lineNo}: 标量不能为空`);
  return value;
}

/** 解析 `[a, b]`；空列表合法，项必须是裸标量。 */
function parseInlineList(raw, file, lineNo) {
  const text = raw.trim();
  if (!text.startsWith("[") || !text.endsWith("]"))
    throw new Error(`${file}:${lineNo}: 行内列表格式应为 [a, b]`);
  const body = text.slice(1, -1).trim();
  if (!body) return [];
  return body.split(",").map((item) => {
    if (!item.trim())
      throw new Error(`${file}:${lineNo}: 行内列表项不能为空`);
    return parseScalar(item, file, lineNo);
  });
}

/** 解析一行右侧的标量或行内列表；`|` 与子容器由调用方处理。 */
function parseValue(raw, file, lineNo) {
  const text = raw.trim();
  if (text === "[]") return [];
  if (text.startsWith("["))
    return parseInlineList(text, file, lineNo);
  return parseScalar(text, file, lineNo);
}

/** 定位 `key:` 分隔点；冒号后必须有空白或行尾。 */
function keySplit(line) {
  const match = /:(?:\s|$)/.exec(line);
  return match ? match.index : -1;
}

/** 跳过块标量外的空行与整行注释。 */
function skipIgnorable(lines, index) {
  while (index < lines.length) {
    const text = lines[index].text.trim();
    if (text && !text.startsWith("#")) break;
    index++;
  }
  return index;
}

/**
 * 消费 `|` 的块体：块内空行与 `#` 行原样保留。首个非空行决定块缩进；
 * 更深行保留相对缩进，浅于块缩进的非空行结束块并交回外层缩进检查。
 */
function consumeBlockScalar(lines, cursor, parentIndent, file) {
  const raw = [];
  let blockIndent;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.text.trim()) {
      const indent = indentOf(line.text, file, line.no);
      if (indent <= parentIndent) break;
      if (blockIndent === undefined) blockIndent = indent;
      // 浅于块缩进但深于父缩进的行结束块；控制权交回外层缩进检查。
      if (indent < blockIndent) break;
    }
    raw.push(line.text);
    cursor++;
  }
  return {
    value: raw.map((line) => `${line.slice(blockIndent ?? 0)}\n`).join(""),
    cursor,
  };
}

/** 读取下一条有效行；返回 null 表示输入结束。 */
function peek(lines, cursorBox) {
  const index = skipIgnorable(lines, cursorBox.index);
  cursorBox.index = index;
  return index < lines.length ? lines[index] : null;
}

/** 解析一条 `key: value`，右侧也可指向子 map/list 或块标量。 */
function parseEntry(lines, cursorBox, target, raw, valueIndent, depth, file, lineNo) {
  const split = keySplit(raw);
  if (split < 0)
    throw new Error(`${file}:${lineNo}: 期望 key: value`);
  const key = raw.slice(0, split).trim();
  const value = raw.slice(split + 1).trim();
  if (!key)
    throw new Error(`${file}:${lineNo}: map 键不能为空`);
  if (/^["']/.test(key))
    throw new Error(`${file}:${lineNo}: 不支持引号 key`);
  if (Object.hasOwn(target, key))
    throw new Error(`${file}:${lineNo}: 重复键 ${key}`);

  if (value === "|") {
    const block = consumeBlockScalar(lines, cursorBox.index, valueIndent, file);
    target[key] = block.value;
    cursorBox.index = block.cursor;
    return;
  }
  if (value) {
    target[key] = parseValue(value, file, lineNo);
    return;
  }

  const child = peek(lines, cursorBox);
  if (!child)
    throw new Error(`${file}:${lineNo}: ${key}: 缺少子节点`);
  const childIndent = indentOf(child.text, file, child.no);
  if (childIndent !== valueIndent + 2)
    throw new Error(`${file}:${child.no}: 子节点缩进必须为 ${valueIndent + 2} 格`);
  const childText = child.text.trim();
  if (childText.startsWith("- ")) {
    target[key] = parseList(lines, cursorBox, childIndent, depth, file);
  } else {
    target[key] = parseMap(lines, cursorBox, childIndent, depth + 1, file);
  }
}

/** 解析固定缩进的 map；depth=0 是顶层，1 是允许的唯一嵌套层。 */
function parseMap(lines, cursorBox, indent, depth, file) {
  if (depth > MAX_MAP_DEPTH) {
    const line = peek(lines, cursorBox);
    throw new Error(`${file}:${line?.no ?? lines.length}: 只支持一层嵌套 map`);
  }
  const result = newMap();
  let sawEntry = false;

  for (;;) {
    const line = peek(lines, cursorBox);
    if (!line) break;
    const lineIndent = indentOf(line.text, file, line.no);
    if (lineIndent < indent) break;
    if (lineIndent > indent)
      throw new Error(`${file}:${line.no}: 缩进过深（期望 ${indent} 格）`);
    const text = line.text.trim();
    if (text.startsWith("- "))
      throw new Error(`${file}:${line.no}: map 键不能是列表项`);

    sawEntry = true;
    cursorBox.index++;
    parseEntry(lines, cursorBox, result, text, indent, depth, file, line.no);
  }

  if (!sawEntry) {
    const line = peek(lines, cursorBox);
    throw new Error(`${file}:${line?.no ?? lines.length}: map 不能为空`);
  }
  return result;
}

/** 解析固定缩进的列表；项可为裸标量或 `- key: value` 开始的 map。 */
function parseList(lines, cursorBox, indent, depth, file) {
  const result = [];
  let sawItem = false;

  for (;;) {
    const line = peek(lines, cursorBox);
    if (!line) break;
    const lineIndent = indentOf(line.text, file, line.no);
    if (lineIndent < indent) break;
    if (lineIndent > indent)
      throw new Error(`${file}:${line.no}: 缩进过深（期望列表项位于 ${indent} 格）`);
    const text = line.text.trim();
    if (/^- {2,}/.test(text))
      throw new Error(`${file}:${line.no}: 列表项 \`-\` 后应恰一个空格`);
    if (!text.startsWith("- "))
      throw new Error(`${file}:${line.no}: 期望 "- item"`);
    const item = text.slice(2);
    if (item.startsWith("- "))
      throw new Error(`${file}:${line.no}: 不支持列表项嵌套`);

    sawItem = true;
    cursorBox.index++;
    if (keySplit(item) < 0) {
      result.push(parseScalar(item, file, line.no));
      continue;
    }
    // dash 和一个空格正好占两格，因此列表项 map 的内容缩进是 indent + 2。
    const map = newMap();
    const itemIndent = indent + 2;
    parseEntry(lines, cursorBox, map, item, itemIndent, depth, file, line.no);
    // 首键后、下一个 dash 前，同一缩进的行都归属这个列表项 map。
    for (;;) {
      const continuation = peek(lines, cursorBox);
      if (!continuation) break;
      const continuationIndent = indentOf(continuation.text, file, continuation.no);
      if (continuationIndent < itemIndent) break;
      if (continuationIndent > itemIndent)
        throw new Error(`${file}:${continuation.no}: 缩进过深（期望 ${itemIndent} 格）`);
      const continuationText = continuation.text.trim();
      if (continuationText.startsWith("- "))
        throw new Error(`${file}:${continuation.no}: 列表项 map 不能嵌套列表项`);
      cursorBox.index++;
      parseEntry(lines, cursorBox, map, continuationText, itemIndent, depth, file, continuation.no);
    }
    result.push(map);
  }

  if (!sawItem) {
    const line = peek(lines, cursorBox);
    throw new Error(`${file}:${line?.no ?? lines.length}: 列表不能为空`);
  }
  return result;
}

/**
 * 解析 walkthrough YAML 子集。
 * @param {string} text - YAML 文本。
 * @param {string} path - 错误信息中的文件路径。
 * @returns {object} 顶层 map。
 * @throws {Error} 超出子集或语法不合法时抛 `path:行号: 原因`。
 */
export function parseWalkthroughYaml(text, path) {
  if (typeof text !== "string")
    throw new Error(`${path}:1: YAML 文本必须是字符串`);
  if (typeof path !== "string" || !path)
    throw new Error("walkthrough-yaml:1: path 必须是非空字符串");

  const physicalLines = text.replace(/\r\n?/g, "\n").split("\n");
  // 结尾换行是行终止符，不是块标量中的一个空行。
  if (physicalLines.at(-1) === "") physicalLines.pop();
  const lines = physicalLines.map((raw, index) => ({ text: raw, no: index + 1 }));
  const cursorBox = { index: 0 };
  const result = parseMap(lines, cursorBox, 0, 0, path);
  if (peek(lines, cursorBox))
    throw new Error(`${path}:${lines[cursorBox.index].no}: 顶层只能是 map`);
  return result;
}
