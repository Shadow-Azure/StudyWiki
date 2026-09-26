# Agent Note: Excel 查看器与可编辑数据模型

Status: implemented

[English](2026-09-20-excel-viewer.en.md) | 中文

## Problem

m1 要求 markdown / excel / 视频三格式可读，excel 缺席；且后续诉求不止查看——人要从页面编辑单元格与样式，AI agent（m2）也要读写同一文件。选型必须同时满足：构建期可打包（环境无关性）、读改写尽量保真、人与 AI 走同一宿主契约面。

## Decision

- 架构采用「前端 ExcelJS 数据模型 + Rust 字节边界」：ExcelJS workbook 是唯一 xlsx 数据模型（解析、编辑、序列化都在前端）；Rust 不理解 xlsx，只做字节读写、路径根域校验与原子落盘。
- 新增第 6 个宿主服务 `ctx.excel`（独立于 `ctx.files`）：`read(path) → Workbook`、`write(path, workbook) → void`。表格语义独立成服务，guard 白名单、AI 工具面、测试边界干净；人与 AI 共用同一契约，无特例。
- `ctx.files` 二进制读写走 Tauri 2 raw IPC：body 是 `Uint8Array`，路径经 `x-studywiki-path` header 传 UTF-8 percent 编码；`ctx.excel` 在其上封装 ExcelJS。分层保持「格式语义归前端、系统触达归宿主」。
- 格式范围仅 `.xlsx`；csv / 老式 .xls / .xlsm 列为 `other` 并保留在文件树，点击交给 shell 主区提示不支持预览，未来支持要另立独立 issue，不混入多 sheet 契约。
- Rust `EXCEL_EXTS = ["xlsx"]` 分派，`FileNode.kind` 增加 `"excel"`（TS/Rust 同形，type-equiv 围栏同步）。
- 查看器（本期 m1-01）：sheet 切换、虚拟滚动、样式渲染（字体、加粗斜体、填充色、边框、对齐、常见数字/日期格式子集、合并单元格、列宽）、空 sheet 空态；`ctx.excel.write` 服务面本期落地（契约完整），但页面编辑 UI 不做。
- 编辑（m1-03 已落地）：单元格值内联编辑、样式工具条（加粗/斜体/字体色/填充色/合并）、单击 + Shift 单击矩形选区、脏标记与关窗守卫，保存走 `ctx.excel.write` → Rust 原子写 → `fs://changed` 广播。
- 编辑输入采用电子表格惯例但收窄：十进制样式（含科学计数法）自动转 number，空白清空，其余保持文本；前导半角 `'` 强制文本，用于保留 `007`、学号、身份证号等长数字。`0x10` / `0b101` 不数值化，与 Excel/WPS 一致。
- 拖拽框选拆至 #42：虚拟滚动下目标行未挂载，需要边缘自动滚动与索引追踪；本 issue 只交付单击 + Shift 单击，契约可增量。
- raw binary IPC 补 in-process 集成测试：read/write 两条命令经 Tauri MockRuntime 的真实 IPC resolver（`InvokeRequest` + raw body/path header）；macOS WebviewWindow 必须主线程创建，该测试 crate 使用 `harness = false`。Windows CI 中该 MockRuntime integration 可执行文件稳定以 `STATUS_ENTRYPOINT_NOT_FOUND` 拒载，故 Windows 运行显式 skip driver，真实 resolver 用例保留在 macOS/Linux CI。
- 保真边界 A+B：数据级 + 样式级编辑，写回保留大部分样式/合并/公式；图表、透视表等复杂对象不承诺无损（学习资料场景内容为王）。
- 错误处理：解析失败由服务层收敛为「文件损坏或不是有效 .xlsx，请确认来源或另存」的稳定文案，查看器内错误面板展示且不透出依赖原文；超大文件设单元格数上限（约 100 万），超限提示拒绝打开；编辑期写失败保持脏状态并提示，不丢输入。

## Alternatives considered

- Rust 侧 calamine 解析：只读最优、环境无关干净，但不支持写；为编辑换 umya-spreadsheet 则维护度与性能存疑，且格式语义 split 两侧。否——编辑诉求下优势归零。
- 前端 SheetJS（npm 0.18.5）：数据可编辑，但 community 版写回丢样式/图表，且 npm 版本 2022 年后停更、官方转向自家 CDN 分发（违反环境无关性）。否。
- 前端自写最小解析器：读尚可行（zip + XML），读写都做则是巨坑。否。
- 把 excel 语义塞进 `ctx.files`：少一个服务，但 guard 白名单与 AI 工具面混杂，测试边界模糊。否——独立 `ctx.excel`。

## Consequences

- 流程门禁支持同一 PR 激活 backlog issue：HEAD 已推进为 ready/in-progress/done 时按开工处理；base 已 done 的引用仍拒绝。
- `exceljs` 进 `dependencies` 并登记 `scripts/dep-allowlist.json`；构建期打包，无 CDN / 运行时加载，`verify:env-independence` / `verify:dep-audit` 必须绿。
- bundle 体积增加；大表全量 workbook 在前端内存，靠虚拟滚动与单元格上限保护。上限在 ExcelJS 解析完成后按各 sheet 声明维度（rowCount × columnCount）累计——保护渲染与模型驻留，不覆盖解析内存峰值；远端留过格式痕迹的近空文件同样计入。
- 宿主服务从五个变六个（files / windows / workspace / slots / plugins / excel），architecture 文档与 code map 同步更新。
- m1-01 交付查看器 + 完整读写服务面；m1-03 交付页面编辑与样式工具；拖拽框选见 #42，m1-02 阅读体验统一依赖查看器先存在。
- AI 接入（m2）只需把 `ctx.excel` 加入 guard 白名单，读写路径与人完全一致。
