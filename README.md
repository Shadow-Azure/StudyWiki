# StudyWiki

[English](README.en.md) | 中文

**把本地笔记、课程视频和 AI 助手，放进同一个可扩展的学习工作区。**

[![StudyWiki 的真实工作区；点击图片观看中文介绍视频](docs/assets/studywiki-hero.png)](docs/assets/studywiki-intro.mp4)

[▶ 观看中文介绍视频（约 1 分钟）](docs/assets/studywiki-intro.mp4)

## 一个资料库，四种连续体验

- **阅读与观看**：同窗口打开 Markdown、Excel 与本地视频。
- **整理与复盘**：文件树、编辑预览与搜索保持思路连续。
- **Agent 协作**：读取、检索当前资料；写改先审批，会话可恢复。
- **沉淀与扩展**：llm-wiki 组织知识，外置插件添加能力。

## 快速开始

从源码构建：

```sh
pnpm install        # 安装构建依赖
pnpm tauri dev      # 启动开发模式
pnpm tauri build    # 构建桌面安装包
```

构建需要 Node ≥ 22、pnpm ≥ 10 与 Rust stable；平台工具链见[开发指南](docs/development.md)。

## 本地优先，边界清晰

阅读与播放完全离线；在线模型和插件安装是联网例外。发布产物无需另装运行时，完整边界见[环境无关性说明](docs/environment-independence.md)。

## 继续了解

- [架构与数据流](docs/architecture.md)
- [插件作者指南](docs/plugins/authoring.md)
- [贡献与质量门禁](docs/development.md)
- [产品路线图](.agents/flow/roadmap.md)
