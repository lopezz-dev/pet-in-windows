// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sessions;

use std::thread;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

/// Height of the strip that sits on top of the taskbar, in logical pixels.
const STRIP_HEIGHT: f64 = 200.0;

// --- Settings ---------------------------------------------------------------
// The schema lives in the frontend (src/settings.ts); Rust only stores the JSON
// and broadcasts changes so the pets update live.

fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

#[tauri::command]
fn load_settings(app: AppHandle) -> serde_json::Value {
    settings_path(&app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app).ok_or("no config dir")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    app.emit("settings", &settings).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The frontend calls this when the cursor enters/leaves a pet or bubble:
/// the window ignores the mouse everywhere else so it never blocks your desktop.
#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) {
    let _ = window.set_ignore_cursor_events(ignore);
}

/// Frontend diagnostics end up in the terminal running the app.
#[tauri::command]
fn log_js(msg: String) {
    eprintln!("[web] {msg}");
}

/// Stretch the window over the full width of the primary monitor, with its
/// bottom edge touching the top of the taskbar (the bottom of the work area).
fn place_window(win: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = win.primary_monitor()? else {
        return Ok(());
    };
    let area = monitor.work_area();
    let height = (STRIP_HEIGHT * monitor.scale_factor()).round() as u32;
    let size = PhysicalSize::new(area.size.width, height);
    let pos = PhysicalPosition::new(
        area.position.x,
        area.position.y + area.size.height as i32 - height as i32,
    );
    if win.outer_size()? != size {
        win.set_size(size)?;
    }
    if win.outer_position()? != pos {
        win.set_position(pos)?;
    }
    // Other topmost windows (e.g. the taskbar itself) can push us down; re-assert.
    win.set_always_on_top(true)?;
    Ok(())
}

fn main() {
    // `pet-in-windows --dump` prints what the pets would see and exits.
    if std::env::args().any(|a| a == "--dump") {
        let agents = sessions::Scanner::new().scan();
        println!("{}", serde_json::to_string_pretty(&agents).unwrap_or_default());
        return;
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_click_through, log_js, load_settings, save_settings, open_settings])
        .on_window_event(|w, e| {
            // Closing the settings window just hides it.
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.label() == "settings" {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .setup(|app| {
            let win = app
                .get_webview_window("pet")
                .expect("window 'pet' is defined in tauri.conf.json");
            place_window(&win)?;
            win.set_ignore_cursor_events(true)?;

            // --- Tray icon -------------------------------------------------
            let settings = MenuItem::with_id(app, "settings", "Ajustes…", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Mostrar / ocultar", true, None::<&str>)?;
            let demo = MenuItem::with_id(app, "demo", "Modo demo", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings, &toggle, &demo, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("bundle icon"))
                .tooltip("Pet in Windows")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "settings" => open_settings(app.clone()),
                    "demo" => {
                        let _ = app.emit_to("pet", "toggle-demo", ());
                    }
                    "toggle" => {
                        if let Some(w) = app.get_webview_window("pet") {
                            if w.is_visible().unwrap_or(true) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                            }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // --- Claude Code session watcher --------------------------------
            let handle = app.handle().clone();
            thread::spawn(move || {
                let mut scanner = sessions::Scanner::new();
                loop {
                    let agents = scanner.scan();
                    let _ = handle.emit_to("pet", "agents", &agents);
                    thread::sleep(Duration::from_millis(1000));
                }
            });

            // --- Cursor tracking (the window is click-through, so the webview
            // never sees mouse moves; we poll the global cursor instead) -------
            let w = win.clone();
            thread::spawn(move || {
                let mut last = (f64::NAN, f64::NAN);
                let mut tick: u32 = 0;
                loop {
                    thread::sleep(Duration::from_millis(33));
                    tick = tick.wrapping_add(1);
                    if tick % 90 == 0 {
                        let _ = place_window(&w);
                    }
                    let (Ok(c), Ok(pos), Ok(scale)) =
                        (w.cursor_position(), w.outer_position(), w.scale_factor())
                    else {
                        continue;
                    };
                    let x = (c.x - pos.x as f64) / scale;
                    let y = (c.y - pos.y as f64) / scale;
                    if (x, y) != last {
                        last = (x, y);
                        if std::env::var("PET_DEBUG").is_ok() {
                            eprintln!("cursor raw=({:.0},{:.0}) win=({},{}) rel=({x:.0},{y:.0})", c.x, c.y, pos.x, pos.y);
                        }
                        let _ = w.emit_to("pet", "cursor", serde_json::json!({ "x": x, "y": y }));
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pet in Windows");
}
