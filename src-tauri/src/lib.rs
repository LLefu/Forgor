mod meetings;
mod storage;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Bring the main window to the front (restoring it if hidden or minimised).
pub(crate) fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Show the quick popup (New note / New todo / Search) centred on screen.
fn show_popup(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("wn://popup-shown", ());
    }
}

/// (Re)register the global shortcut that opens the popup. Called by the UI at
/// startup and when the user changes it in Settings. Owning it on the Rust side
/// means it keeps working across webview reloads and while the window is hidden.
#[tauri::command]
fn set_hotkey(app: AppHandle, combo: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let shortcut: Shortcut = combo.parse().map_err(|e| format!("Invalid shortcut \"{combo}\": {e}"))?;
    gs.unregister_all().map_err(|e| e.to_string())?;
    gs.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            show_popup(app);
        }
    })
    .map_err(|e| format!("Could not register \"{combo}\" (is another app using it?): {e}"))
}

/// The tray menu. "Start/Stop recording" only appears when meeting recordings
/// are set up (or a recording is running).
fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<meetings::MeetingsState>();
    let recording = state.is_recording();
    let open = MenuItem::with_id(app, "open", "Open Forgor", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick menu…", true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", if recording { "Stop recording" } else { "Start recording" }, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    if recording || state.is_available() {
        Menu::with_items(app, &[&open, &quick, &record, &sep, &quit])
    } else {
        Menu::with_items(app, &[&open, &quick, &sep, &quit])
    }
}

/// Update the tray to the recording state: menu, red icon and tooltip.
pub(crate) fn refresh_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main-tray") else { return };
    let recording = app.state::<meetings::MeetingsState>().is_recording();
    if let Ok(menu) = tray_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    if let Some(icon) = app.default_window_icon() {
        let _ = tray.set_icon(Some(if recording { meetings::recording_icon(icon) } else { icon.clone() }));
    }
    let _ = tray.set_tooltip(Some(if recording { "Forgor: recording" } else { "Forgor" }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // A second launch focuses the running instance instead of opening another.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(meetings::MeetingsState::default())
        .manage(meetings::models::Downloads::default())
        .invoke_handler(tauri::generate_handler![
            set_hotkey,
            meetings::meetings_start,
            meetings::meetings_stop,
            meetings::meetings_state,
            meetings::meetings_levels,
            meetings::meetings_configure,
            meetings::meetings_input_devices,
            meetings::meetings_recordings,
            meetings::meetings_discard,
            meetings::meetings_process,
            meetings::meetings_summarize,
            meetings::models::meetings_models,
            meetings::models::meetings_download,
            meetings::models::meetings_cancel_download,
            meetings::models::meetings_delete_model,
            storage::storage_usage,
        ])
        .setup(|app| {
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Forgor")
                .menu(&tray_menu(app.handle())?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quick" => show_popup(app),
                    "record" => {
                        let recording = app.state::<meetings::MeetingsState>().is_recording();
                        let result = if recording { meetings::stop(app).map(|_| ()) } else { meetings::start(app).map(|_| ()) };
                        if let Err(e) = result {
                            // The main window shows it as an error toast.
                            show_main(app);
                            let _ = app.emit("wn://meetings-error", e);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the main window keeps the app running in the tray,
            // so the global shortcut keeps working. Quit from the tray menu.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The popup disappears as soon as it loses focus.
            WindowEvent::Focused(false) if window.label() == "popup" => {
                let _ = window.hide();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // Quitting while recording: finish the audio files (processed on the next start).
        if let tauri::RunEvent::Exit = event {
            meetings::finish_for_quit(app);
        }
        // macOS: clicking the dock icon re-opens the hidden main window.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main(app);
        }
    });
}
