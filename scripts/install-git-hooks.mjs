#!/usr/bin/env node
// 安装本地 git 钩子（每个 clone 跑一次），刻意窄：pre-commit 只查暂存文本的尾随空白，
// pre-push 只跑 doc-quick。穷尽覆盖归 CI——钩子是提醒，不是门禁。幂等，重复安装安全。
// 同时注册 .i18n.yaml 的 fail-closed merge driver（.gitattributes 已引用），
// 免得安装入口散成两条命令。

import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { registerMergeDriver } from "./install-merge-driver.mjs";

const HOOKS = {
  "pre-commit": `#!/bin/sh
# Installed by scripts/install-git-hooks.mjs — do not edit.
status=0
for f in $(git diff --cached --name-only --diff-filter=ACM); do
  [ -f "$f" ] || continue
  if hits=$(grep -InE '[[:blank:]]+$' "$f" 2>/dev/null); then
    printf '%s\\n' "$hits" >&2
    echo "  ^ $f 有尾随空白" >&2
    status=1
  fi
done
[ $status -eq 0 ] || echo "pre-commit: 修掉尾随空白再提交（git commit --no-verify 可跳过，风险自担）" >&2
exit $status
`,
  "pre-push": `#!/bin/sh
# Installed by scripts/install-git-hooks.mjs — do not edit.
node scripts/run-gates.mjs --mode doc-quick || {
  echo "pre-push: doc-quick 未过（pnpm lint:docs）。git push --no-verify 可跳过，风险自担。" >&2
  exit 1
}
`,
};

for (const [name, body] of Object.entries(HOOKS)) {
  const file = path.join(".git", "hooks", name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  console.log(`install-git-hooks: .git/hooks/${name} 已写入`);
}

registerMergeDriver();
