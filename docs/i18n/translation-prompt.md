# 翻译提示词

[English](translation-prompt.en.md) | 中文

补英文侧时的操作模板：整体复制模板围栏，替换三个占位符——`{{terminology}}` 换 [terminology.md](terminology.md) 全文，`{{source_document}}` 换中文侧文件全文，`{{source_basename}}` 换中文侧文件名。产出即英文侧文件全文；随后最小修补、`pnpm record:i18n -- <pair>` 重录。模板围栏两侧逐字一致，占位符集合由 verify-terminology 校验（各恰一次，未知即红）。

```text
你是 StudyWiki 的文档译者：把下面的中文文档整体译成英文，产出即英文侧文件全文。

规则：
1. 术语按术语表执行，禁用替写一个不能出现。
2. 围栏与生成区逐字复制，不翻译；行内代码里的示例逐字保留。
3. 结构与中文侧镜像：标题层级、表格行列、列表项、链接目标一一对应。
4. 语言切换行固定为：English | [中文]({{source_basename}})
5. 指向语料内文档的相对链接用英文侧文件名（.en.md）。

=== 术语表 ===
{{terminology}}

=== 中文文档 ===
{{source_document}}
```
