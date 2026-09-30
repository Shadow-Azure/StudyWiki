//! macOS native close interception.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex, Once, OnceLock,
    },
};

use objc2::{
    class, msg_send,
    runtime::{AnyObject, ClassBuilder, Imp, Sel},
    sel,
};
use tauri::{AppHandle, Manager, Runtime};

struct NativeCloseGuard {
    label: String,
    original_target: usize,
    original_action: Sel,
    request_close: Arc<dyn Fn() + Send + Sync>,
}

static CLOSE_GUARDS: Mutex<Option<HashMap<usize, NativeCloseGuard>>> = Mutex::new(None);
static ORIGINAL_PERFORM_CLOSE: AtomicUsize = AtomicUsize::new(0);
static ORIGINAL_CLOSE: AtomicUsize = AtomicUsize::new(0);
static ORIGINAL_UNDERSCORE_CLOSE: AtomicUsize = AtomicUsize::new(0);
static ORIGINAL_TERMINATE: AtomicUsize = AtomicUsize::new(0);
static INSTALL: Once = Once::new();
static CLOSE_TARGET: OnceLock<usize> = OnceLock::new();

/// Install the process-local NSWindow.performClose hook.
pub fn install() {
    INSTALL.call_once(|| unsafe {
        let method = class!(NSWindow)
            .instance_method(sel!(performClose:))
            .expect("NSWindow implements performClose:");
        let original = method.implementation();
        ORIGINAL_PERFORM_CLOSE.store(original as usize, Ordering::Release);
        let close_method = class!(NSWindow)
            .instance_method(sel!(close))
            .expect("NSWindow implements close");
        let original_close = close_method.implementation();
        ORIGINAL_CLOSE.store(original_close as usize, Ordering::Release);
        let underscore_close_method = class!(NSWindow)
            .instance_method(sel!(_close:))
            .expect("NSWindow implements _close:");
        let original_underscore_close = underscore_close_method.implementation();
        ORIGINAL_UNDERSCORE_CLOSE.store(original_underscore_close as usize, Ordering::Release);
        let terminate_method = class!(NSApplication)
            .instance_method(sel!(terminate:))
            .expect("NSApplication implements terminate:");
        ORIGINAL_TERMINATE.store(
            terminate_method.implementation() as usize,
            Ordering::Release,
        );
        let hook_function: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) =
            perform_close;
        let hook: Imp = std::mem::transmute(hook_function);
        method.set_implementation(hook);
        close_method.set_implementation(hook);
        underscore_close_method.set_implementation(hook);
        let terminate_hook: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) =
            application_terminate;
        let terminate_hook: Imp = std::mem::transmute(terminate_hook);
        terminate_method.set_implementation(terminate_hook);
    });
}

/// Route Cmd+Q / Quit StudyWiki through the same per-window guards. tao's
/// macOS app delegate declares no `applicationShouldTerminate:`, so AppKit
/// would terminate the process directly and `RunEvent::ExitRequested` never
/// fires; without this hook a Cmd+Q silently discards dirty drafts. Windows
/// close themselves through the bridge, and the resulting empty-window exit
/// request lets the process end.
unsafe extern "C-unwind" fn application_terminate(
    this: *mut AnyObject,
    command: Sel,
    sender: *mut AnyObject,
) {
    let requests: Vec<Arc<dyn Fn() + Send + Sync>> = CLOSE_GUARDS
        .lock()
        .unwrap()
        .as_ref()
        .map(|guards| {
            guards
                .values()
                .map(|guard| guard.request_close.clone())
                .collect()
        })
        .unwrap_or_default();
    if requests.is_empty() {
        let original: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) =
            std::mem::transmute(ORIGINAL_TERMINATE.load(Ordering::Acquire));
        original(this, command, sender);
        return;
    }
    for request in requests {
        request();
    }
}

/// Route a ready window's native close action through Tauri's close request.
pub fn set_ready<R: Runtime>(app: &AppHandle<R>, label: &str, ready: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("unknown window {label}"))?;
    let native_window = window
        .ns_window()
        .map_err(|e| format!("read NSWindow for {label}: {e}"))? as usize;
    let mut guards = CLOSE_GUARDS.lock().unwrap();
    let guards = guards.get_or_insert_with(HashMap::new);
    if ready {
        // Idempotent: a second arm while already armed would re-capture our own
        // target/action as the "original", permanently breaking native close.
        if guards.contains_key(&native_window) {
            return Ok(());
        }
        let (action, target, close_button): (Sel, *mut AnyObject, *mut AnyObject) = unsafe {
            let native_window_ref = &*(native_window as *mut AnyObject);
            let close_button: *mut AnyObject =
                msg_send![native_window_ref, standardWindowButton: 0];
            if close_button.is_null() {
                return Err(format!("window {label} has no standard close button"));
            }
            let action: Sel = msg_send![&*close_button, action];
            let target: *mut AnyObject = msg_send![&*close_button, target];
            (action, target, close_button)
        };
        unsafe {
            let target = close_target();
            let _: () = msg_send![&*close_button, setTarget: target];
            let _: () = msg_send![&*close_button, setAction: sel!(studywikiClose:)];
        }
        guards.insert(
            native_window,
            NativeCloseGuard {
                label: label.to_string(),
                original_target: target as usize,
                original_action: action,
                request_close: Arc::new(move || {
                    let _ = window.eval("window.__studywikiNativeClose?.()");
                }),
            },
        );
    } else {
        if let Some(guard) = guards.get(&native_window) {
            let close_button: *mut AnyObject = unsafe {
                let native_window_ref = &*(native_window as *mut AnyObject);
                msg_send![native_window_ref, standardWindowButton: 0]
            };
            if !close_button.is_null() {
                unsafe {
                    let original_target = guard.original_target as *mut AnyObject;
                    let _: () = msg_send![&*close_button, setTarget: original_target];
                    let _: () = msg_send![&*close_button, setAction: guard.original_action];
                }
            }
        }
        guards.remove(&native_window);
    }
    Ok(())
}

fn close_target() -> usize {
    *CLOSE_TARGET.get_or_init(|| unsafe {
        let mut class = ClassBuilder::new(c"StudyWikiCloseTarget", class!(NSObject))
            .expect("allocate StudyWikiCloseTarget");
        class.add_method(
            sel!(studywikiClose:),
            close_target_action as unsafe extern "C-unwind" fn(_, _, _),
        );
        let class = class.register();
        let target: *mut AnyObject = msg_send![class, new];
        target as usize
    })
}

unsafe extern "C-unwind" fn close_target_action(
    _this: *mut AnyObject,
    _command: Sel,
    sender: *mut AnyObject,
) {
    let window: *mut AnyObject = msg_send![&*sender, window];
    let request_close = CLOSE_GUARDS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|guards| guards.get(&(window as usize)))
        .map(|guard| guard.request_close.clone());
    if let Some(request_close) = request_close {
        request_close();
    }
}

/// Remove every hook registration for a destroyed window.
pub fn remove_window(label: &str) {
    if let Some(guards) = CLOSE_GUARDS.lock().unwrap().as_mut() {
        guards.retain(|_, guard| guard.label != label);
    }
}

unsafe extern "C-unwind" fn perform_close(
    this: *mut AnyObject,
    command: Sel,
    sender: *mut AnyObject,
) {
    let request_close = CLOSE_GUARDS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|guards| guards.get(&(this as usize)))
        .map(|guard| guard.request_close.clone());
    if let Some(request_close) = request_close {
        request_close();
        return;
    }

    let original = if command == sel!(performClose:) {
        ORIGINAL_PERFORM_CLOSE.load(Ordering::Acquire)
    } else {
        if command == sel!(close) {
            ORIGINAL_CLOSE.load(Ordering::Acquire)
        } else {
            ORIGINAL_UNDERSCORE_CLOSE.load(Ordering::Acquire)
        }
    };
    let original: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) =
        std::mem::transmute(original);
    original(this, command, sender);
}
