import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// 钉子（PR #15 检视 §6.14）：doc-markdown 的关闭守卫在每个窗口注册 onCloseRequested
// 监听后，tauri 无条件拦截原生关闭（prevent_close），关窗只能经 wrapper 自动
// destroy()——该调用受 ACL 门禁，权限缺失时被拒且拒绝落在包装层 promise，
// release 下无可见出口（症状：点 X 零反应）。这类失败无运行期症状可测
// （vitest mock 掉 Tauri 边界，权限面在测试射程外），只能钉配置面：
// capabilities 必须持有窗口销毁权限。
test("capabilities：default 含窗口销毁权限 core:window:allow-destroy（X 关窗链路终点）", () => {
  const raw = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");
  const caps = JSON.parse(raw) as { permissions: string[] };
  expect(caps.permissions).toContain("core:window:allow-destroy");
});
