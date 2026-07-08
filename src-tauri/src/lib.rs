mod state;
mod terminal;
mod utils;

use crate::state::TerminalState;
use crate::terminal::*;
use crate::utils::*;
use tauri::menu::Menu;
use tauri::{AppHandle, Emitter};

/// Build the macOS application menu with a custom "About" item that emits an
/// event to the frontend instead of opening the native About window.
///
/// On other platforms this is a no-op (returns None) — those platforms don't
/// have a native app menu bar with a built-in About item.
fn build_app_menu(app: &AppHandle) -> Option<Menu<tauri::Wry>> {
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

        let app_name = app.config().productName.clone();

        // Custom About item — emits "menu-about" to the frontend so it can
        // show our custom AboutPage tab instead of the native macOS About window.
        let about_item = MenuItem::with_id(app, "about", format!("About {}", app_name), true, None::<&str>)?;

        // Standard separators and items to rebuild the default app menu structure
        let sep = PredefinedMenuItem::separator(app)?;
        let services = PredefinedMenuItem::services(app, Some("Services"))?;
        let hide = PredefinedMenuItem::hide(app, Some(format!("Hide {}", app_name)))?;
        let hide_others = PredefinedMenuItem::hide_others(app, Some("Hide Others"))?;
        let show_all = PredefinedMenuItem::show_all(app, Some("Show All"))?;
        let quit = PredefinedMenuItem::quit(app, Some(format!("Quit {}", app_name)))?;

        let app_submenu = Submenu::with_items(
            app,
            &app_name,
            true,
            &[&about_item, &sep, &services, &sep, &hide, &hide_others, &show_all, &sep, &quit],
        )?;

        // Also provide a minimal Edit menu so copy/paste shortcuts work in the webview
        let edit_submenu = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, Some("Undo"))?,
                &PredefinedMenuItem::redo(app, Some("Redo"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, Some("Cut"))?,
                &PredefinedMenuItem::copy(app, Some("Copy"))?,
                &PredefinedMenuItem::paste(app, Some("Paste"))?,
                &PredefinedMenuItem::select_all(app, Some("Select All"))?,
            ],
        )?;

        // Window menu — includes standard window management items on macOS
        let window_submenu = Submenu::with_items(
            app,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
                &PredefinedMenuItem::fullscreen(app, Some("Enter Full Screen"))?,
            ],
        )?;

        let menu = Menu::with_items(app, &[&app_submenu, &edit_submenu, &window_submenu])?;
        Some(menu)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        use std::env;
        env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        log::info!("Set __NV_DISABLE_EXPLICIT_SYNC to 1 for Linux");
    }

    log::info!("Lumina Terminal starting up");

    let state = TerminalState::default();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("lumina_terminal_lib", log::LevelFilter::Debug)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("lumina-terminal".to_string()),
                    },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Webview,
                ))
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .max_file_size(1_000_000)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state)
        .setup(|app| {
            if let Some(menu) = build_app_menu(app.handle()) {
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "about" {
                log::info!("About menu item clicked");
                let _ = app.emit("menu-about", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_terminal,
            kill_terminal,
            write_to_terminal,
            resize_terminal,
            find_shells,
            path_exist,
            read_file,
            is_debug,
            get_log_dir,
            get_commit_hash,
            parse_ssh_config,
            #[cfg(debug_assertions)]
            open_devtools,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to startup Lumina Terminal");
}
