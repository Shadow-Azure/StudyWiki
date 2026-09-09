# Translation prompt

English | [中文](translation-prompt.md)

Operational template for adding the English side: copy the template fence wholesale and replace the three placeholders — `{{terminology}}` with the full [terminology.en.md](terminology.en.md), `{{source_document}}` with the full Chinese-side file, `{{source_basename}}` with the Chinese-side filename. The output is the English-side file verbatim; then minimally patch and re-record with `pnpm record:i18n -- <pair>`. The template fence is byte-identical across both sides; its placeholder set is checked by verify-terminology (each exactly once, unknown ones red).

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
