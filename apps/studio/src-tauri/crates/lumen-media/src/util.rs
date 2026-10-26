//! Pure helpers shared by the probe, thumbnail and desktop import commands.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Largest file accepted by the import command.
pub const MAX_IMPORT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Longest display name kept when sanitising an imported file.
const MAX_FILE_NAME_CHARS: usize = 180;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
    Audio,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::Audio => "audio",
        }
    }
}

/// Kind implied by a MIME type. Unknown families are rejected.
pub fn kind_for_mime(mime: &str) -> Option<MediaKind> {
    if mime.starts_with("image/") {
        Some(MediaKind::Image)
    } else if mime.starts_with("video/") {
        Some(MediaKind::Video)
    } else if mime.starts_with("audio/") {
        Some(MediaKind::Audio)
    } else {
        None
    }
}

/// Lowercase extension without the dot, when present.
pub fn extension_for_path(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
}

/// Canonical extension used for a managed copy.
pub fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "audio/wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        _ => "bin",
    }
}

/// MIME type declared by a known file extension.
pub fn mime_for_extension(extension: &str) -> Option<&'static str> {
    let mime = match extension {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        _ => return None,
    };
    Some(mime)
}

/// MIME type declared by the leading bytes of a file.
pub fn mime_from_magic(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if brand == b"qt  " {
            return Some("video/quicktime");
        }
        if brand == b"M4A " || brand == b"M4B " || brand == b"M4P " {
            return Some("audio/mp4");
        }
        return Some("video/mp4");
    }
    if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some("video/webm");
    }
    if bytes.starts_with(b"ID3")
        || bytes.starts_with(&[0xFF, 0xFB])
        || bytes.starts_with(&[0xFF, 0xF3])
        || bytes.starts_with(&[0xFF, 0xF2])
    {
        return Some("audio/mpeg");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("audio/wav");
    }
    if bytes.starts_with(b"OggS") {
        return Some("audio/ogg");
    }
    if bytes.starts_with(b"fLaC") {
        return Some("audio/flac");
    }
    None
}

/// Magic bytes win over the extension so a renamed file is not trusted.
pub fn detect_mime(path: &str, header: &[u8]) -> Option<String> {
    if let Some(mime) = mime_from_magic(header) {
        return Some(mime.to_string());
    }
    extension_for_path(path)
        .as_deref()
        .and_then(mime_for_extension)
        .map(str::to_string)
}

/// A local absolute path. URL schemes and UNC shares are rejected.
pub fn is_local_file_path(raw: &str) -> bool {
    if raw.is_empty() || raw.trim() != raw || raw.chars().any(char::is_control) {
        return false;
    }
    let lower = raw.to_ascii_lowercase();
    if lower.contains("://") || lower.starts_with("//") {
        return false;
    }
    for scheme in ["file:", "data:", "http:", "https:", "ftp:", "smb:"] {
        if lower.starts_with(scheme) {
            return false;
        }
    }
    Path::new(raw).is_absolute()
}

/// Display name derived from an imported path, safe for storage and the UI.
pub fn sanitize_file_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(name);
    let mut sanitized = String::with_capacity(base.len());
    for character in base.chars() {
        if sanitized.chars().count() >= MAX_FILE_NAME_CHARS {
            break;
        }
        if character.is_control()
            || matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        {
            sanitized.push('_');
        } else {
            sanitized.push(character);
        }
    }
    let trimmed = sanitized.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "media".to_string()
    } else {
        trimmed.to_string()
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

/// Streams the file so large videos are not held in memory.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn mime_prefers_magic_bytes_over_extension() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        assert_eq!(detect_mime("clip.mp4", &png).as_deref(), Some("image/png"));
        assert_eq!(detect_mime("photo.PNG", &[]).as_deref(), Some("image/png"));
        assert_eq!(detect_mime("unknown.bin", &[]), None);
    }

    #[test]
    fn ftyp_brands_map_to_video_and_audio() {
        let mut header = Vec::from(*b"\0\0\0\x18ftyp");
        header.extend_from_slice(b"qt  ");
        header.extend_from_slice(&[0; 4]);
        assert_eq!(mime_from_magic(&header), Some("video/quicktime"));

        let mut m4a = Vec::from(*b"\0\0\0\x18ftyp");
        m4a.extend_from_slice(b"M4A ");
        m4a.extend_from_slice(&[0; 4]);
        assert_eq!(mime_from_magic(&m4a), Some("audio/mp4"));
    }

    #[test]
    fn extensions_are_case_insensitive() {
        assert_eq!(extension_for_path("/tmp/Clip.MP4").as_deref(), Some("mp4"));
        assert_eq!(
            mime_for_extension(&extension_for_path("a.JPEG").unwrap()),
            Some("image/jpeg")
        );
        assert_eq!(mime_for_extension("exe"), None);
    }

    #[test]
    fn local_paths_reject_urls_and_relative_paths() {
        assert!(is_local_file_path("/Users/demo/clip.mp4"));
        assert!(!is_local_file_path("clip.mp4"));
        assert!(!is_local_file_path("https://example.com/clip.mp4"));
        assert!(!is_local_file_path("file:///tmp/clip.mp4"));
        assert!(!is_local_file_path("//server/share/clip.mp4"));
        assert!(!is_local_file_path("/tmp/line\nbreak"));
    }

    #[test]
    fn file_names_lose_separators_and_fallbacks() {
        assert_eq!(
            sanitize_file_name("/tmp/Palm Sunday.jpg"),
            "Palm Sunday.jpg"
        );
        assert_eq!(sanitize_file_name("a:b*c?.mp4"), "a_b_c_.mp4");
        assert_eq!(sanitize_file_name(".."), "media");
        assert_eq!(sanitize_file_name(""), "media");
    }

    #[test]
    fn kinds_and_canonical_extensions_agree() {
        assert_eq!(kind_for_mime("image/png"), Some(MediaKind::Image));
        assert_eq!(kind_for_mime("video/mp4"), Some(MediaKind::Video));
        assert_eq!(kind_for_mime("audio/mpeg"), Some(MediaKind::Audio));
        assert_eq!(kind_for_mime("application/pdf"), None);
        assert_eq!(extension_for_mime("video/quicktime"), "mov");
        assert_eq!(extension_for_mime("application/pdf"), "bin");
    }
}
