# External plugin contract

English | [中文](contract.md)

> Type: reference | Readers: plugin authors and AI agents. Publishing and supply chain live in [authoring.md](authoring.en.md); loading and hot-path behaviour in [dynamic.md](dynamic.en.md).

## Module shape

An external plugin is a zero-dependency single-file ESM module that exports three things: `name` (non-empty string), `apply(ctx, config)` (function, may return a cleanup function) and `inject` (optional array of strings). The host validates field by field at load time and names the missing field when it refuses. Minimal working example:

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

## inject is a permission declaration

The ctx handed to apply is the guard facade: you can read only the host services your inject declares (`files` / `windows` / `workspace` / `slots` / `plugins`); reading any other undeclared property throws on the spot and names the declaration to add, while undeclared JavaScript protocol properties `then` / `toJSON` / `toString` / `valueOf` are absent. The top-level shapes of ctx and every host service object are read-only — assignment, deletion and `defineProperty` all throw — and a cordis Context returned directly from a service method (including as a resolved promise value) is rejected. A service you declared but the host never provides leaves the plugin parked: the activation audit fails after 2 seconds and the panel row says "the declared service is not provided".

## Boundaries (honest statement)

What the facade narrows is the service surface, not the language: plugin code can still reach the DOM, `fetch` and globals, and a Context tucked into a container or an object field is not deep-scanned — this is not a sandbox. Install only plugins you trust.

## Failure handling

A load-time failure (shape mismatch / apiVersion outside the support set {1} / unreadable entry) does not affect other plugins: the panel row names the reason while the rest keep running. The cleanup function apply returns is called once by the host on disable, reload and remove; tear down your DOM listeners and timers there.

## apiVersion

`studywiki.apiVersion` in package.json is the contract version; the host support set is {1} today and anything outside it is refused at load. Widening the set starts with the host surface, then this section.
