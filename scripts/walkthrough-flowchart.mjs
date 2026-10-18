// walkthrough 流程图渲染器：dagre 布局 + 手写 SVG 绘制，构建期把变更页 yaml 里的
// 结构化流程图（nodes/edges）渲染成内联 SVG。零 DOM 依赖、零外部资源；
// 文字宽度用逐字符模型估算（CJK/全角 1em、拉丁 0.55em），行为确定可单测。
// 布局算法 home 是 dagre（纯图计算）；绘制层（形状/箭头/标签）在本文件自持。

import dagre from "dagre";

const FONT_SIZE = 13;
const LINE_HEIGHT = 17;
const PAD_X = 16;
const PAD_Y = 11;
const MIN_NODE_WIDTH = 84;
const MAX_NODE_WIDTH = 220;
const EDGE_LABEL_FONT = 11;

/** HTML/SVG 文本转义。 */
function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** 单字符宽度（px）：CJK/全角按 1em，其余按 0.55em。 */
function charWidth(ch) {
  return /[⺀-꓏가-힯豈-﫿︰-﹏＀-￯　-〿]/u.test(ch) ? FONT_SIZE : FONT_SIZE * 0.55;
}

/** 逐字符估算一行文本宽度。 */
export function measureLine(text) {
  let width = 0;
  for (const ch of String(text)) width += charWidth(ch);
  return width;
}

/**
 * 把标签按最大宽度贪心折行；显式 \n 强制换行。
 * 拉丁词与 CJK 字都是不可分割 token，空格只是断行机会——不会在词中间切开。
 * @param {string} label - 节点或边标签。
 * @param {number} maxWidth - 行宽上限（px）。
 * @returns {string[]} 折行结果（至少一行）。
 */
export function wrapLabel(label, maxWidth) {
  const tokens = [];
  let word = "";
  for (const ch of String(label)) {
    if (/[⺀-꓏가-힯豈-﫿︰-﹏＀-￯　-〿]/u.test(ch)) {
      if (word) {
        tokens.push(word);
        word = "";
      }
      tokens.push(ch);
    } else if (ch === "\n") {
      if (word) {
        tokens.push(word);
        word = "";
      }
      tokens.push("\n");
    } else if (ch === " ") {
      if (word) {
        tokens.push(word);
        word = "";
      }
      tokens.push(" ");
    } else {
      word += ch;
    }
  }
  if (word) tokens.push(word);

  const lines = [];
  let current = "";
  let width = 0;
  const pushLine = () => {
    lines.push(current.trimEnd());
    current = "";
    width = 0;
  };
  for (const token of tokens) {
    if (token === "\n") {
      pushLine();
      continue;
    }
    if (token === " ") {
      if (current && width + charWidth(" ") <= maxWidth) {
        current += " ";
        width += charWidth(" ");
      }
      continue;
    }
    const tokenWidth = measureLine(token);
    if (tokenWidth > maxWidth) {
      // 超长拉丁词退化为字符级硬切（罕见，如无空格长路径）。
      for (const ch of token) {
        const w = charWidth(ch);
        if (current && width + w > maxWidth) pushLine();
        current += ch;
        width += w;
      }
      continue;
    }
    if (current && width + tokenWidth > maxWidth) pushLine();
    current += token;
    width += tokenWidth;
  }
  if (current) lines.push(current.trimEnd());
  return lines.length ? lines : [""];
}

/** 计算节点外框尺寸：标签折行 + 内边距；判断框为菱形需额外余量。 */
function nodeBox(node) {
  const innerMax = MAX_NODE_WIDTH - PAD_X * 2;
  const lines = wrapLabel(node.label, innerMax);
  let textWidth = 0;
  for (const line of lines) textWidth = Math.max(textWidth, measureLine(line));
  const isDiamond = node.shape === "diamond";
  const slack = isDiamond ? 34 : 0;
  const width = Math.max(MIN_NODE_WIDTH, Math.ceil(textWidth + PAD_X * 2 + slack));
  const height = Math.ceil(lines.length * LINE_HEIGHT + PAD_Y * 2 + (isDiamond ? 22 : 0));
  return { lines, width, height };
}

/** 渲染单个节点形状（矩形/圆角/起止/判断）。 */
function renderNodeShape(node, box, dagreNode, idSuffix) {
  const { width, height } = box;
  const x = dagreNode.x - width / 2;
  const y = dagreNode.y - height / 2;
  const common = `class="fc-node fc-shape-${node.shape ?? "rect"}"`;
  switch (node.shape) {
    case "diamond": {
      const cx = dagreNode.x;
      const cy = dagreNode.y;
      const hw = width / 2;
      const hh = height / 2;
      return `<polygon ${common} points="${cx},${y} ${cx + hw},${cy} ${cx},${y + height} ${cx - hw},${cy}"/>`;
    }
    case "stadium":
      return `<rect ${common} x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}"/>`;
    case "rounded":
      return `<rect ${common} x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/>`;
    default:
      return `<rect ${common} x="${x}" y="${y}" width="${width}" height="${height}" rx="4"/>`;
  }
}

/** 渲染节点内多行文本（垂直居中）。 */
function renderNodeText(box, dagreNode) {
  const total = box.lines.length * LINE_HEIGHT;
  const startY = dagreNode.y - total / 2 + LINE_HEIGHT * 0.78;
  const tspans = box.lines
    .map((line, index) => `<tspan x="${dagreNode.x}" y="${(startY + index * LINE_HEIGHT).toFixed(1)}">${escapeText(line)}</tspan>`)
    .join("");
  return `<text class="fc-label" font-size="${FONT_SIZE}">${tspans}</text>`;
}

/** 把 dagre 边折点转成折线路径。 */
function edgePath(points) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

/**
 * 渲染流程图为内联 SVG。调用方须先过 schema 校验（见 walkthrough-lib.mjs）。
 * @param {object} chart - `{ title?, direction?, nodes, edges }`。
 * @param {string} idSuffix - 产物页内唯一后缀，避免 marker id 冲突。
 * @returns {string} SVG 字符串。
 */
export function renderFlowchartSvg(chart, idSuffix) {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  const direction = chart.direction === "TB" ? "TB" : "LR";
  graph.setGraph({ rankdir: direction, nodesep: 28, ranksep: 56, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));

  const boxes = new Map();
  for (const node of chart.nodes) {
    const box = nodeBox(node);
    boxes.set(node.id, box);
    graph.setNode(node.id, { width: box.width, height: box.height });
  }
  chart.edges.forEach((edge, index) => {
    graph.setEdge(edge.from, edge.to, { label: edge.label ?? "", width: 4, height: 4 }, `e${index}`);
  });
  dagre.layout(graph);

  const parts = [];
  const markerId = `fc-arrow-${idSuffix}`;
  parts.push(
    `<svg class="flowchart" viewBox="0 0 ${Math.ceil(graph.graph().width)} ${Math.ceil(graph.graph().height)}" role="img"${chart.title ? ` aria-label="${escapeText(chart.title)}"` : ""}>`,
    `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fc-arrow"/></marker></defs>`,
  );
  if (chart.title) parts.push(`<title>${escapeText(chart.title)}</title>`);

  chart.edges.forEach((edge, index) => {
    const dagreEdge = graph.edge(edge.from, edge.to, `e${index}`);
    if (!dagreEdge?.points?.length) return;
    const label = edge.label ? String(edge.label) : "";
    const labelAttr = label
      ? `<text class="fc-edge-label" font-size="${EDGE_LABEL_FONT}" x="${dagreEdge.x.toFixed(1)}" y="${(dagreEdge.y + EDGE_LABEL_FONT * 0.36).toFixed(1)}">${escapeText(label)}</text>`
      : "";
    parts.push(
      `<path class="fc-edge" d="${edgePath(dagreEdge.points)}" marker-end="url(#${markerId})"/>`,
      labelAttr,
    );
  });

  for (const node of chart.nodes) {
    const dagreNode = graph.node(node.id);
    const box = boxes.get(node.id);
    parts.push(`<g>${renderNodeShape(node, box, dagreNode, idSuffix)}${renderNodeText(box, dagreNode)}</g>`);
  }

  parts.push("</svg>");
  return parts.join("");
}
