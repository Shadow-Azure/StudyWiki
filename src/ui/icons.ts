/** 内联 SVG 图标库：无外链、无字体依赖，currentColor 描边随文字色。
 * 图标元素不产生 textContent，可安全进入有精确文本断言的树行。
 * 全部经 createElementNS 显式构造：WebKit（WKWebView）对 div.innerHTML
 * 解析出的 SVG 不绘制（Chrome 正常），显式构造三引擎一致。 */

/** SVG 命名空间 URI：DOM 规范强制的标识符（createElementNS 第一参数），
 * 永不发起网络请求；环境无关性豁免登记见 docs/environment-independence.md。 */
const SVG_NS = "http://www.w3.org/2000/svg";

/** 单个图标 = 一列 (标签, 属性) 声明式片段。 */
const ICONS = {
  "chevron-right": [["path", { d: "M6 3.8 10.6 8 6 12.2" }]],
  doc: [
    ["path", { d: "M4.6 1.8h4.2l3 3v9.4H4.6z" }],
    ["path", { d: "M8.8 1.8v3h3" }],
  ],
  play: [["path", { d: "M5.8 4.4v7.2l6-3.6z", fill: "currentColor", stroke: "none" }]],
  save: [
    ["path", { d: "M4.5 2.5h6l2 2v9h-8z" }],
    ["path", { d: "M6.5 2.5v3h3v-3" }],
    ["path", { d: "M6.5 13.5v-3.5h3v3.5" }],
  ],
  eye: [
    ["path", { d: "M2.4 8C3.9 5.3 5.8 4.2 8 4.2s4.1 1.1 5.6 3.8C12.1 10.7 10.2 11.8 8 11.8S3.9 10.7 2.4 8Z" }],
    ["circle", { cx: 8, cy: 8, r: 1.9 }],
  ],
  pencil: [
    ["path", { d: "M3 13l.8-2.9 7-7 2.1 2.1-7 7L3 13Z" }],
    ["path", { d: "M10 3.4 12.6 6" }],
  ],
  folder: [["path", { d: "M2.5 4.3h3.6l1.5 1.7h5.9v5.7H2.5z" }]],
  "folder-open": [
    ["path", { d: "M2.5 12.5V3.5h3.8l1.5 1.7h5.7v1.6" }],
    ["path", { d: "M2.5 12.5l1.8-5h9.5l-1.8 5z" }],
  ],
  window: [
    ["rect", { x: 3, y: 3, width: 10, height: 9, rx: 1.2 }],
    ["path", { d: "M3 5.6h10" }],
  ],
  module: [
    ["rect", { x: 3, y: 3, width: 4.4, height: 4.4, rx: 0.8 }],
    ["rect", { x: 8.6, y: 3, width: 4.4, height: 4.4, rx: 0.8 }],
    ["rect", { x: 3, y: 8.6, width: 4.4, height: 4.4, rx: 0.8 }],
    ["rect", { x: 8.6, y: 8.6, width: 4.4, height: 4.4, rx: 0.8 }],
  ],
  iceberg: [
    ["path", { d: "M3.1 9.2 5.8 3.5 8 6.3 9.4 4.6 12.7 9.2" }],
    ["path", { d: "M4.4 10.4 8 13l3.7-2.6" }],
    ["path", { d: "M2.3 9.7h11.4" }],
  ],
  refresh: [
    ["path", { d: "M13.5 8a5.5 5.5 0 1 1-1.62-3.9" }],
    ["path", { d: "M13.7 2.6v3h-3" }],
  ],
  alert: [
    ["path", { d: "M8 2.6 14.2 13H1.8L8 2.6Z" }],
    ["path", { d: "M8 6.6v3" }],
    ["path", { d: "M8 11.3h.01" }],
  ],
  close: [["path", { d: "M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" }]],
} as const;

/** 可用图标名（{@link icon} 的参数域）。 */
export type IconName = keyof typeof ICONS;

/** 造一枚 16px 网格描线图标（currentColor，aria-hidden）。
 * @param name 图标名（ICONS 键）。
 * @param size 视口边长 px，默认 16。
 * @returns 未挂载的 SVG 元素；调用方自行 append，不产生 textContent。 */
export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of ICONS[name]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
