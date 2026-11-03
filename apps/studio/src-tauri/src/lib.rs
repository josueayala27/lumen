mod control;
mod media;

use std::sync::Mutex;

use lumen_output::{DisplayInfo, OutputManager, OutputWindow, ScreenOutputStatus};
use lumen_render::{
    Composition, CompositionTransition, PreviewRenderer, RenderStats, Screen, VideoFrame,
};
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
fn close_output(
    app: tauri::AppHandle,
    outputs: State<'_, OutputManager>,
    label: String,
) -> Result<(), String> {
    if let Some(playback) = app.try_state::<media::VideoPlaybackManager>() {
        playback.release(&app, &media::output_owner(&label));
    }
    outputs.close(&label)
}

#[tauri::command]
fn list_outputs(outputs: State<'_, OutputManager>) -> Vec<OutputWindow> {
    outputs.open_outputs()
}

/// Starts the videos of the next cue's composition paused on their first frame, under the
/// `preload` caller's decoder demand, or releases them with `None`. Every video source on an
/// enabled layer is preloaded.
#[tauri::command]
fn preload_composition(app: tauri::AppHandle, composition: Option<Composition>) {
    if let Some(playback) = app.try_state::<media::VideoPlaybackManager>() {
        match composition {
            Some(composition) => {
                playback.sync_composition(&app, media::OWNER_PRELOAD, &composition, &[])
            }
            None => playback.release(&app, media::OWNER_PRELOAD),
        }
    }
}

/// Drives one video's transport from the show clock. Omitted fields are kept.
#[tauri::command]
fn video_transport(
    app: tauri::AppHandle,
    asset_id: String,
    playing: Option<bool>,
    position_ms: Option<u64>,
    rate: Option<f64>,
) {
    if let Some(playback) = app.try_state::<media::VideoPlaybackManager>() {
        playback.transport(
            &asset_id,
            lumen_media::TransportCommand {
                playing,
                position_ms,
                rate,
            },
        );
    }
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

/// Binary preview payload: `width: u32 le`, `height: u32 le`, `layoutJsonLength: u32 le`,
/// the UTF-8 layout JSON, then raw row-major RGBA bytes.
fn preview_payload(
    width: u32,
    height: u32,
    layout: &impl serde::Serialize,
    rgba: &[u8],
) -> Result<Vec<u8>, String> {
    let layout = serde_json::to_vec(layout).map_err(|error| error.to_string())?;
    let layout_length = u32::try_from(layout.len()).map_err(|_| "layout is too large")?;
    let mut payload = Vec::with_capacity(12 + layout.len() + rgba.len());
    payload.extend_from_slice(&width.to_le_bytes());
    payload.extend_from_slice(&height.to_le_bytes());
    payload.extend_from_slice(&layout_length.to_le_bytes());
    payload.extend_from_slice(&layout);
    payload.extend_from_slice(rgba);
    Ok(payload)
}

/// Renders a composition offscreen: the bare canvas, or one screen with its layout and
/// mapping. Returns the binary payload of [`preview_payload`]; the layout JSON is a
/// `CompositionPreviewResult` keyed by `layerId`, `sourceId` and `elementId`, normalized to the
/// screen output (or the canvas). Binary avoids serializing megabytes of pixels as JSON.
#[tauri::command]
fn preview_render_composition(
    app: tauri::AppHandle,
    preview: State<'_, PreviewState>,
    composition: Composition,
    screen: Option<Screen>,
    width: u32,
    height: u32,
) -> Result<tauri::ipc::Response, String> {
    if let Some(playback) = app.try_state::<media::VideoPlaybackManager>() {
        playback.sync_composition(&app, media::OWNER_PREVIEW, &composition, screen.as_slice());
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
        .render_composition(&composition, screen.as_ref(), width, height)
        .map_err(|error| error.to_string())?;
    let payload = preview_payload(frame.width, frame.height, &frame.layout, &frame.rgba)?;
    Ok(tauri::ipc::Response::new(payload))
}

/// Drives one native output per enabled display screen with the composition. Opens missing
/// outputs and decodes the videos each driven output draws, under that output's own decoder
/// demand (`output:<label>`), so a call with only some screens leaves the others playing.
#[tauri::command]
fn apply_composition(
    app: tauri::AppHandle,
    outputs: State<'_, OutputManager>,
    composition: Composition,
    screens: Vec<Screen>,
    transition: Option<CompositionTransition>,
) -> Vec<ScreenOutputStatus> {
    let statuses =
        outputs.apply_composition(&composition, &screens, &transition.unwrap_or_default());
    if let Some(playback) = app.try_state::<media::VideoPlaybackManager>() {
        playback.sync_outputs(&app, &composition, &screens, &statuses);
    }
    statuses
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
            update_output_video_frame,
            preload_composition,
            video_transport,
            output_stats,
            preview_render_composition,
            apply_composition,
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
