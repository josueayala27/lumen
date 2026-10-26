//! Media file management for the desktop app.
//!
//! Import copies a local file into the app data `media` folder, keyed by its
//! SHA-256 so the same asset is stored once. SQLite rows live in the frontend
//! (`app/data/media.ts`), which owns the same database as presentations and
//! playlists. These commands only touch files and metadata so the two sides do
//! not open competing SQLite handles.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use lumen_media::probe::probe_file;
use lumen_media::thumbnail::{thumbnail_file, DEFAULT_THUMBNAIL_EDGE};
use lumen_media::util::{
    detect_mime, extension_for_mime, is_local_file_path, kind_for_mime, sanitize_file_name,
    sha256_file, MediaKind, MAX_IMPORT_BYTES,
};
use lumen_media::{FileProbe, MediaBackend};
use serde::Serialize;
use tauri::{AppHandle, Manager};

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

/// Copies a local file into the managed folder and probes it.
#[tauri::command]
pub async fn import_media(app: AppHandle, path: String) -> Result<ImportedMedia, String> {
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
