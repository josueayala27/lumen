mod control;

use std::sync::Mutex;

use lumen_output::{DisplayInfo, OutputManager, OutputWindow};
use lumen_render::{PreviewFrame, PreviewRenderer, RenderStats, Scene, TransitionPlan};
use tauri::{Manager, State};

#[derive(Default)]
struct PreviewState(Mutex<Option<PreviewRenderer>>);

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
fn apply_scene(
    outputs: State<'_, OutputManager>,
    label: Option<String>,
    scene: Scene,
) -> Result<(), String> {
    outputs.apply_scene(label.as_deref(), scene)
}

#[tauri::command]
fn apply_transition(
    outputs: State<'_, OutputManager>,
    label: Option<String>,
    plan: TransitionPlan,
) -> Result<(), String> {
    outputs.apply_transition(label.as_deref(), plan)
}

#[tauri::command]
fn update_output_video_frame(
    outputs: State<'_, OutputManager>,
    label: Option<String>,
    asset_id: String,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
) -> Result<(), String> {
    outputs.update_video_frame(label.as_deref(), asset_id, width, height, rgba)
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

#[tauri::command]
fn update_preview_video_frame(
    preview: State<'_, PreviewState>,
    asset_id: String,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
) -> Result<(), String> {
    let mut renderer = preview
        .0
        .lock()
        .map_err(|_| "preview renderer lock poisoned".to_string())?;
    if renderer.is_none() {
        *renderer = Some(PreviewRenderer::new().map_err(|error| error.to_string())?);
    }
    renderer
        .as_mut()
        .ok_or_else(|| "preview renderer missing".to_string())?
        .update_video_frame(&asset_id, width, height, &rgba)
        .map_err(|error| error.to_string())
}

/// Renders the scene offscreen and returns raw RGBA plus the Rust text layout.
#[tauri::command]
fn preview_render(
    preview: State<'_, PreviewState>,
    scene: Scene,
    width: u32,
    height: u32,
) -> Result<PreviewFrame, String> {
    let mut renderer = preview
        .0
        .lock()
        .map_err(|_| "preview renderer lock poisoned".to_string())?;
    if renderer.is_none() {
        *renderer = Some(PreviewRenderer::new().map_err(|error| error.to_string())?);
    }
    renderer
        .as_mut()
        .ok_or_else(|| "preview renderer missing".to_string())?
        .render(&scene, width, height)
        .map_err(|error| error.to_string())
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
            app.manage(PreviewState::default());
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
            apply_scene,
            apply_transition,
            update_output_video_frame,
            apply_hardcoded_scene,
            output_stats,
            preview_render,
            update_preview_video_frame,
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
