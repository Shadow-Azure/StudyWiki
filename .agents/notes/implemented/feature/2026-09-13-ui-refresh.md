# Agent Note: 「书斋」视觉系统重设计

Status: implemented

[English](2026-09-13-ui-refresh.en.md) | 中文

## Problem

前端此前是零样式原生控件：默认浏览器按钮、文字符号图标（▸ ▾ ▶ ●）、无阅读排版（markdown-body 完全裸奔）、模态面板硬编码白底。作为长时间阅读的学习客户端，观感与可读性都不达标，且没有任何令牌层——后续 UI 改动无章可循。

## Decision

建立「书斋」视觉系统（styles.css 单文件，无逻辑）：

- **双主题令牌**：纸（浅）/ 墨（深），语义分层为面（chrome/paper/raise/code-bg/stage）、线（hairline 两阶）、墨（ink 三阶）、色（青黛 azurite 交互 / 朱砂 cinnabar 仅语义标记）、字（UI 系统无衬线 13px / 阅读面宋体栈 17px·行高2 / 等宽栈）、圆角阶（5/8/11px）。参考 VS Code 工作台令牌模式（`--vscode-*` 同构），随 `prefers-color-scheme` 切换。
- **排版主视觉在阅读面**：衬线正文、760px 书卷行宽、h2 章节线、朱批式 blockquote 左线；工具面保持 VS Code 式冷静密度。
- **朱砂只作语义**：未保存朱批点（save-btn.dirty::after）、错误条、欢迎页印章（「学」白文印）；交互色统一青黛。
- **内联 SVG 图标库**（src/ui/icons.ts）：16px 网格 currentColor 描线，声明式 (标签, 属性) 片段 + `createElementNS` 显式构造。**WebKit（WKWebView）对 `div.innerHTML` 解析出的 SVG 不绘制**（Chrome 正常；静态标记与 createElementNS 均正常，探针四变体定位）——显式构造是唯一三引擎一致路线。代价是命名空间 URI 字面量命中环境无关性 URL 扫描，已按契约登记豁免（docs/environment-independence.md 豁免登记表 + 门禁 ALLOWED 列表）：该 URI 是 DOM 规范标识符，永不联网。
- **DOM 改动外科手术式**（测试契约不动）：树行文件名独立 span（`textContent === "a.md"` 精确断言仍过）；工具条按钮顺序保持（mode 第一、save 第二）；SVG 不产生 textContent，图标可自由进入有文本断言的节点；插件面板按钮 textContent 保持纯文本（"安装"精确匹配）。
- **语义补强**：树行 aria-expanded/aria-current、面板 role=dialog + Esc 关闭 + 自动聚焦安装输入框、图标按钮 aria-label、`:focus-visible` 全局焦点环、reduced-motion 全灭动效。

## Alternatives considered

- **UI 框架（Vue/React 组件库）**：仓库硬约束禁止；CSS 变量令牌即无框架方案的专业标准（VS Code/cc-switch/waveterm 同构）。
- **打包 CJK 网络字体**：思源宋体全集 ~10MB+，离线体积取舍不合算；系统宋体栈（Songti SC/SimSun）mac/win 皆预装。
- **保留文字符号图标**（▸ ▶ ●）：字体缺字回退不可控、无法着色、污染 textContent 断言。

## Consequences

- 后续一切 UI 走令牌 + 图标库 + `labelButton`（src/ui/dom.ts），不再写裸色值/文字符号/手搓按钮样板；新图标进 icons.ts 的 ICONS 一处登记。
- CodeMirror 语法色经 `--syn-*` 令牌覆盖（tok-* 类选择器），随主题联动。
- 视频暗室（stage 近黑）与主题解耦：观影面恒定暗底。
- 顶栏文件名（topbar-file）与树行活动高亮新增 file-opened 订阅，均在各插件 teardown 内收口。
- 插件面板 Esc 监听挂 document（重渲染销毁焦点元素后事件不再路过 overlay 子树）。
