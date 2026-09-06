#!/usr/bin/env node
// Gate: 常驻文档词数预算（manifest 是唯一权威）。计数规则：CJK 字符按字计，
// 其余按空白分词——中英混排下两侧权重一致。
// 处置顺序：搬层 → 压缩 → 提预算（PR 里说明理由）。预算是护栏不是瘦身目标。

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const MANIFEST = "scripts/doc-budgets.manifest.json";

export function countWords(text) {
  const cjk = (text.match(/[㐀-鿿豈-﫿぀-ヿ]/g) ?? []).length;
  const stripped = text.replace(/[㐀-鿿豈-﫿぀-ヿ]/g, " ");
  const words = stripped.split(/\s+/).filter(Boolean).length;
  return cjk + words;
}

export default async function verifyDocBudgets() {
  const errors = [];
  const budgets = JSON.parse(await readFile(MANIFEST, "utf8"));

  for (const [file, ceiling] of Object.entries(budgets)) {
    if (file.startsWith("//")) continue; // "//" 是注释键的约定，不是路径

    const full = path.resolve(file);
    if (!existsSync(full)) {
      errors.push(`${file}: 预算登记了但文件不存在（删除登记或恢复文件）`);
      continue;
    }
    const text = await readFile(full, "utf8");
    const count = countWords(text);
    if (count > ceiling)
      errors.push(`${file}: ${count} 词超预算 ${ceiling}（先搬层/压缩，提预算须 PR 说明）`);
  }
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyDocBudgets();
  if (!result.ok) {
    console.error(`verify-doc-budgets: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log("verify-doc-budgets: ok");
}
