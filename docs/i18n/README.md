# 双语配对

[English](README.en.md) | 中文

语料内每篇文档中英双语成对，"两侧说同一件事"由机器公证：人只做翻译取舍，一致性归门禁。本页是配对契约的唯一 home。

## 三件套

- 一对是同目录三个文件：中文 base `foo.md` + 英文侧 `foo.en.md` + 一致性记录 `foo.i18n.yaml`。成对合并——PR 永远三件同落，不落单侧。
- 两种语言同等权威：先写哪侧都合法，另一侧对照翻译，没有哪侧是"译文附庸"。
- 记录存两侧的 git blob hash（`git hash-object` 语义，未提交内容也能算，故本地即时可校验）。改任一侧 → 对照该侧 diff **最小修补**另一侧（不是重翻）→ `pnpm record:i18n -- docs/foo.md` 重录；yaml 的 diff 就是可评审的"确认一致"动作。
- 恢复：记录 yaml 的任一历史版本，其两侧 blob 必在 git 对象库中可达，可作重录前的对照原文。

## 语言切换行

每篇语料都带切换行：base 侧 `[English](foo.en.md) | 中文`，英文侧 `English | [中文](foo.md)`。普通文档放在 H1 后第一个非空行；Agent Note 放在 `Status:` 行之后（前三行格式是另一门禁的固定契约，不占用）。两侧都必须有，门禁校验。

## 结构镜像

两侧结构必须镜像：标题层级与顺序、代码围栏（info 串与内容**逐字相同**——围栏内的注释、图示文字不翻译）、表格行列数、列表种类/有序起点/条数、链接目标（切换行除外）。语料内相对链接：base 侧用 `.md`、英文侧用 `.en.md`；query 与非 md 目标的 fragment 逐字保留；md 目标的 fragment 是标题的 locale 投影，不进镜像，由死锚门禁按侧校验。生成区（`<!-- BEGIN GENERATED -->`）除 locale 投影的文档路径外逐字节一致。

## 术语与提示词

翻译供给链受机械背书：[terminology.md](terminology.md) 数据行两侧逐字一致，登记的禁用替写出现在英文侧散文即红；[translation-prompt.md](translation-prompt.md) 是补英文侧的操作模板，占位符集合由 verify-terminology 校验。

## 门禁与工作流

- `pnpm verify:docs` 含 verify-translation-pairing：三件齐、hash 相符、切换行、链接 locale、生成区、结构签名，任一不符即红。
- 日常循环：改 A 侧 → 最小修补 B 侧 → `--write` 重录，同一 PR 落地；漂移的 pair 过不了 CI。
- 门禁的边界：绿只证明"上次确认时的内容没漂移"，不证明翻译是对的——语义忠实与措辞是评审职责。

## 范围与豁免

语料 = 根 `README.md`、`docs/**`、`.agents/notes/**`（`archived/` 除外——冻结件由归档门禁管辖，sha256 冻结强于配对）。豁免唯一登记处是 [scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json)（只有 excluded 字段）：目前为两处 AGENTS.md（agent 指令层，与蓝本一致单语）。新增豁免须改 manifest 并在 PR 说明理由。
