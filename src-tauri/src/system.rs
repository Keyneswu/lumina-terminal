use tauri::{AppHandle, Manager};

/// The app's rotating log directory (where `tauri-plugin-log` writes). Exposed
/// so Developer Settings can show / open it.
#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_log_dir()
        .map(|p: std::path::PathBuf| p.to_string_lossy().to_string())
        .map_err(|e: tauri::Error| e.to_string())
}

/// Open the webview devtools window. Debug builds only — the handler is not
/// registered in release (see `lib.rs`'s `#[cfg(debug_assertions)]` gate).
#[cfg(debug_assertions)]
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// Whether this is a debug build. The frontend uses this to decide whether to
/// show devtools-oriented UI.
#[tauri::command]
pub fn is_debug() -> bool {
    cfg!(debug_assertions)
}

/// Whether the app is running under a Wayland session. Used by the frontend to
/// hide UI for features Wayland forbids — notably "remember window position",
/// since Wayland's security model prevents clients from knowing or setting
/// their absolute screen position (`outerPosition()` always returns 0,0 and
/// `setPosition` is a no-op). Size is still knowable/controllable, so
/// "remember window size" stays available. Non-Linux always returns false.
#[tauri::command]
pub fn is_wayland() -> bool {
    if cfg!(target_os = "linux") {
        // XDG_SESSION_TYPE is the canonical signal; WAYLAND_DISPLAY is a fallback
        // for compositors that don't set the session type.
        std::env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false)
            || std::env::var("WAYLAND_DISPLAY").is_ok()
    } else {
        false
    }
}

/// The git commit this binary was built from (set at compile time via
/// `GIT_HASH`). Shown on the About page for support / reproducibility.
#[tauri::command]
pub fn get_commit_hash() -> String {
    env!("GIT_HASH").to_string()
}
