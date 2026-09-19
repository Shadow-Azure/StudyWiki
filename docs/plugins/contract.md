# 外置插件契约

[English](contract.en.md) | 中文

> 类型：参考 | 读者：插件作者与 AI agent。发布与供应链流程见 [authoring.md](authoring.md)；装载与热路径行为见 [dynamic.md](dynamic.md)。

## 模块形状

外置插件是一个零依赖单文件 ESM 模块，导出三件套：`name`（非空字符串）、`apply(ctx, config)`（函数，可返回清理函数）、`inject`（可选字符串数组）。宿主装载时逐字段校验，缺什么点名拒载。最小可用示例：

```js
export const name = "hello-topbar";
export const inject = ["slots"];
export function apply(ctx) {
  return ctx.slots.register("topbar.left", (el) => {
    const s = document.createElement("span");
    s.textContent = "你好";
    el.append(s);
  });
}
```

## inject 即权限声明

apply 拿到的 ctx 是 guard 门面：只能读 inject 声明过的宿主服务（`files` / `windows` / `workspace` / `slots` / `plugins`），读普通未声明属性当场抛错并点名补声明；未声明的 JS 协议属性 `then` / `toJSON` / `toString` / `valueOf` 按缺席处理。ctx 与宿主服务对象的顶层形状只读：赋值、删除与 `defineProperty` 都抛错；服务方法直接返回的 cordis Context（含 promise 解出的返回值）会被拒绝。声明了但宿主没提供的服务：插件停在等待态，激活审计 2 秒后判失败，面板点名"声明的服务未提供"。

## 边界（诚实声明）

门面收窄的是服务面，不是语言能力：插件代码仍可触达 DOM、`fetch` 与全局对象，装进容器或对象字段里的 Context 也不会被深扫——这不是沙箱。只安装你信任的插件。

## 失败处置

装载期失败（形状不符 / apiVersion 不在支持集 {1} / 入口读不到）不影响其他插件：面板行点名原因，其余行照常运行。apply 返回的清理函数在停用、重载、移除时由宿主调用一次；DOM 监听与定时器请在清理函数里自行拆除。

## apiVersion

package.json 的 `studywiki.apiVersion` 是契约版本，宿主支持集当前为 {1}，不在集内即拒载；扩集须先改宿主支持面，再回来改本节。
