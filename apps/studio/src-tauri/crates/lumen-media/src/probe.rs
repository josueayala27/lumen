//! File probing for image, video and audio assets.
//!
//! Video metadata comes from the container header (ISO BMFF or EBML). Frame
//! extraction and playback still need a decoder backend; `MediaBackend` is the
//! seam for that work.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use crate::util::{detect_mime, kind_for_mime, MediaKind};
use crate::{MediaBackend, MediaError, MediaInfo};

const HEADER_BYTES: usize = 64;
const MAX_MOOV_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EBML_SCAN_BYTES: u64 = 8 * 1024 * 1024;

/// File-backed probe used by the desktop import command.
#[derive(Debug, Default, Clone, Copy)]
pub struct FileProbe;

impl FileProbe {
    pub fn new() -> Self {
        Self
    }
}

impl MediaBackend for FileProbe {
    fn probe(&self, path: &str) -> Result<MediaInfo, MediaError> {
        probe_file(path)
    }
}

/// Container metadata shared by the ISO BMFF and EBML probes.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct VideoProbe {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub has_audio: bool,
}

pub fn probe_file(path: &str) -> Result<MediaInfo, MediaError> {
    let mut file = File::open(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => MediaError::Missing(path.to_string()),
        _ => MediaError::Decode(error.to_string()),
    })?;
    let mut header = vec![0u8; HEADER_BYTES];
    let read = file
        .read(&mut header)
        .map_err(|error| MediaError::Decode(error.to_string()))?;
    header.truncate(read);
    let mime = detect_mime(path, &header).ok_or_else(|| MediaError::Unsupported(path.to_string()))?;

    match kind_for_mime(&mime) {
        Some(MediaKind::Image) => image_info(path, mime),
        Some(MediaKind::Video) => video_info(&mut file, mime),
        Some(MediaKind::Audio) => Ok(MediaInfo {
            duration_ms: None,
            width: None,
            height: None,
            mime,
            has_audio: true,
        }),
        None => Err(MediaError::Unsupported(mime)),
    }
}

fn image_info(path: &str, mime: String) -> Result<MediaInfo, MediaError> {
    let (width, height) = image::ImageReader::open(path)
        .map_err(|error| MediaError::Decode(error.to_string()))?
        .with_guessed_format()
        .map_err(|error| MediaError::Decode(error.to_string()))?
        .into_dimensions()
        .map_err(|error| MediaError::Decode(error.to_string()))?;
    Ok(MediaInfo {
        duration_ms: None,
        width: Some(width),
        height: Some(height),
        mime,
        has_audio: false,
    })
}

fn video_info(file: &mut File, mime: String) -> Result<MediaInfo, MediaError> {
    let probe = match mime.as_str() {
        "video/mp4" | "video/quicktime" => probe_isobmff_file(file)
            .ok_or_else(|| MediaError::Decode("video has no moov box".to_string()))?,
        "video/webm" => probe_ebml_file(file)
            .ok_or_else(|| MediaError::Decode("video has no EBML header".to_string()))?,
        other => return Err(MediaError::Unsupported(other.to_string())),
    };
    Ok(MediaInfo {
        duration_ms: probe.duration_ms,
        width: probe.width,
        height: probe.height,
        mime,
        has_audio: probe.has_audio,
    })
}

fn read_exact_or_partial(file: &mut File, buffer: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        let read = file.read(&mut buffer[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    Ok(filled)
}

/// Walks top-level boxes and reads only `moov`, so large `mdat` payloads are skipped.
fn probe_isobmff_file(file: &mut File) -> Option<VideoProbe> {
    let length = file.metadata().ok()?.len();
    let mut offset = 0u64;
    while offset.saturating_add(8) <= length {
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut header = [0u8; 16];
        let read = read_exact_or_partial(file, &mut header).ok()?;
        if read < 8 {
            return None;
        }
        let size32 = u32::from_be_bytes(header[0..4].try_into().ok()?);
        let kind: [u8; 4] = header[4..8].try_into().ok()?;
        let (size, header_length) = match size32 {
            0 => (length - offset, 8u64),
            1 => {
                if read < 16 {
                    return None;
                }
                (u64::from_be_bytes(header[8..16].try_into().ok()?), 16u64)
            }
            value => (u64::from(value), 8u64),
        };
        if size < header_length || offset.checked_add(size)? > length {
            return None;
        }
        if &kind == b"moov" {
            let payload_length = (size - header_length).min(MAX_MOOV_BYTES);
            file.seek(SeekFrom::Start(offset + header_length)).ok()?;
            let mut payload = vec![0u8; usize::try_from(payload_length).ok()?];
            file.read_exact(&mut payload).ok()?;
            return Some(probe_isobmff(&payload));
        }
        offset = offset.checked_add(size)?;
    }
    None
}

/// Reads the head of an EBML file; `Info` and `Tracks` live near the start.
fn probe_ebml_file(file: &mut File) -> Option<VideoProbe> {
    let length = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut data = Vec::new();
    file.take(length.min(MAX_EBML_SCAN_BYTES))
        .read_to_end(&mut data)
        .ok()?;
    let probe = probe_ebml(&data);
    if probe == VideoProbe::default() {
        return None;
    }
    Some(probe)
}

/// ISO BMFF (`mp4`, `mov`) probe over a box tree. Pure so tests can feed bytes.
pub fn probe_isobmff(data: &[u8]) -> VideoProbe {
    let mut probe = VideoProbe::default();
    walk_boxes(data, 0, data.len(), 0, &mut |kind, payload| {
        if kind == b"mvhd" {
            if probe.duration_ms.is_none() {
                probe.duration_ms = mvhd_duration(payload);
            }
        } else if kind == b"tkhd" {
            if let Some((width, height)) = tkhd_dimensions(payload) {
                if probe.width.unwrap_or(0) == 0 {
                    probe.width = Some(width);
                    probe.height = Some(height);
                }
            }
        } else if kind == b"hdlr" && payload.len() >= 12 && &payload[8..12] == b"soun" {
            probe.has_audio = true;
        }
    });
    probe
}

fn walk_boxes<F>(data: &[u8], start: usize, end: usize, depth: usize, visit: &mut F)
where
    F: FnMut(&[u8; 4], &[u8]),
{
    if depth > 8 {
        return;
    }
    let mut offset = start;
    while offset.saturating_add(8) <= end {
        let size32 = u32::from_be_bytes(match data.get(offset..offset + 4) {
            Some(bytes) => match bytes.try_into() {
                Ok(value) => value,
                Err(_) => return,
            },
            None => return,
        });
        let kind: [u8; 4] = match data.get(offset + 4..offset + 8) {
            Some(bytes) => match bytes.try_into() {
                Ok(value) => value,
                Err(_) => return,
            },
            None => return,
        };
        let (size, header_length) = match size32 {
            0 => ((end - offset) as u64, 8u64),
            1 => {
                if offset + 16 > end {
                    return;
                }
                let large = u64::from_be_bytes(data[offset + 8..offset + 16].try_into().unwrap());
                (large, 16u64)
            }
            value => (u64::from(value), 8u64),
        };
        let Ok(size) = usize::try_from(size) else {
            return;
        };
        let Ok(header_length) = usize::try_from(header_length) else {
            return;
        };
        if size < header_length || offset.saturating_add(size) > end {
            return;
        }
        let payload = &data[offset + header_length..offset + size];
        visit(&kind, payload);
        if is_container(&kind) {
            walk_boxes(data, offset + header_length, offset + size, depth + 1, visit);
        }
        offset += size;
    }
}

fn is_container(kind: &[u8; 4]) -> bool {
    const CONTAINERS: [&[u8; 4]; 8] = [
        b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"udta", b"mvex",
    ];
    CONTAINERS.iter().any(|container| kind == *container)
}

fn mvhd_duration(payload: &[u8]) -> Option<u64> {
    let (timescale, duration) = match payload.first().copied()? {
        0 if payload.len() >= 20 => (
            u32::from_be_bytes(payload[12..16].try_into().ok()?) as u64,
            u32::from_be_bytes(payload[16..20].try_into().ok()?) as u64,
        ),
        1 if payload.len() >= 32 => (
            u32::from_be_bytes(payload[20..24].try_into().ok()?) as u64,
            u64::from_be_bytes(payload[24..32].try_into().ok()?),
        ),
        _ => return None,
    };
    if timescale == 0 {
        return None;
    }
    duration.checked_mul(1000).map(|value| value / timescale)
}

fn tkhd_dimensions(payload: &[u8]) -> Option<(u32, u32)> {
    if payload.len() < 8 {
        return None;
    }
    let length = payload.len();
    let width = u32::from_be_bytes(payload[length - 8..length - 4].try_into().ok()?) >> 16;
    let height = u32::from_be_bytes(payload[length - 4..length].try_into().ok()?) >> 16;
    if width == 0 || height == 0 {
        return None;
    }
    Some((width, height))
}

/// EBML (`webm`) probe over the document tree. Pure so tests can feed bytes.
pub fn probe_ebml(data: &[u8]) -> VideoProbe {
    let mut probe = VideoProbe::default();
    let mut timescale: u64 = 1_000_000;
    let mut duration: Option<f64> = None;
    walk_ebml(data, 0, data.len(), 0, &mut |id, payload| match id {
        0x2AD7B1 => {
            if let Some(value) = be_uint(payload) {
                timescale = value;
            }
        }
        0x4489 => {
            if payload.len() == 4 {
                duration = Some(f64::from(f32::from_be_bytes(
                    payload.try_into().unwrap_or_default(),
                )));
            } else if payload.len() == 8 {
                duration = Some(f64::from_be_bytes(payload.try_into().unwrap_or_default()));
            }
        }
        0xB0 => {
            if let Some(width) = be_uint(payload).and_then(|value| u32::try_from(value).ok()) {
                probe.width = Some(width);
            }
        }
        0xBA => {
            if let Some(height) = be_uint(payload).and_then(|value| u32::try_from(value).ok()) {
                probe.height = Some(height);
            }
        }
        _ => {}
    });
    if let (Some(duration), true) = (duration, timescale > 0) {
        let milliseconds = duration * timescale as f64 / 1_000_000.0;
        probe.duration_ms = Some(milliseconds.round().max(0.0) as u64);
    }
    probe
}

fn walk_ebml<F>(data: &[u8], start: usize, end: usize, depth: usize, visit: &mut F)
where
    F: FnMut(u64, &[u8]),
{
    if depth > 16 {
        return;
    }
    let mut offset = start;
    while offset < end {
        let Some((id, id_length)) = read_ebml_id(data, offset) else {
            return;
        };
        let Some((size, size_length, unknown)) = read_ebml_size(data, offset + id_length) else {
            return;
        };
        let Ok(size) = usize::try_from(size) else {
            return;
        };
        let payload_start = offset + id_length + size_length;
        if payload_start > end {
            return;
        }
        let payload_end = if unknown {
            end
        } else {
            payload_start.saturating_add(size).min(end)
        };
        visit(id, &data[payload_start..payload_end]);
        if is_ebml_container(id) {
            walk_ebml(data, payload_start, payload_end, depth + 1, visit);
        }
        if unknown {
            return;
        }
        let next = payload_start.saturating_add(size);
        if next <= offset {
            return;
        }
        offset = next;
    }
}

fn is_ebml_container(id: u64) -> bool {
    matches!(
        id,
        0x18538067 // Segment
            | 0x1549A966 // Info
            | 0x1654AE6B // Tracks
            | 0xAE // TrackEntry
            | 0xE0 // Video
            | 0x1F43B675 // Cluster
    )
}

fn read_ebml_id(data: &[u8], position: usize) -> Option<(u64, usize)> {
    let first = *data.get(position)?;
    if first == 0 {
        return None;
    }
    let length = first.leading_zeros() as usize + 1;
    if length > 4 || position + length > data.len() {
        return None;
    }
    let mut value = 0u64;
    for byte in &data[position..position + length] {
        value = (value << 8) | u64::from(*byte);
    }
    Some((value, length))
}

fn read_ebml_size(data: &[u8], position: usize) -> Option<(u64, usize, bool)> {
    let first = *data.get(position)?;
    if first == 0 {
        return None;
    }
    let length = first.leading_zeros() as usize + 1;
    if length > 8 || position + length > data.len() {
        return None;
    }
    let mask = 0xFFu8 >> length;
    let mut value = u64::from(first & mask);
    let mut all_ones = (first & mask) == mask;
    for byte in &data[position + 1..position + length] {
        value = (value << 8) | u64::from(*byte);
        all_ones &= *byte == 0xFF;
    }
    Some((value, length, all_ones))
}

fn be_uint(payload: &[u8]) -> Option<u64> {
    if payload.is_empty() || payload.len() > 8 {
        return None;
    }
    let mut value = 0u64;
    for byte in payload {
        value = (value << 8) | u64::from(*byte);
    }
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxed(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + payload.len());
        out.extend_from_slice(&(u32::try_from(8 + payload.len()).unwrap()).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    fn mvhd(timescale: u32, duration: u32) -> Vec<u8> {
        let mut payload = vec![0u8; 20];
        payload[12..16].copy_from_slice(&timescale.to_be_bytes());
        payload[16..20].copy_from_slice(&duration.to_be_bytes());
        boxed(b"mvhd", &payload)
    }

    fn tkhd(width: u32, height: u32) -> Vec<u8> {
        let mut payload = vec![0u8; 16];
        let length = payload.len();
        payload[length - 8..length - 4].copy_from_slice(&(width << 16).to_be_bytes());
        payload[length - 4..length].copy_from_slice(&(height << 16).to_be_bytes());
        boxed(b"tkhd", &payload)
    }

    fn hdlr(handler: &[u8; 4]) -> Vec<u8> {
        let mut payload = vec![0u8; 12];
        payload[8..12].copy_from_slice(handler);
        boxed(b"hdlr", &payload)
    }

    #[test]
    fn isobmff_reads_duration_dimensions_and_audio() {
        let mut trak = tkhd(1920, 1080);
        trak.extend_from_slice(&hdlr(b"soun"));
        let mut moov = mvhd(1000, 5000);
        moov.extend_from_slice(&boxed(b"trak", &trak));
        let mut data = boxed(b"ftyp", b"isom\0\0\0\0");
        data.extend_from_slice(&boxed(b"moov", &moov));

        let probe = probe_isobmff(&data);
        assert_eq!(probe.duration_ms, Some(5000));
        assert_eq!(probe.width, Some(1920));
        assert_eq!(probe.height, Some(1080));
        assert!(probe.has_audio);
    }

    #[test]
    fn isobmff_rejects_truncated_boxes() {
        assert_eq!(probe_isobmff(&[0, 0, 0, 64, b'm', b'o']), VideoProbe::default());
    }

    #[test]
    fn ebml_reads_duration_and_pixels() {
        fn element(id: u64, payload: &[u8]) -> Vec<u8> {
            let id_bytes = if id <= 0xFF {
                vec![id as u8]
            } else if id <= 0xFFFF {
                vec![(id >> 8) as u8, id as u8]
            } else if id <= 0xFF_FFFF {
                vec![(id >> 16) as u8, (id >> 8) as u8, id as u8]
            } else {
                vec![
                    (id >> 24) as u8,
                    (id >> 16) as u8,
                    (id >> 8) as u8,
                    id as u8,
                ]
            };
            let mut out = id_bytes;
            out.push(0x80 | u8::try_from(payload.len()).unwrap());
            out.extend_from_slice(payload);
            out
        }

        let mut info = element(0x2AD7B1, &1_000_000u32.to_be_bytes());
        info.extend_from_slice(&element(0x4489, &5000f64.to_be_bytes()));
        let mut video = element(0xB0, &1280u16.to_be_bytes());
        video.extend_from_slice(&element(0xBA, &720u16.to_be_bytes()));
        let mut tracks = element(0xAE, &element(0xE0, &video));
        tracks = element(0x1654AE6B, &tracks);
        let mut data = vec![0x1A, 0x45, 0xDF, 0xA3];
        data.extend_from_slice(&element(0x1549A966, &info));
        data.extend_from_slice(&tracks);

        let probe = probe_ebml(&data);
        assert_eq!(probe.duration_ms, Some(5000));
        assert_eq!(probe.width, Some(1280));
        assert_eq!(probe.height, Some(720));
    }
}
