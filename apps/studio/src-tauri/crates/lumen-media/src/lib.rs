//! Media probing and playback interfaces.
//!
//! Platform decoders (VideoToolbox / Media Foundation) are the first backend; an LGPL ffmpeg
//! sidecar covers other codecs. Audio is the master clock for video sync.

use serde::{Deserialize, Serialize};

pub mod decoder;
pub mod probe;
pub mod thumbnail;
pub mod util;

pub use decoder::{DecodeRequest, DecoderConfig, FfmpegVideo};
pub use probe::{FileProbe, VideoProbe};
pub use util::{MediaKind, MAX_IMPORT_BYTES};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub mime: String,
    pub has_audio: bool,
}

pub trait MediaBackend {
    fn probe(&self, path: &str) -> Result<MediaInfo, MediaError>;
}

#[derive(Debug)]
pub enum MediaError {
    Missing(String),
    Unsupported(String),
    Decode(String),
}

impl std::fmt::Display for MediaError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MediaError::Missing(path) => write!(formatter, "missing media {path}"),
            MediaError::Unsupported(mime) => write!(formatter, "unsupported media {mime}"),
            MediaError::Decode(message) => write!(formatter, "decode error: {message}"),
        }
    }
}

impl std::error::Error for MediaError {}

/// Audio-master clock. Video frames seek to this position within the sync tolerance.
#[derive(Debug, Clone)]
pub struct PlaybackClock {
    started_at_ms: Option<u64>,
    offset_ms: u64,
}

pub const AV_SYNC_TOLERANCE_MS: u64 = 40;

impl PlaybackClock {
    pub fn new() -> Self {
        Self {
            started_at_ms: None,
            offset_ms: 0,
        }
    }

    pub fn start(&mut self, now_ms: u64) {
        self.started_at_ms = Some(now_ms);
    }

    pub fn pause(&mut self, now_ms: u64) {
        if let Some(started) = self.started_at_ms.take() {
            self.offset_ms += now_ms.saturating_sub(started);
        }
    }

    pub fn position_ms(&self, now_ms: u64) -> u64 {
        match self.started_at_ms {
            Some(started) => self.offset_ms + now_ms.saturating_sub(started),
            None => self.offset_ms,
        }
    }
}

impl Default for PlaybackClock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_pauses_and_resumes_without_drift() {
        let mut clock = PlaybackClock::new();
        clock.start(1_000);
        clock.pause(1_500);
        assert_eq!(clock.position_ms(9_000), 500);
        clock.start(2_000);
        assert_eq!(clock.position_ms(2_250), 750);
    }
}
