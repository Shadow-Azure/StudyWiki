# Agent Note: 原生关窗与退出守卫

Status: implemented

[English](2026-09-29-native-close-guard.en.md) | 中文

## Problem

macOS 26 + Tauri 2.12 / tao 0.37.1 下，红点、Close Window、Cmd+W 与 Cmd+Q 实测会绕过前端异步 `CloseRequested` 取消链并静默丢弃脏稿；切文件与换库守卫有效，风险集中在原生生命周期。实测红点 target/action 为窗口自身与私有 `_close:`，且不产生 tao 的 `CloseRequested` / `Destroyed`。Cmd+Q 更彻底：菜单项选择器是 `terminate:`，而 tao 的 macOS app delegate 未实现 `applicationShouldTerminate:`，AppKit 直接终止进程，连 `RunEvent::ExitRequested` 都不会产生。VS Code / Electron 的可靠模式是主进程先同步 `preventDefault()`，完成脏稿确认后再显式调用关闭。

## Decision

- `WindowsService` 把同窗全部文档插件守卫聚合成一个 `onCloseRequested` listener：回调先同步 `preventDefault()`，再逐个询问脏守卫；任一取消即停留，全部放行才调用 `destroy()`。
- macOS `native_close` hook `performClose:` / `close:` / `_close:`，并在 ready 时把标准红点 target/action 改接 `StudyWikiCloseTarget`；该 target 只向对应 webview eval `window.__studywikiNativeClose?.()`，不直接关闭。
- 同一模块 hook `NSApplication.terminate:`：存在已武装窗口时逐个 eval 同一桥接、不调用原实现，其余情况放行原实现。Cmd+Q / 菜单 Quit 因此走逐窗守卫，最后一个窗口销毁后的空窗退出请求让进程正常结束。
- Rust 维护 `CloseGuardRegistry`。`guardClose` 装载聚合并发 listener 时立即标记 ready（不依赖 boot 时序，会话中途新增 guard 也武装）；退订或确认关闭前恢复/移除原生拦截，启动中、无守卫或已确认窗口保持原生直关，避免无法关闭。重新武装幂等：已武装窗口不再重读红点 target/action，否则会把自身动作当成"原始"而永久破坏原生关闭。
- 系统 `ExitRequested` 不直接退出：先 `prevent_exit()`，macOS 对每个 webview eval 同一桥接（其他平台逐窗 `close()`）；窗口守卫逐窗决定去留。最后一个窗口真正销毁后的空窗退出请求放行。
- 该方案不替换 tao，也不把脏状态镜像到 Rust；主进程只拥有“守卫已就绪”这一同步事实，文档脏语义仍住前端插件。`_close:` 是 macOS 26 实测必需的私有 selector 兜底。

## Alternatives considered

- 继续信任前端 `CloseRequestedEvent.preventDefault()`：macOS 26 四条原生出口实测无效，且多个 listener 的确认链路依赖 webview 调度。
- Rust 持久镜像 dirty 标记并在 close 事件查询前端：首笔编辑到 IPC 落账存在丢稿窗口，且文档语义泄漏到壳层。
- 禁用原生关闭按钮 / 自绘红点：牺牲平台窗口语义，也不能覆盖系统菜单与 Cmd+Q。
- 仅 swizzle 公共 `performClose:` / `close:`：实测红点 action 为 `_close:` 且 AX press 不走这些方法，覆盖不完整。

## Consequences

- 干净窗口的关闭也由前端聚合回调显式 `destroy()`；`core:window:allow-destroy` 继续是硬依赖。
- 多脏文档同关时按注册序逐个确认；一个取消后，下一次关闭会重新询问所有仍脏守卫。
- macOS 26 需要用真实鼠标 / 键盘人工回归四条原生出口（红点 / Close Window / Cmd+W / Cmd+Q）与干净窗口直关；AX 自动化会绕过红点 target/action，不能替代真实输入。自动化覆盖聚合、确认/取消、ready 注册武装/退订与全退订。
