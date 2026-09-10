# Vendored 上游登记

| 包 | 来源 | 版本 | 上游 commit | 收编日期 | 本地改动 |
|---|---|---|---|---|---|
| cordis | github.com/Shadow-Azure/cordis（fork of cordiverse/cordis）packages/core | 4.0.0-rc.10 | f8ea3cd50f1a5724e8e715995bcde131c9c12b2c | 2026-09-11 | 无 |
| cosmokit | npm registry tarball | 1.8.1 | npm pack sha256 见下 | 2026-09-11 | `lib/index.mjs` 去除尾部 `//# sourceMappingURL=index.mjs.map` 注释（vendor 不含映射源，注释会让 vitest 每次报 sourcemap 警告） |

cosmokit tarball sha256（运行时入口 `lib/index.mjs`，1.8.1 的 lib 内无 `index.js`，ESM 入口为 `index.mjs`）：

```
8c493c6ab7e44ab7608e407e84a79e86dfb6c17b8067cbccfcf29c011285f72a  lib/index.mjs
```

规则：升级 = 手动 diff + 在本表登记改动；`src/` 级扫描规则覆盖 vendor 源码（零 node: 引用由 Task 1 冒烟与门禁共同看住）。
