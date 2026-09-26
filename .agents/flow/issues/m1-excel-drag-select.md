# excel 拖拽框选

[English](m1-excel-drag-select.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P2
status: backlog
scope:
  - src/plugins/doc-excel/**
  - src/styles.css
  - tests/**
adr:
  - ../../notes/implemented/feature/2026-09-20-excel-viewer.md
github:
  number: 42
  url: https://github.com/Shadow-Azure/StudyWiki/issues/42
```

## 背景

m1-03 落地的选区模型只含单击 + Shift 单击。拖拽框选与虚拟滚动冲突：拖出视口后目标行未挂载，需要边缘自动滚动与按行索引追踪，工作量集中在滚动交互边界，故拆为独立低优先级 issue，依赖 m1-03 的选区模型先就位。

## 目标

- 鼠标按下拖动扩展矩形选区，与单击、Shift+单击、内联编辑共存。
- 拖拽至视口边缘自动滚动并继续扩选；选区按行/列索引追踪，不依赖已挂载 DOM。
- 选区归一化与合并单元格命中规则复用 m1-03 的选区模型，工具条样式操作对拖拽选区生效。

## 验收

- 拖拽框选跨视口（自动滚动）选区结果正确，含未挂载行。
- 样式控件（加粗/斜体/颜色/合并）作用于拖拽选区，行为与 Shift 选区一致。
- 既有交互（单击选中、Shift 扩选、双击编辑）不回归；tests 绿。
- `pnpm verify:layering`、`pnpm verify:env-independence`、`pnpm verify:dep-audit` 绿。
