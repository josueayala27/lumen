use lumen_output::{DisplayInfo, OutputWindow};
use tauri::Manager;

#[tauri::command]
fn list_displays(app: tauri::AppHandle) -> Result<Vec<DisplayInfo>, String> {
    lumen_output::list_displays(&app)
}

#[tauri::command]
fn open_output(app: tauri::AppHandle, display_index: usize) -> Result<OutputWindow, String> {
    lumen_output::open_audience_window(&app, display_index)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![list_displays, open_output])
        .run(tauri::generate_context!())
        .expect("error while running Lumen");
}
