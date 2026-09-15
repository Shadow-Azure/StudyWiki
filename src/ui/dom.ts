import { icon, type IconName } from "./icons";

/** labelButton 的可选修饰。 */
export interface LabelButtonOptions {
  /** 整串类名，覆盖默认 "btn"（如 "btn btn-ghost"；空串 = 不带类）。 */
  className?: string;
  /** 无障碍名；纯图标按钮必给，默认取文案。 */
  ariaLabel?: string;
}

/** 造一枚「图标 + 文案」按钮（btn 视觉体系，图标居文案左侧；点击监听由调用方挂）。
 * 图标不产生 textContent，按钮文本保持纯文案。
 * @param name 图标名。
 * @param text 按钮文案；空串为纯图标按钮，此时必须给 ariaLabel。
 * @param opts 修饰项（整串类名/无障碍名）。
 * @returns 未挂载的 button 元素。 */
export function labelButton(name: IconName, text: string, opts: LabelButtonOptions = {}): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = opts.className ?? "btn";
  b.append(icon(name, 15));
  if (text) b.append(document.createTextNode(text));
  if (opts.ariaLabel) b.setAttribute("aria-label", opts.ariaLabel);
  else if (!text) b.setAttribute("aria-label", name);
  return b;
}
