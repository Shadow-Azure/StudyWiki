// walkthrough-flowchart 自测试：文字量尺、折行、dagre 布局与 SVG 绘制语义。

import { describe, expect, it } from "vitest";
import { measureLine, renderFlowchartSvg, wrapLabel } from "./walkthrough-flowchart.mjs";

describe("文字量尺", () => {
  it("CJK 按 1em、拉丁按 0.55em 估算", () => {
    expect(measureLine("中")).toBe(13);
    expect(measureLine("a")).toBeCloseTo(13 * 0.55, 5);
    expect(measureLine("中a")).toBeCloseTo(13 + 13 * 0.55, 5);
    expect(measureLine("")).toBe(0);
  });
});

describe("折行", () => {
  it("按最大宽度贪心折行，显式换行强制断行", () => {
    expect(wrapLabel("装载 YAML 源", 13 * 3)).toEqual(["装载", "YAML", "源"]);
    expect(wrapLabel("第一行\n第二行", 1000)).toEqual(["第一行", "第二行"]);
  });

  it("单字超宽也至少成一行，空标签返回单行", () => {
    expect(wrapLabel("中", 1)).toEqual(["中"]);
    expect(wrapLabel("", 100)).toEqual([""]);
  });
});

describe("SVG 绘制", () => {
  const chart = {
    title: "测试图",
    nodes: [
      { id: "a", label: "起点", shape: "stadium" },
      { id: "b", label: "处理 <数据> 与 & 转义", shape: "rounded" },
      { id: "c", label: "是否通过", shape: "diamond" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c", label: "是" },
    ],
  };

  it("产出带 viewBox 的 svg，含全部节点形状与箭头 marker", () => {
    const svg = renderFlowchartSvg(chart, "s1");
    expect(svg).toMatch(/^<svg class="flowchart" viewBox="0 0 \d+ \d+"/u);
    expect(svg).toContain('aria-label="测试图"');
    expect(svg).toContain("<title>测试图</title>");
    expect(svg).toContain('id="fc-arrow-s1"');
    expect(svg).toContain('marker-end="url(#fc-arrow-s1)"');
    expect((svg.match(/<rect /gu) ?? []).length).toBe(2);
    expect(svg).toContain("<polygon");
  });

  it("标签做 HTML 转义，文字可选中（text 元素）", () => {
    const svg = renderFlowchartSvg(chart, "s2");
    expect(svg).toContain("处理 &lt;数据&gt; 与 &amp; 转义");
    expect(svg).not.toContain("处理 <数据>");
    expect(svg).toContain("<text");
    // 居中锚点：文字以节点中心对称绘制，而不是从中心向右延伸。
    expect(svg).toContain('class="fc-label" font-size="13" text-anchor="middle"');
    expect(svg).toContain('class="fc-edge-label" font-size="11" text-anchor="middle"');
  });

  it("不同 idSuffix 生成不同 marker id，同页多图不冲突", () => {
    const a = renderFlowchartSvg(chart, "x");
    const b = renderFlowchartSvg(chart, "y");
    expect(a).toContain('id="fc-arrow-x"');
    expect(b).toContain('id="fc-arrow-y"');
  });

  it("TB 方向与缺省 title 都可渲染，回边经 dagre 绕排", () => {
    const svg = renderFlowchartSvg(
      {
        direction: "TB",
        nodes: [
          { id: "a", label: "甲" },
          { id: "b", label: "乙" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "a", label: "回退" },
        ],
      },
      "z",
    );
    expect(svg).toContain('class="fc-edge"');
    expect(svg).toContain("回退");
    expect((svg.match(/fc-edge"/gu) ?? []).length).toBe(2);
  });

  it("超长标签折成多行 tspan", () => {
    const svg = renderFlowchartSvg(
      {
        nodes: [
          { id: "a", label: "这是一个特别特别特别特别特别长的节点标签需要自动折行", shape: "rect" },
          { id: "b", label: "乙" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      "w",
    );
    expect((svg.match(/<tspan /gu) ?? []).length).toBeGreaterThan(2);
  });
});
