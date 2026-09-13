/** bootstrap 拒绝时的最小可见出口：向 #app 内联渲染错误文本与清理指引，
 * 替代白屏；错误仍同时进 console。外置装载失败不走到这里（boot 分治为
 * 坏行），这里兜的是清单损坏、内置审计失败这类致命错。
 * @param error 拒绝原因（Error 或任意值）。 */
export function renderBootError(error: unknown): void {
  console.error("bootstrap 失败：", error);
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  app.replaceChildren();
  const box = document.createElement("div");
  box.className = "boot-error";
  const title = document.createElement("h1");
  title.textContent = "StudyWiki 启动失败";
  const detail = document.createElement("pre");
  detail.textContent = error instanceof Error ? error.message : String(error);
  const hint = document.createElement("p");
  hint.textContent = "可尝试：删除应用配置目录下损坏的 plugins.json（及 plugins/ 目录）后重启；或提交 issue 附上上方信息。";
  box.append(title, detail, hint);
  app.append(box);
}
