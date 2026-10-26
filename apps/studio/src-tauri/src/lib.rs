mod control;

use lumen_output::{DisplayInfo, OutputManager, OutputWindow};
use lumen_render::{PreviewResult, RenderStats, Scene};
use tauri::{Manager, State};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewFrame {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    layout: PreviewResult,
}

#[tauri::command]
fn list_displays(app: tauri::AppHandle) -> Result<Vec<DisplayInfo>, String> {
    lumen_output::list_displays(&app)
}

#[tauri::command]
fn open_output(
    outputs: State<'_, OutputManager>,
    display_index: usize,
) -> Result<OutputWindow, String> {
    outputs.open(display_index)
}

#[tauri::command]
fn close_output(outputs: State<'_, OutputManager>, label: String) -> Result<(), String> {
    outputs.close(&label)
}

#[tauri::command]
fn apply_hardcoded_scene(
    outputs: State<'_, OutputManager>,
    label: Option<String>,
) -> Result<(), String> {
    outputs.apply_scene(label.as_deref(), lumen_render::spike_scene())
}

#[tauri::command]
fn output_stats(
    outputs: State<'_, OutputManager>,
    label: Option<String>,
) -> Result<RenderStats, String> {
    outputs.stats(label.as_deref())
}

/// Clear-only preview. Layout is empty until Rust text shaping lands.
#[tauri::command]
fn preview_render(scene: Scene, width: u32, height: u32) -> Result<PreviewFrame, String> {
    Ok(PreviewFrame {
        width,
        height,
        rgba: lumen_render::render_preview_rgba(&scene, width, height),
        layout: lumen_render::empty_preview_result(&scene),
    })
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
        .setup(|app| {
            app.manage(control::ControlState::new(app.handle().clone()));
            let outputs = OutputManager::new(app.handle().clone());
            outputs.start_monitor_poll();
            app.manage(outputs);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_displays,
            open_output,
            close_output,
            apply_hardcoded_scene,
            output_stats,
            preview_render,
            control::list_midi_inputs,
            control::start_midi_input,
            control::stop_midi_input,
            control::get_midi_bindings,
            control::set_midi_bindings,
            control::begin_midi_learn,
            control::cancel_midi_learn,
            control::list_audio_inputs,
            control::start_ltc_input,
            control::stop_ltc_input,
            control::timecode_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumen");
}
