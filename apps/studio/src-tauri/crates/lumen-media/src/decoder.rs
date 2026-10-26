//! Practical video decode path.
//!
//! An ffmpeg executable is used as the decoder backend: it covers H.264/AAC in
//! MP4/MOV and VP8/VP9 in WebM without linking platform SDKs. The executable is
//! configurable through `LUMEN_FFMPEG` and is validated before use. Only local
//! files are decoded; URLs are rejected at the request boundary.

use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use crate::util::is_local_file_path;
use crate::MediaError;

/// Environment variable that overrides the decoder executable.
pub const DECODER_ENV: &str = "LUMEN_FFMPEG";
/// Default frame rate used when a scene does not provide one.
pub const DEFAULT_DECODER_FPS: u32 = 30;
/// Largest decoded edge accepted. Larger requests are clamped.
pub const MAX_DECODE_EDGE: u32 = 8192;
const MIN_DECODE_EDGE: u32 = 2;

/// A validated decoder executable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecoderConfig {
    executable: PathBuf,
}

impl DecoderConfig {
    /// Reads `LUMEN_FFMPEG`, falling back to `ffmpeg` on `PATH`.
    pub fn from_env() -> Result<Self, MediaError> {
        let raw = env::var(DECODER_ENV).ok();
        let value = raw
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("ffmpeg");
        Self::with_executable_str(value)
    }

    /// Validates an explicit executable path or command name.
    pub fn with_executable_str(raw: &str) -> Result<Self, MediaError> {
        Ok(Self {
            executable: validate_executable(raw)?,
        })
    }

    pub fn executable(&self) -> &Path {
        &self.executable
    }
}

/// One decode session request. Dimensions are rounded down to even values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeRequest {
    pub input: PathBuf,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub start_ms: u64,
    pub loop_playback: bool,
}

impl DecodeRequest {
    pub fn new(input: PathBuf, width: u32, height: u32) -> Self {
        Self {
            input,
            width: even_dimension(width),
            height: even_dimension(height),
            fps: DEFAULT_DECODER_FPS,
            start_ms: 0,
            loop_playback: true,
        }
    }

    fn validate(&self) -> Result<(), MediaError> {
        let label = self.input.to_string_lossy();
        if !is_local_file_path(&label) {
            return Err(MediaError::Unsupported(
                "video decode accepts local files only".to_string(),
            ));
        }
        if !self.input.is_file() {
            return Err(MediaError::Missing(label.into_owned()));
        }
        if self.fps == 0 || self.fps > 240 {
            return Err(MediaError::Decode(format!(
                "invalid decode frame rate {}",
                self.fps
            )));
        }
        Ok(())
    }
}

/// Rounds a requested edge down to an even value ffmpeg can scale to.
pub fn even_dimension(value: u32) -> u32 {
    let clamped = value.clamp(MIN_DECODE_EDGE, MAX_DECODE_EDGE);
    clamped & !1
}

/// Full argument list for one raw RGBA ffmpeg stream.
pub fn decode_args(request: &DecodeRequest) -> Vec<String> {
    let mut args = vec![
        "-v".to_string(),
        "error".to_string(),
        "-nostdin".to_string(),
        "-re".to_string(),
    ];
    if request.loop_playback {
        args.push("-stream_loop".to_string());
        args.push("-1".to_string());
    }
    // Hardware decode where the platform has it (VideoToolbox, D3D11); ffmpeg
    // falls back to software when the codec or device is not supported.
    args.push("-hwaccel".to_string());
    args.push("auto".to_string());
    if request.start_ms > 0 {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", request.start_ms as f64 / 1000.0));
    }
    args.push("-i".to_string());
    args.push(request.input.to_string_lossy().into_owned());
    args.extend([
        "-an".to_string(),
        "-sn".to_string(),
        "-dn".to_string(),
        "-vf".to_string(),
        format!("scale={}:{}:flags=bilinear", request.width, request.height),
        "-pix_fmt".to_string(),
        "rgba".to_string(),
        "-f".to_string(),
        "rawvideo".to_string(),
        "-r".to_string(),
        request.fps.to_string(),
        "pipe:1".to_string(),
    ]);
    args
}

/// Resolves a decoder command. Absolute paths must be local executable files;
/// bare names are looked up on `PATH`.
pub fn validate_executable(raw: &str) -> Result<PathBuf, MediaError> {
    let value = raw.trim();
    if value.is_empty() || value != raw || value.chars().any(char::is_control) {
        return Err(MediaError::Unsupported(
            "decoder path is empty or invalid".to_string(),
        ));
    }
    let has_separator = value.contains('/') || value.contains('\\');
    let candidate = if has_separator {
        if !is_local_file_path(value) {
            return Err(MediaError::Unsupported(
                "decoder path must be a local absolute path".to_string(),
            ));
        }
        PathBuf::from(value)
    } else {
        find_on_path(value).ok_or_else(|| {
            MediaError::Missing(format!("decoder executable {value} was not found on PATH"))
        })?
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|_| MediaError::Missing(candidate.to_string_lossy().into_owned()))?;
    if !canonical.is_file() || !is_executable(&canonical) {
        return Err(MediaError::Unsupported(format!(
            "decoder is not an executable file: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    if name.contains("..") {
        return None;
    }
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file() && is_executable(candidate))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

/// A streaming ffmpeg process that yields raw RGBA frames.
pub struct FfmpegVideo {
    child: Child,
    stdout: std::process::ChildStdout,
    width: u32,
    height: u32,
    frame_bytes: usize,
}

impl FfmpegVideo {
    pub fn open(request: &DecodeRequest, config: &DecoderConfig) -> Result<Self, MediaError> {
        if request.width == 0 || request.height == 0 {
            return Err(MediaError::Decode(
                "video decode needs non-zero dimensions".to_string(),
            ));
        }
        request.validate()?;
        let mut child = Command::new(config.executable())
            .args(decode_args(request))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                MediaError::Decode(format!(
                    "start decoder {}: {error}",
                    config.executable().display()
                ))
            })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| MediaError::Decode("decoder produced no output pipe".to_string()))?;
        let frame_bytes = usize::try_from(request.width)
            .ok()
            .and_then(|width| {
                usize::try_from(request.height)
                    .ok()
                    .and_then(|height| width.checked_mul(height))
            })
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| MediaError::Decode("video frame size overflow".to_string()))?;
        Ok(Self {
            child,
            stdout,
            width: request.width,
            height: request.height,
            frame_bytes,
        })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    /// Reads one frame. `None` means the decoder reached end of stream.
    pub fn read_frame(&mut self) -> Result<Option<Vec<u8>>, MediaError> {
        let mut buffer = vec![0u8; self.frame_bytes];
        let mut filled = 0;
        while filled < self.frame_bytes {
            let read = self
                .stdout
                .read(&mut buffer[filled..])
                .map_err(|error| MediaError::Decode(error.to_string()))?;
            if read == 0 {
                if filled == 0 {
                    return Ok(None);
                }
                return Err(MediaError::Decode(
                    "decoder stopped inside a video frame".to_string(),
                ));
            }
            filled += read;
        }
        Ok(Some(buffer))
    }
}

impl Drop for FfmpegVideo {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str) -> DecodeRequest {
        DecodeRequest {
            input: PathBuf::from(path),
            width: 1280,
            height: 720,
            fps: 30,
            start_ms: 1500,
            loop_playback: true,
        }
    }

    #[test]
    fn dimensions_are_even_and_clamped() {
        assert_eq!(even_dimension(1), 2);
        assert_eq!(even_dimension(1279), 1278);
        assert_eq!(even_dimension(1920), 1920);
        assert_eq!(even_dimension(100_000), MAX_DECODE_EDGE);
    }

    #[test]
    fn decode_args_stream_local_rgba() {
        let args = decode_args(&request("/tmp/Clip One.mp4"));
        assert!(args.windows(2).any(|pair| pair == ["-stream_loop", "-1"]));
        assert!(args.windows(2).any(|pair| pair == ["-hwaccel", "auto"]));
        assert!(args.windows(2).any(|pair| pair == ["-an", "-sn"]));
        assert!(args.windows(2).any(|pair| pair == ["-pix_fmt", "rgba"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-vf", "scale=1280:720:flags=bilinear"]));
        assert!(args.iter().any(|arg| arg == "/tmp/Clip One.mp4"));
        assert!(!args.iter().any(|arg| arg.contains("://")));
        assert_eq!(args.last().map(String::as_str), Some("pipe:1"));
    }

    #[test]
    fn non_loop_start_zero_omits_seek_and_loop() {
        let mut request = request("/tmp/clip.mp4");
        request.loop_playback = false;
        request.start_ms = 0;
        let args = decode_args(&request);
        assert!(!args.contains(&"-stream_loop".to_string()));
        assert!(!args.contains(&"-ss".to_string()));
    }

    #[test]
    fn executable_validation_rejects_urls_and_relative_paths() {
        assert!(validate_executable("https://example.com/ffmpeg").is_err());
        assert!(validate_executable("tools/ffmpeg").is_err());
        assert!(validate_executable("/definitely/missing/ffmpeg").is_err());
        assert!(validate_executable("  ffmpeg").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn executable_validation_accepts_a_local_file() {
        use std::os::unix::fs::PermissionsExt;
        let root = env::temp_dir().join(format!(
            "lumen-decoder-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let executable = root.join("decoder");
        std::fs::write(&executable, b"#!/bin/sh\nexit 0\n").expect("write decoder");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755))
            .expect("chmod decoder");
        let resolved = validate_executable(&executable.to_string_lossy()).expect("valid decoder");
        assert_eq!(resolved, executable.canonicalize().expect("canonical"));
        let config = DecoderConfig::with_executable_str(&executable.to_string_lossy())
            .expect("decoder config");
        assert_eq!(config.executable(), resolved.as_path());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn decode_rejects_remote_and_missing_inputs() {
        let config = DecoderConfig {
            executable: PathBuf::from("/bin/sh"),
        };
        assert!(FfmpegVideo::open(&request("https://example.com/clip.mp4"), &config).is_err());
        assert!(FfmpegVideo::open(&request("/definitely/missing/clip.mp4"), &config).is_err());
    }
}
