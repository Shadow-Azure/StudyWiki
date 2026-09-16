# Agent Note: 工作台视觉系统重设计

Status: implemented

[English](2026-09-13-ui-refresh.en.md) | 中文

## Problem

前端此前是零样式原生控件：默认浏览器按钮、文字符号图标（▸ ▾ ▶ ●）、无阅读排版（markdown-body 完全裸奔）、模态面板硬编码白底。作为长时间阅读的学习客户端，观感与可读性都不达标，且没有任何令牌层——后续 UI 改动无章可循。

## Decision

建立工作台视觉系统（styles.css 单文件，无逻辑）：

- **双主题令牌**：浅/深主题均为中性灰面与墨色文字，语义分层为面（chrome/paper/raise/code-bg/stage）、线（hairline 两阶）、墨（ink 三阶）、色（蓝色交互 / 红色仅未保存与警示）、字（UI 系统无衬线 13px / 阅读面宋体栈 17px / 等宽栈）、圆角阶（5/8px）。参考 VS Code 工作台令牌模式（`--vscode-*` 同构），随 `prefers-color-scheme` 切换。
- **文档工作台层级**：顶栏固定为品牌、居中活动文件名、右侧图标操作；侧栏标题粘顶；阅读与编辑同用 760px 度量；文档工具条粘顶，预览/编辑为显式分段控件，保存按钮用红色点表示脏态并把快捷键放进 `aria-keyshortcuts`。
- **侧栏可调**：sidebar 与 main 之间是全高 1px 发丝线；线本体不占栅格轨道，背后仅有不可见 7px pointer 命中区，拖拽写入 `--sidebar-size`。侧栏绝对边界为 210–520px，同时 main 保持至少 340px；窗口收缩时按视口动态下调侧栏上限并同步 `aria-valuemax`，720px 最小窗口下侧栏仍收在约 380px，键盘左右/Home/End 同步 `aria-valuenow`。
- **Markdown 编辑面是文档面**：CodeMirror 使用 `minimalSetup`（去掉行号与折叠栏）、强制换行、透明背景、17px 阅读衬线栈与令牌化 Markdown 高亮；编辑与预览共享 760px 度量，不再呈现整页代码块。`@lezer/highlight` 从传递依赖提升为直接依赖，只为这份构建期打包的主题契约服务。
- **红色只作语义**：未保存点与错误条；欢迎页/品牌印章用墨色，避免装饰性大色块抢占内容。
- **品牌识别是冰山**：UI 内用 16px 网格内联 SVG（上为冰面、下为水下体与水线），原生 PNG/ICO/ICNS 从同一 1024px 深海渐变冰山主图派生；`src-tauri/icons/iceberg.svg` 是可再编辑源。
- **内联 SVG 图标库**（src/ui/icons.ts）：16px 网格 currentColor 描线，声明式 (标签, 属性) 片段 + `createElementNS` 显式构造。**WebKit（WKWebView）对 `div.innerHTML` 解析出的 SVG 不绘制**（Chrome 正常；静态标记与 createElementNS 均正常，探针四变体定位）——显式构造是唯一三引擎一致路线。代价是命名空间 URI 字面量命中环境无关性 URL 扫描，已按契约登记豁免（docs/environment-independence.md 豁免登记表 + 门禁精确 URI 白名单）：该 URI 是 DOM 规范标识符，永不联网；门禁不得放宽到整个 `www.w3.org` host。
- **浏览器视觉预览**（src/preview.ts + preview.html）：用内存宿主装配真实 app-shell、文件树、Markdown、视频、窗口与插件管理插件；槽位行为与生产 `SlotsService` 一致（每个 renderer 独立子元素）。该入口只服务本地 Vite 检视，不进入 `index.html` 发布入口。
- **DOM 契约测试同步**：树行文件名独立 span；分段模式暴露 `aria-pressed`；顶栏图标命令暴露 `aria-label`/`title`；不匹配的 viewer 插件隐藏自己的槽位，避免空槽把视频推到视口外。
- **保存错误条生命周期**：写失败可手动关闭；未关闭时后续保存成功会自动清除，避免已保存状态仍显示失败。
- **语义补强**：树行 aria-expanded/aria-current、面板 role=dialog + Esc 关闭 + 自动聚焦安装输入框 + Tab/Shift+Tab 焦点圈禁 + 关闭归还打开按钮、图标按钮 aria-label、`:focus-visible` 全局焦点环、reduced-motion 全灭动效。

## Alternatives considered

- **UI 框架（Vue/React 组件库）**：仓库硬约束禁止；CSS 变量令牌即无框架方案的专业标准（VS Code/cc-switch/waveterm 同构）。
- **照搬 DSH 的聊天式三栏界面**：DSH 的价值在令牌分层与稳定栅格，不在具体信息架构；StudyWiki 的主对象是文档，采用两栏文档工作台。
- **打包 CJK 网络字体**：思源宋体全集 ~10MB+，离线体积取舍不合算；系统宋体栈（Songti SC/SimSun）mac/win 皆预装。
- **保留文字符号图标**（▸ ▶ ●）：字体缺字回退不可控、无法着色、污染 textContent 断言。

## Consequences

- 后续一切 UI 走令牌 + 图标库 + `labelButton`（src/ui/dom.ts），不再写裸色值/文字符号/手搓按钮样板；新图标进 icons.ts 的 ICONS 一处登记。
- CodeMirror 主题经 `EditorView.theme` + `HighlightStyle` 注入，语法色引用既有 CSS 令牌，随主题联动；不要恢复行号/折叠栏把编辑面重新框成代码块。
- 视频暗室（stage 近黑）与主题解耦：观影面恒定暗底。
- Markdown 与视频插件在 kind 不匹配时隐藏自身槽位；槽位仍由宿主创建，插件只管理可见性。
- 浏览器预览不是发布入口，也不得引入真实 Tauri API 或运行时分支；新增 UI 面时优先扩展该预览，保持视觉检视可重复。
- 更换原生图标时先更新 `iceberg.svg` 与 1024px 主图，再派生全部尺寸；不要手改单个小图造成平台不一致。
- 插件面板 Esc 监听挂 document（重渲染销毁焦点元素后事件不再路过 overlay 子树）。
