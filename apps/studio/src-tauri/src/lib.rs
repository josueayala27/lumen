mod control;
mod media;

use std::sync::Mutex;

use lumen_output::{DisplayInfo, OutputManager, OutputWindow};
use lumen_render::{PreviewRenderer, RenderStats, Scene, TransitionPlan, VideoFrame};
use tauri::{Manager, State};

#[derive(Default)]
pub(crate) struct PreviewState(Mutex<Option<PreviewRenderer>>);

impl PreviewState {
    /// Updates an already-created preview renderer from a decoder thread.
    /// Frames that arrive before the first preview render are dropped.
    pub(crate) fn push_video(&self, asset_id: &str, frame: &VideoFrame) -> Result<(), String> {
        let mut renderer = self
            .0
            .lock()
            .map_err(|_| "preview renderer lock poisoned".to_string())?;
        match renderer.as_mut() {
            Some(renderer) => renderer
                .update_video(asset_id, frame)
                .map_err(|error| error.to_string()),
            None => Ok(()),
        }
    }
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
fn list_outputs(outputs: State<'_, OutputManager>) -> Vec<OutputWindow> {
    outputs.open_outputs()
}

#[tauri::command]
fn apply_scene(
    app: tauri::AppHandle,
    outputs: State<'_, OutputManager>,
    label: Option<String>,
    scene: Scene,
) -> Result<(), String> {
    let playback_scene = scene.clone();
    outputs.apply_scene(label.as_deref(), scene)?;
    if let Some(playback) = app.try_state::<media::VideoPlaybackManager>() {
        playback.sync(&app, &[&playback_scene]);
    }
    Ok(())
}

#[tauri::command]
fn apply_transition(
    app: tauri::AppHandle,
    outputs: State<'_, OutputManager>,
    label: Option<String>,
    plan: TransitionPlan,
) -> Result<(), String> {
    let from = plan.from.clone();
    let to = plan.to.clone();
    outputs.apply_transition(label.as_deref(), plan)?;
    if let Some(playback) = app.try_state::<media::VideoPlaybackManager>() {
        playback.sync(&app, &[&from, &to]);
    }
    Ok(())
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

/// Renders the scene offscreen and returns a binary IPC response.
///
/// Layout: `width: u32 le`, `height: u32 le`, `layoutJsonLength: u32 le`, the UTF-8
/// `PreviewResult` JSON, then raw row-major RGBA bytes. This avoids serializing several
/// megabytes of pixels as a JSON number array.
#[tauri::command]
fn preview_render(
    app: tauri::AppHandle,
    preview: State<'_, PreviewState>,
    scene: Scene,
    width: u32,
    height: u32,
) -> Result<tauri::ipc::Response, String> {
    if let Some(playback) = app.try_state::<media::VideoPlaybackManager>() {
        playback.sync(&app, &[&scene]);
    }
    let mut renderer = preview
        .0
        .lock()
        .map_err(|_| "preview renderer lock poisoned".to_string())?;
    if renderer.is_none() {
        *renderer = Some(PreviewRenderer::new().map_err(|error| error.to_string())?);
    }
    let frame = renderer
        .as_mut()
        .ok_or_else(|| "preview renderer missing".to_string())?
        .render(&scene, width, height)
        .map_err(|error| error.to_string())?;
    let layout = serde_json::to_vec(&frame.layout).map_err(|error| error.to_string())?;
    let layout_length = u32::try_from(layout.len()).map_err(|_| "layout is too large")?;
    let mut payload = Vec::with_capacity(12 + layout.len() + frame.rgba.len());
    payload.extend_from_slice(&frame.width.to_le_bytes());
    payload.extend_from_slice(&frame.height.to_le_bytes());
    payload.extend_from_slice(&layout_length.to_le_bytes());
    payload.extend_from_slice(&layout);
    payload.extend_from_slice(&frame.rgba);
    Ok(tauri::ipc::Response::new(payload))
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
            app.manage(media::VideoPlaybackManager::new());
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
            list_outputs,
            apply_scene,
            apply_transition,
            update_output_video_frame,
            apply_hardcoded_scene,
            output_stats,
            preview_render,
            update_preview_video_frame,
            media::import_media,
            media::relink_media,
            media::probe_media,
            media::delete_media_file,
            media::media_files_status,
            media::list_media_files,
            media::media_thumbnail,
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
