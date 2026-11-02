//! Media file management for the desktop app.
//!
//! Import copies a local file into the app data `media` folder, keyed by its
//! SHA-256 so the same asset is stored once. SQLite rows live in the frontend
//! (`app/data/media.ts`), which owns the same database as presentations and
//! playlists. These commands only touch files and metadata so the two sides do
//! not open competing SQLite handles.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine as _;
use lumen_media::decoder::{DecodeRequest, DecoderConfig, FfmpegVideo, MAX_DECODE_EDGE};
use lumen_media::hap::{self, HapFrame, HapTextureFormat};
use lumen_media::mov::MovVideoTrack;
use lumen_media::probe::probe_file;
use lumen_media::thumbnail::{thumbnail_file, DEFAULT_THUMBNAIL_EDGE};
use lumen_media::transport::{clip_position, TransportCommand, VideoTransport};
use lumen_media::util::{
    detect_mime, extension_for_mime, is_local_file_path, kind_for_mime, sanitize_file_name,
    sha256_file, MediaKind, MAX_IMPORT_BYTES,
};
use lumen_media::{FileProbe, MediaBackend};
use lumen_output::OutputManager;
use lumen_render::composition::Source as SourceV2;
use lumen_render::mapping::layer_matches;
use lumen_render::{AssetKind, AssetState, Composition, Screen, VideoFrame, VideoPixels};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// ffmpeg decoders run as separate processes and copy every frame through the CPU.
pub const MAX_CONCURRENT_DECODERS: usize = 4;
/// Hap decoding is a file read plus Snappy, so many layers can play at once.
pub const MAX_HAP_DECODERS: usize = 16;

/// Metadata returned by an import; the frontend persists it as a row.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedia {
    kind: MediaKind,
    name: String,
    sha256: String,
    mime: String,
    size: u64,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    local_path: String,
}

/// One file inside the managed media folder, used to reconcile the bin.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedFile {
    name: String,
    path: String,
    size: u64,
}

fn media_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data folder: {error}"))?
        .join("media");
    fs::create_dir_all(&root).map_err(|error| format!("create media folder: {error}"))?;
    Ok(root)
}

/// Only direct children of the managed folder are accepted.
fn managed_path(app: &AppHandle, raw: &str) -> Result<PathBuf, String> {
    let root = media_root(app)?;
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("media path must be absolute".to_string());
    }
    let name = path
        .file_name()
        .ok_or_else(|| "media path has no file name".to_string())?;
    if path.parent() != Some(root.as_path()) {
        return Err("media path is outside the media folder".to_string());
    }
    Ok(root.join(name))
}

fn read_header(path: &Path, length: usize) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|error| format!("open media: {error}"))?;
    let mut buffer = vec![0u8; length];
    let read = file
        .read(&mut buffer)
        .map_err(|error| format!("read media: {error}"))?;
    buffer.truncate(read);
    Ok(buffer)
}

fn import_blocking(app: &AppHandle, source: &str) -> Result<ImportedMedia, String> {
    if !is_local_file_path(source) {
        return Err("import a local file, not a network URL".to_string());
    }
    let source_path = PathBuf::from(source)
        .canonicalize()
        .map_err(|error| format!("open media: {error}"))?;
    if !source_path.is_file() {
        return Err("media path is not a file".to_string());
    }
    let size = fs::metadata(&source_path)
        .map_err(|error| format!("read media: {error}"))?
        .len();
    if size == 0 {
        return Err("media file is empty".to_string());
    }
    if size > MAX_IMPORT_BYTES {
        return Err(format!(
            "media is larger than {} GiB",
            MAX_IMPORT_BYTES / (1024 * 1024 * 1024)
        ));
    }

    let source_label = source_path.to_string_lossy().into_owned();
    let header = read_header(&source_path, 64)?;
    let mime =
        detect_mime(&source_label, &header).ok_or_else(|| "unsupported media type".to_string())?;
    let kind = kind_for_mime(&mime).ok_or_else(|| "unsupported media type".to_string())?;
    let sha256 = sha256_file(&source_path).map_err(|error| format!("hash media: {error}"))?;

    let root = media_root(app)?;
    let destination = root.join(format!("{sha256}.{}", extension_for_mime(&mime)));
    let fresh_copy = !destination.exists();
    if fresh_copy {
        fs::copy(&source_path, &destination).map_err(|error| format!("copy media: {error}"))?;
    }

    let local_path = destination.to_string_lossy().into_owned();
    let info = match FileProbe::new().probe(&local_path) {
        Ok(info) => info,
        Err(error) => {
            if fresh_copy {
                let _ = fs::remove_file(&destination);
            }
            return Err(error.to_string());
        }
    };
    let name = sanitize_file_name(
        source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("media"),
    );

    Ok(ImportedMedia {
        kind,
        name,
        sha256,
        mime: info.mime,
        size,
        duration_ms: info.duration_ms,
        width: info.width,
        height: info.height,
        local_path,
    })
}

/// A video source of a composition, resolved to a local file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoSource {
    pub asset_id: String,
    pub local_path: String,
    pub width: u32,
    pub height: u32,
    pub start_ms: u64,
    pub loop_playback: bool,
}

fn intrinsic_edge(value: f64) -> Option<u32> {
    if !value.is_finite() || value < 1.0 {
        return None;
    }
    let clamped = value.round().clamp(1.0, f64::from(MAX_DECODE_EDGE));
    u32::try_from(clamped as u64).ok().filter(|edge| *edge > 0)
}

fn local_media_path(raw: &str) -> Option<String> {
    let path = raw.strip_prefix("file://").unwrap_or(raw);
    is_local_file_path(path).then(|| path.to_string())
}

/// Video assets that a composition plays: video sources of enabled layers that at least one
/// enabled screen draws (every enabled layer when `screens` is empty), in layer order and
/// de-duplicated by asset. `inMs` becomes the start position.
pub fn composition_video_sources(
    composition: &Composition,
    screens: &[Screen],
) -> Vec<VideoSource> {
    let drawn = |layer: &lumen_render::composition::CompositionLayer| {
        screens.is_empty()
            || screens
                .iter()
                .any(|screen| screen.enabled && layer_matches(&screen.layout.layers, layer))
    };
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    for layer in composition
        .layers
        .iter()
        .filter(|layer| layer.enabled && drawn(layer))
    {
        let Some(SourceV2::Video {
            asset,
            loop_,
            in_ms,
            ..
        }) = layer
            .source_id
            .as_deref()
            .and_then(|id| composition.source(id))
        else {
            continue;
        };
        if !seen.insert(asset.asset_id.as_str()) {
            continue;
        }
        let Some(media) = composition.asset(&asset.asset_id) else {
            continue;
        };
        if media.kind != AssetKind::Video || media.state != AssetState::Ready {
            continue;
        }
        let Some(local_path) = media.local_path.as_deref().and_then(local_media_path) else {
            continue;
        };
        let (Some(width), Some(height)) = (
            intrinsic_edge(media.intrinsic.width),
            intrinsic_edge(media.intrinsic.height),
        ) else {
            continue;
        };
        sources.push(VideoSource {
            asset_id: asset.asset_id.clone(),
            local_path,
            width,
            height,
            start_ms: if in_ms.is_finite() {
                in_ms.max(0.0) as u64
            } else {
                0
            },
            loop_playback: *loop_,
        });
    }
    sources
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Backend {
    Ffmpeg,
    Hap,
}

/// Callers that want videos decoded. A video plays while any caller wants it.
pub const OWNER_OUTPUT: &str = "output";
pub const OWNER_PREVIEW: &str = "preview";
/// Next cue: decoders start paused on their first frame so the cut is instant.
pub const OWNER_PRELOAD: &str = "preload";

/// Which videos each caller currently wants.
#[derive(Debug, Default)]
struct Demand {
    owners: HashMap<String, Vec<VideoSource>>,
}

impl Demand {
    fn set(&mut self, owner: &str, sources: Vec<VideoSource>) {
        if sources.is_empty() {
            self.owners.remove(owner);
        } else {
            self.owners.insert(owner.to_string(), sources);
        }
    }

    /// Every wanted video, with `true` when a caller other than preload wants it.
    /// The first caller to list an asset decides its source settings.
    fn wanted(&self) -> Vec<(VideoSource, bool)> {
        let mut order: Vec<String> = Vec::new();
        let mut merged: HashMap<String, (VideoSource, bool)> = HashMap::new();
        let mut owners: Vec<(&String, &Vec<VideoSource>)> = self.owners.iter().collect();
        // Active callers first so their settings win over preload.
        owners.sort_by_key(|(owner, _)| (owner.as_str() == OWNER_PRELOAD, owner.as_str()));
        for (owner, sources) in owners {
            let active = owner.as_str() != OWNER_PRELOAD;
            for source in sources {
                match merged.get_mut(&source.asset_id) {
                    Some(entry) => entry.1 |= active,
                    None => {
                        order.push(source.asset_id.clone());
                        merged.insert(source.asset_id.clone(), (source.clone(), active));
                    }
                }
            }
        }
        order
            .into_iter()
            .filter_map(|asset_id| merged.remove(&asset_id))
            .collect()
    }
}

struct Playback {
    stop: Arc<AtomicBool>,
    backend: Backend,
    transport: Arc<Mutex<VideoTransport>>,
    /// False while the decoder only holds a preloaded first frame.
    active: bool,
}

#[derive(Default)]
struct PlaybackState {
    demand: Demand,
    playbacks: HashMap<String, Playback>,
    /// Transport commands for videos whose decoder has not started yet.
    pending: HashMap<String, TransportCommand>,
}

const MAX_PENDING_COMMANDS: usize = 64;

/// Owns decoder threads for every composition sent to a preview or an output.
///
/// Compositions are the source of truth: each caller (output, preview, preload)
/// reports the videos its composition plays, a video decodes while any caller
/// wants it, and videos nobody wants stop. Each decoder follows its own
/// transport, which the show drives with play, pause, seek and rate.
#[derive(Default)]
pub struct VideoPlaybackManager {
    state: Mutex<PlaybackState>,
    config: Mutex<Option<Result<DecoderConfig, String>>>,
}

impl VideoPlaybackManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn decoder_config(&self) -> Result<DecoderConfig, String> {
        let mut guard = self
            .config
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            let resolved = DecoderConfig::from_env().map_err(|error| error.to_string());
            if let Err(error) = &resolved {
                eprintln!("lumen-media: video playback unavailable: {error}");
            }
            *guard = Some(resolved);
        }
        guard.as_ref().expect("decoder config was resolved").clone()
    }

    fn state(&self) -> std::sync::MutexGuard<'_, PlaybackState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Replaces the videos `owner` wants with the video sources the composition plays on these
    /// screens (every enabled layer when `screens` is empty), starts new decoders and stops
    /// unwanted ones.
    pub fn sync_composition(
        &self,
        app: &AppHandle,
        owner: &str,
        composition: &Composition,
        screens: &[Screen],
    ) {
        self.sync_sources(app, owner, composition_video_sources(composition, screens));
    }

    /// Drops every video `owner` wants; videos no other caller wants stop.
    pub fn release(&self, app: &AppHandle, owner: &str) {
        self.sync_sources(app, owner, Vec::new());
    }

    fn sync_sources(&self, app: &AppHandle, owner: &str, sources: Vec<VideoSource>) {
        let mut state = self.state();
        state.demand.set(owner, sources);
        let wanted = state.demand.wanted();
        let wanted_ids: HashSet<&str> = wanted
            .iter()
            .map(|(source, _)| source.asset_id.as_str())
            .collect();
        state.playbacks.retain(|asset_id, playback| {
            if wanted_ids.contains(asset_id.as_str()) {
                return true;
            }
            playback.stop.store(true, Ordering::Relaxed);
            false
        });

        let running = |state: &PlaybackState, backend: Backend| {
            state
                .playbacks
                .values()
                .filter(|playback| playback.backend == backend)
                .count()
        };
        let mut ffmpeg_running = running(&state, Backend::Ffmpeg);
        let mut hap_running = running(&state, Backend::Hap);
        let now = Instant::now();
        for (source, active) in wanted {
            if let Some(playback) = state.playbacks.get_mut(&source.asset_id) {
                if active && !playback.active {
                    // A preloaded cue went live: start from the frame already on screen.
                    playback.active = true;
                    lock_transport(&playback.transport).play(now);
                }
                continue;
            }
            let mut transport = VideoTransport::new(source.start_ms, active, now);
            if let Some(command) = state.pending.remove(&source.asset_id) {
                transport.apply(command, now);
            }
            let transport = Arc::new(Mutex::new(transport));
            let stop = Arc::new(AtomicBool::new(false));
            let thread_stop = Arc::clone(&stop);
            let thread_transport = Arc::clone(&transport);
            let thread_app = app.clone();
            let asset_id = source.asset_id.clone();
            let backend = match hap_track(&source.local_path) {
                Some(track) => {
                    if hap_running >= MAX_HAP_DECODERS {
                        continue;
                    }
                    hap_running += 1;
                    thread::spawn(move || {
                        run_hap_decoder(
                            &thread_app,
                            &source,
                            &track,
                            &thread_transport,
                            &thread_stop,
                        );
                    });
                    Backend::Hap
                }
                None => {
                    if ffmpeg_running >= MAX_CONCURRENT_DECODERS {
                        continue;
                    }
                    let Ok(config) = self.decoder_config() else {
                        continue;
                    };
                    ffmpeg_running += 1;
                    thread::spawn(move || {
                        run_decoder(
                            &thread_app,
                            &source,
                            &config,
                            &thread_transport,
                            &thread_stop,
                        );
                    });
                    Backend::Ffmpeg
                }
            };
            state.playbacks.insert(
                asset_id,
                Playback {
                    stop,
                    backend,
                    transport,
                    active,
                },
            );
        }
    }

    /// Plays, pauses, seeks or changes the rate of one video. Commands for a video
    /// that is not decoding yet apply when its decoder starts.
    pub fn transport(&self, asset_id: &str, command: TransportCommand) {
        let mut state = self.state();
        if let Some(playback) = state.playbacks.get(asset_id) {
            lock_transport(&playback.transport).apply(command, Instant::now());
            return;
        }
        if state.pending.len() >= MAX_PENDING_COMMANDS && !state.pending.contains_key(asset_id) {
            state.pending.clear();
        }
        let entry = state.pending.entry(asset_id.to_string()).or_default();
        entry.playing = command.playing.or(entry.playing);
        entry.position_ms = command.position_ms.or(entry.position_ms);
        entry.rate = command.rate.or(entry.rate);
    }

    pub fn stop_all(&self) {
        let mut state = self.state();
        for playback in state.playbacks.values() {
            playback.stop.store(true, Ordering::Relaxed);
        }
        state.playbacks.clear();
        state.demand = Demand::default();
        state.pending.clear();
    }
}

impl Drop for VideoPlaybackManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn lock_transport(transport: &Mutex<VideoTransport>) -> std::sync::MutexGuard<'_, VideoTransport> {
    transport
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Streams a non-Hap file through ffmpeg. A transport change (seek, pause, play,
/// rate) restarts the process at the new position; while paused the first frame
/// at that position stays on screen. ffmpeg plays at realtime only, so rate is
/// ignored on this path.
fn run_decoder(
    app: &AppHandle,
    source: &VideoSource,
    config: &DecoderConfig,
    transport: &Mutex<VideoTransport>,
    stop: &AtomicBool,
) {
    'session: loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let (generation, position, playing) = {
            let transport = lock_transport(transport);
            (
                transport.generation(),
                transport.position_ms(Instant::now()),
                transport.playing(),
            )
        };
        let mut request = DecodeRequest::new(
            PathBuf::from(source.local_path.clone()),
            source.width,
            source.height,
        );
        request.start_ms = position;
        request.loop_playback = source.loop_playback;
        let mut decoder = match FfmpegVideo::open(&request, config) {
            Ok(decoder) => decoder,
            Err(error) => {
                eprintln!(
                    "lumen-media: decoder for {} failed: {error}",
                    source.asset_id
                );
                return;
            }
        };
        let mut shown_first = false;
        loop {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            if lock_transport(transport).generation() != generation {
                continue 'session;
            }
            if !playing && shown_first {
                thread::sleep(Duration::from_millis(30));
                continue;
            }
            match decoder.read_frame() {
                Ok(Some(rgba)) => {
                    let frame = VideoFrame::rgba(decoder.width(), decoder.height(), rgba);
                    push_frame(app, &source.asset_id, frame);
                    shown_first = true;
                }
                Ok(None) => {
                    // End of a non-looping clip: hold the last frame until the show moves it.
                    while lock_transport(transport).generation() == generation {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        thread::sleep(Duration::from_millis(50));
                    }
                    continue 'session;
                }
                Err(error) => {
                    if !stop.load(Ordering::Relaxed) {
                        eprintln!(
                            "lumen-media: decoder for {} stopped: {error}",
                            source.asset_id
                        );
                    }
                    return;
                }
            }
        }
    }
}

/// Sends one frame to the preview and every output. The frame is shared, not copied.
fn push_frame(app: &AppHandle, asset_id: &str, frame: VideoFrame) {
    if let Some(preview) = app.try_state::<crate::PreviewState>() {
        let _ = preview.push_video(asset_id, &frame);
    }
    if let Some(outputs) = app.try_state::<OutputManager>() {
        let _ = outputs.update_video(None, asset_id.to_string(), frame);
    }
}

/// The video track of a QuickTime file when it carries Hap frames.
fn hap_track(path: &str) -> Option<MovVideoTrack> {
    let track = MovVideoTrack::open(Path::new(path)).ok()?;
    (hap::is_hap_codec(&track.codec) && !track.samples.is_empty()).then_some(track)
}

/// Maps decoded Hap textures to the renderer's frame payload.
fn hap_video_frame(frame: HapFrame, width: u32, height: u32) -> Result<VideoFrame, String> {
    let mut textures = frame.textures.into_iter();
    let first = textures.next().ok_or("hap frame has no texture")?;
    let pixels = match (first.format, textures.next()) {
        (HapTextureFormat::Bc3YCoCg, Some(alpha)) if alpha.format == HapTextureFormat::Bc4 => {
            VideoPixels::Bc3YCoCgAlpha {
                color: Arc::from(first.data),
                alpha: Arc::from(alpha.data),
            }
        }
        (format, None) => {
            let data: Arc<[u8]> = Arc::from(first.data);
            match format {
                HapTextureFormat::Bc1 => VideoPixels::Bc1(data),
                HapTextureFormat::Bc3 => VideoPixels::Bc3(data),
                HapTextureFormat::Bc3YCoCg => VideoPixels::Bc3YCoCg(data),
                HapTextureFormat::Bc4 => VideoPixels::Bc4(data),
                HapTextureFormat::Bc7 => VideoPixels::Bc7(data),
            }
        }
        _ => return Err("unsupported hap texture combination".to_string()),
    };
    Ok(VideoFrame {
        width,
        height,
        pixels,
    })
}

/// Plays a Hap file on its transport. Each sample is an intra frame, so the
/// frame shown is always the one at the transport position: seeks land on the
/// exact frame, paused clips hold it, and a late thread skips frames instead of
/// falling behind. A finished non-looping clip holds its last frame.
fn run_hap_decoder(
    app: &AppHandle,
    source: &VideoSource,
    track: &MovVideoTrack,
    transport: &Mutex<VideoTransport>,
    stop: &AtomicBool,
) {
    let mut file = match File::open(&source.local_path) {
        Ok(file) => file,
        Err(error) => {
            eprintln!(
                "lumen-media: hap {} failed to open: {error}",
                source.asset_id
            );
            return;
        }
    };
    let duration_ms = track.duration_ms();
    let mut shown: Option<usize> = None;
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let now = Instant::now();
        let (raw_position, wait) = {
            let transport = lock_transport(transport);
            let raw = transport.position_ms(now);
            let (position, _) = clip_position(raw, duration_ms, source.loop_playback);
            let index = track.sample_index_at_ms(position);
            let next_ms = if index + 1 < track.samples.len() {
                track.sample_time_ms(index + 1)
            } else {
                duration_ms
            };
            let target = raw + next_ms.saturating_sub(position);
            (raw, transport.wait_until(target, now))
        };
        let (position, _) = clip_position(raw_position, duration_ms, source.loop_playback);
        let index = track.sample_index_at_ms(position);
        if shown != Some(index) {
            let decoded = track
                .read_sample(&mut file, index)
                .and_then(|bytes| hap::decode_frame(&bytes))
                .and_then(|frame| {
                    hap::validate_frame(&frame, track.width, track.height).map(|_| frame)
                })
                .map_err(|error| error.to_string())
                .and_then(|frame| hap_video_frame(frame, track.width, track.height));
            match decoded {
                Ok(frame) => push_frame(app, &source.asset_id, frame),
                Err(error) => {
                    if !stop.load(Ordering::Relaxed) {
                        eprintln!("lumen-media: hap {} stopped: {error}", source.asset_id);
                    }
                    return;
                }
            }
            shown = Some(index);
        }
        thread::sleep(wait);
    }
}

/// Copies a local file into the managed folder and probes it.
#[tauri::command]
pub async fn import_media(app: AppHandle, path: String) -> Result<ImportedMedia, String> {
    tauri::async_runtime::spawn_blocking(move || import_blocking(&app, &path))
        .await
        .map_err(|error| error.to_string())?
}

/// Imports a replacement file for an existing asset row. The caller keeps the
/// asset id; metadata and the managed path come from the new file.
#[tauri::command]
pub async fn relink_media(app: AppHandle, path: String) -> Result<ImportedMedia, String> {
    tauri::async_runtime::spawn_blocking(move || import_blocking(&app, &path))
        .await
        .map_err(|error| error.to_string())?
}

/// Re-probes an asset already inside the managed folder.
#[tauri::command]
pub async fn probe_media(app: AppHandle, path: String) -> Result<lumen_media::MediaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = managed_path(&app, &path)?;
        probe_file(&path.to_string_lossy()).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Removes a managed file. A file that is already gone is not an error.
#[tauri::command]
pub fn delete_media_file(app: AppHandle, path: String) -> Result<(), String> {
    let path = managed_path(&app, &path)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("delete media: {error}")),
    }
}

/// Existence flags for missing-media detection. Invalid paths report `false`.
#[tauri::command]
pub fn media_files_status(app: AppHandle, paths: Vec<String>) -> Vec<bool> {
    paths
        .into_iter()
        .map(|raw| {
            managed_path(&app, &raw)
                .map(|path| path.is_file())
                .unwrap_or(false)
        })
        .collect()
}

/// Files present in the managed folder, for reconciling the bin after a crash.
#[tauri::command]
pub fn list_media_files(app: AppHandle) -> Result<Vec<ManagedFile>, String> {
    let root = media_root(&app)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| format!("list media: {error}"))? {
        let entry = entry.map_err(|error| format!("list media: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        files.push(ManagedFile {
            name,
            path: path.to_string_lossy().into_owned(),
            size,
        });
    }
    files.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(files)
}

/// PNG data URL for an image asset. Video posters need a decoder backend.
#[tauri::command]
pub async fn media_thumbnail(
    app: AppHandle,
    path: String,
    max_edge: Option<u32>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = managed_path(&app, &path)?;
        if !path.is_file() {
            return Err("media file is missing".to_string());
        }
        let label = path.to_string_lossy().into_owned();
        let header = read_header(&path, 64)?;
        let mime =
            detect_mime(&label, &header).ok_or_else(|| "unsupported media type".to_string())?;
        if !mime.starts_with("image/") {
            return Ok(None);
        }
        let bytes = thumbnail_file(&label, max_edge.unwrap_or(DEFAULT_THUMBNAIL_EDGE))
            .map_err(|error| error.to_string())?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(Some(format!("data:image/png;base64,{encoded}")))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumen_media::HapTexture;

    fn source(asset_id: &str, start_ms: u64) -> VideoSource {
        VideoSource {
            asset_id: asset_id.to_string(),
            local_path: format!("/media/{asset_id}.mov"),
            width: 1920,
            height: 1080,
            start_ms,
            loop_playback: true,
        }
    }

    #[test]
    fn composition_video_sources_follow_enabled_drawn_layers() {
        let composition: Composition = serde_json::from_value(serde_json::json!({
            "schemaVersion": 2, "revision": 1, "canvas": { "width": 1920, "height": 1080 },
            "sources": [
                { "kind": "video", "id": "a", "asset": { "assetId": "clip-a", "hash": "h" }, "inMs": 1500, "loop": false },
                { "kind": "video", "id": "b", "asset": { "assetId": "clip-b", "hash": "h" } },
                { "kind": "video", "id": "c", "asset": { "assetId": "clip-c", "hash": "h" } },
                { "kind": "video", "id": "missing", "asset": { "assetId": "clip-missing", "hash": "h" } },
                { "kind": "solid", "id": "s", "color": "#000" }
            ],
            "layers": [
                { "id": "l1", "sourceId": "a", "transform": {}, "tags": ["visuals"] },
                { "id": "l2", "sourceId": "a", "transform": {} },
                { "id": "l3", "sourceId": "b", "transform": {}, "enabled": false },
                { "id": "l4", "sourceId": "c", "transform": {}, "tags": ["lyrics"] },
                { "id": "l5", "sourceId": "missing", "transform": {} },
                { "id": "l6", "sourceId": "s", "transform": {} }
            ],
            "master": {},
            "assets": [
                { "id": "clip-a", "hash": "h", "kind": "video", "localPath": "/media/a.mov", "intrinsic": { "width": 1920, "height": 1080 } },
                { "id": "clip-b", "hash": "h", "kind": "video", "localPath": "/media/b.mov", "intrinsic": { "width": 1920, "height": 1080 } },
                { "id": "clip-c", "hash": "h", "kind": "video", "localPath": "/media/c.mov", "intrinsic": { "width": 1280, "height": 720 } },
                { "id": "clip-missing", "hash": "h", "kind": "video", "localPath": "/media/m.mov", "intrinsic": { "width": 1, "height": 1 }, "state": "missing" }
            ]
        }))
        .expect("composition");
        let all = composition_video_sources(&composition, &[]);
        let ids: Vec<&str> = all.iter().map(|source| source.asset_id.as_str()).collect();
        assert_eq!(ids, vec!["clip-a", "clip-c"]);
        assert_eq!(all[0].start_ms, 1500);
        assert!(!all[0].loop_playback);
        assert_eq!(all[1].width, 1280);

        let mut screen = Screen::canvas(composition.canvas);
        screen.layout.layers = lumen_render::composition::LayerFilter::Only {
            ids: vec![],
            tags: vec!["visuals".into()],
        };
        let filtered = composition_video_sources(&composition, std::slice::from_ref(&screen));
        assert_eq!(filtered.len(), 1);
        screen.enabled = false;
        assert!(composition_video_sources(&composition, &[screen]).is_empty());
    }

    #[test]
    fn demand_merges_callers_and_marks_preload_inactive() {
        let mut demand = Demand::default();
        demand.set(
            OWNER_PRELOAD,
            vec![source("next", 0), source("shared", 900)],
        );
        demand.set(OWNER_OUTPUT, vec![source("live", 0), source("shared", 100)]);
        let wanted = demand.wanted();
        let find = |id: &str| {
            wanted
                .iter()
                .find(|(source, _)| source.asset_id == id)
                .cloned()
        };
        assert_eq!(find("next").map(|(_, active)| active), Some(false));
        assert_eq!(find("live").map(|(_, active)| active), Some(true));
        // The active caller's settings win over the preload's.
        assert_eq!(
            find("shared").map(|(source, active)| (source.start_ms, active)),
            Some((100, true))
        );
        assert_eq!(wanted.len(), 3);

        demand.set(OWNER_OUTPUT, Vec::new());
        demand.set(OWNER_PREVIEW, vec![source("editor", 0)]);
        let ids: HashSet<String> = demand
            .wanted()
            .into_iter()
            .map(|(source, _)| source.asset_id)
            .collect();
        assert_eq!(
            ids,
            ["next", "shared", "editor"]
                .map(String::from)
                .into_iter()
                .collect()
        );
    }

    #[test]
    fn hap_frames_map_to_renderer_payloads() {
        let texture = |format, len| HapTexture {
            format,
            data: vec![0u8; len],
        };
        let single = HapFrame {
            textures: vec![texture(HapTextureFormat::Bc1, 8)],
        };
        let frame = hap_video_frame(single, 4, 4).expect("bc1");
        assert!(matches!(frame.pixels, VideoPixels::Bc1(_)));
        assert_eq!((frame.width, frame.height), (4, 4));

        let pair = HapFrame {
            textures: vec![
                texture(HapTextureFormat::Bc3YCoCg, 16),
                texture(HapTextureFormat::Bc4, 8),
            ],
        };
        assert!(matches!(
            hap_video_frame(pair, 4, 4).expect("hap q alpha").pixels,
            VideoPixels::Bc3YCoCgAlpha { .. }
        ));

        let wrong = HapFrame {
            textures: vec![
                texture(HapTextureFormat::Bc1, 8),
                texture(HapTextureFormat::Bc1, 8),
            ],
        };
        assert!(hap_video_frame(wrong, 4, 4).is_err());
        assert!(hap_video_frame(HapFrame { textures: vec![] }, 4, 4).is_err());
    }

    #[test]
    fn non_hap_files_use_ffmpeg() {
        assert!(hap_track("/definitely/missing/clip.mov").is_none());
    }
}
