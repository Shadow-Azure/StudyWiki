# 外置插件契约

[English](contract.en.md) | 中文

> 类型：参考 | 读者：插件作者与 AI agent。发布与装载行为见 [authoring.md](authoring.md)、[dynamic.md](dynamic.md)。

## 模块形状

外置插件是零依赖单文件 ESM，导出 `name`（非空字符串）、`apply(ctx, config)`（可返回清理函数）与可选 `inject` 字符串数组；宿主逐字段校验。槽位为 `activity.left`/`sidebar.tree`/`main.viewer`/`sidebar.right`；`topbar.left` 归一化为 `activity.left`。示例：

```js
export const name = "hello-activity";
export const inject = ["slots"];
export function apply(ctx) {
  return ctx.slots.register("activity.left", (el) => {
    const s = document.createElement("span");
    s.textContent = "你好";
    el.append(s);
  });
}
```

## inject 声明依赖，不是权限

`inject` 是 Cordis 依赖声明：决定插件等待哪些服务、何时启动，不授予权限。ctx 门面只暴露声明过的服务，但这是使用面，不是授权或沙箱；插件仍与宿主同进程运行。

书面外置 API 为 `files`/`windows`/`workspace`/`slots`/`plugins`/`llm`；`llm` 可调用 `listEndpoints`/`probe`/`chat`/`chatStream`；`transcribe`、`resolveAsrTarget` 与 `hasAsrCapability` 是内置 agent 独占的 llm 成员，不在外置承诺内。`agent`/`wiki` 是内置内部服务，不在承诺内；当前无独立服务名 allowlist，声明它们可能触达实现对象，但这只是实现细节，不是稳定 API 或权限。收紧暴露面应另设 allowlist 与成员白名单。

读未声明属性会抛错并提示补声明；`then`/`toJSON`/`toString`/`valueOf` 未声明时缺席。ctx 与服务顶层只读；服务方法返回的 cordis Context（含 Promise 解出值）被拒绝。声明但未提供的服务会等待，2 秒审计失败后点名。

## 边界（诚实声明）

插件可触达 DOM、`fetch` 与全局对象；容器字段里的 Context 不深扫。这不是沙箱，只安装信任的插件。

## 失败处置

装载期失败（形状/apiVersion 不在 {1}/入口读不到）不影响其他插件，面板点名原因。apply 的清理函数在停用/重载/移除时调用一次；请自行拆除 DOM 监听与定时器。

## apiVersion

package.json 的 `studywiki.apiVersion` 是契约版本；当前支持 {1}，集外拒载。扩集先改宿主服务面，再改本节。
