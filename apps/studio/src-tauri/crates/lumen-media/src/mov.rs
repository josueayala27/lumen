//! QuickTime / ISO BMFF video track demux.
//!
//! Reads the sample table of the first video track so intra-frame codecs (Hap)
//! can be decoded without a decoder process: every sample is addressed by file
//! offset and presentation time, which makes seeking frame-accurate.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use crate::MediaError;

const MAX_MOOV_BYTES: u64 = 64 * 1024 * 1024;
/// Largest sample accepted; an 8K Hap Q frame is about 32 MB before Snappy.
const MAX_SAMPLE_BYTES: u32 = 128 * 1024 * 1024;

/// One encoded frame in the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MovSample {
    pub offset: u64,
    pub size: u32,
    /// Decode time in track timescale units.
    pub time: u64,
    pub duration: u32,
}

/// The first video track of a QuickTime or MP4 file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MovVideoTrack {
    /// Sample description format, for example `Hap1` or `avc1`.
    pub codec: [u8; 4],
    pub width: u32,
    pub height: u32,
    pub timescale: u32,
    pub samples: Vec<MovSample>,
}

impl MovVideoTrack {
    /// Reads `moov` from a file and returns its first video track.
    pub fn open(path: &Path) -> Result<Self, MediaError> {
        let mut file = File::open(path)
            .map_err(|_| MediaError::Missing(path.to_string_lossy().into_owned()))?;
        let moov = read_moov(&mut file)?;
        Self::parse_moov(&moov)
    }

    /// Parses the payload of a `moov` box. Pure so tests can feed bytes.
    pub fn parse_moov(moov: &[u8]) -> Result<Self, MediaError> {
        for (kind, trak) in children(moov) {
            if &kind != b"trak" {
                continue;
            }
            if let Some(track) = parse_video_trak(trak)? {
                return Ok(track);
            }
        }
        Err(MediaError::Unsupported("no video track".to_string()))
    }

    /// Total length in timescale units.
    pub fn duration(&self) -> u64 {
        self.samples
            .last()
            .map(|sample| sample.time + u64::from(sample.duration))
            .unwrap_or(0)
    }

    pub fn duration_ms(&self) -> u64 {
        if self.timescale == 0 {
            return 0;
        }
        self.duration().saturating_mul(1000) / u64::from(self.timescale)
    }

    /// Average frames per second from the sample table.
    pub fn frame_rate(&self) -> f64 {
        let duration = self.duration();
        if duration == 0 || self.timescale == 0 {
            return 0.0;
        }
        self.samples.len() as f64 * f64::from(self.timescale) / duration as f64
    }

    /// Index of the sample shown at `time_ms`. Times past the end clamp to the last sample.
    pub fn sample_index_at_ms(&self, time_ms: u64) -> usize {
        if self.samples.is_empty() {
            return 0;
        }
        let time = time_ms.saturating_mul(u64::from(self.timescale)) / 1000;
        match self.samples.binary_search_by(|sample| sample.time.cmp(&time)) {
            Ok(index) => index,
            Err(0) => 0,
            Err(index) => (index - 1).min(self.samples.len() - 1),
        }
    }

    /// Presentation time of a sample in milliseconds.
    pub fn sample_time_ms(&self, index: usize) -> u64 {
        match (self.samples.get(index), self.timescale) {
            (Some(sample), timescale) if timescale > 0 => {
                sample.time.saturating_mul(1000) / u64::from(timescale)
            }
            _ => 0,
        }
    }

    /// Reads one encoded sample from an open file.
    pub fn read_sample(&self, file: &mut File, index: usize) -> Result<Vec<u8>, MediaError> {
        let sample = self
            .samples
            .get(index)
            .ok_or_else(|| MediaError::Decode(format!("sample {index} out of range")))?;
        if sample.size > MAX_SAMPLE_BYTES {
            return Err(MediaError::Decode(format!(
                "sample {index} is {} bytes",
                sample.size
            )));
        }
        file.seek(SeekFrom::Start(sample.offset))
            .map_err(|error| MediaError::Decode(error.to_string()))?;
        let mut buffer = vec![0u8; sample.size as usize];
        file.read_exact(&mut buffer)
            .map_err(|error| MediaError::Decode(format!("read sample {index}: {error}")))?;
        Ok(buffer)
    }
}

/// Walks top-level boxes and reads only `moov`, so large `mdat` payloads are skipped.
fn read_moov(file: &mut File) -> Result<Vec<u8>, MediaError> {
    let length = file
        .metadata()
        .map_err(|error| MediaError::Decode(error.to_string()))?
        .len();
    let mut offset = 0u64;
    while offset.saturating_add(8) <= length {
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| MediaError::Decode(error.to_string()))?;
        let mut header = [0u8; 16];
        let read = read_up_to(file, &mut header)?;
        if read < 8 {
            break;
        }
        let size32 = be_u32(&header, 0).unwrap_or(0);
        let kind = &header[4..8];
        let (size, header_length) = match size32 {
            0 => (length - offset, 8u64),
            1 if read >= 16 => (be_u64(&header, 8).unwrap_or(0), 16u64),
            1 => break,
            value => (u64::from(value), 8u64),
        };
        if size < header_length || offset.saturating_add(size) > length {
            break;
        }
        if kind == b"moov" {
            let payload_length = size - header_length;
            if payload_length > MAX_MOOV_BYTES {
                return Err(MediaError::Unsupported("moov box is too large".to_string()));
            }
            file.seek(SeekFrom::Start(offset + header_length))
                .map_err(|error| MediaError::Decode(error.to_string()))?;
            let mut payload = vec![0u8; payload_length as usize];
            file.read_exact(&mut payload)
                .map_err(|error| MediaError::Decode(error.to_string()))?;
            return Ok(payload);
        }
        offset += size;
    }
    Err(MediaError::Unsupported("no moov box".to_string()))
}

fn read_up_to(file: &mut File, buffer: &mut [u8]) -> Result<usize, MediaError> {
    let mut filled = 0;
    while filled < buffer.len() {
        let read = file
            .read(&mut buffer[filled..])
            .map_err(|error| MediaError::Decode(error.to_string()))?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    Ok(filled)
}

/// Direct child boxes of a container payload. Malformed tails are ignored.
fn children(data: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut boxes = Vec::new();
    let mut offset = 0usize;
    while offset + 8 <= data.len() {
        let Some(size32) = be_u32(data, offset) else { break };
        let mut kind = [0u8; 4];
        kind.copy_from_slice(&data[offset + 4..offset + 8]);
        let (size, header) = match size32 {
            0 => (data.len() - offset, 8),
            1 => match be_u64(data, offset + 8).and_then(|value| usize::try_from(value).ok()) {
                Some(value) => (value, 16),
                None => break,
            },
            value => (value as usize, 8),
        };
        if size < header || offset + size > data.len() {
            break;
        }
        boxes.push((kind, &data[offset + header..offset + size]));
        offset += size;
    }
    boxes
}

fn child<'a>(data: &'a [u8], wanted: &[u8; 4]) -> Option<&'a [u8]> {
    children(data)
        .into_iter()
        .find(|(kind, _)| kind == wanted)
        .map(|(_, payload)| payload)
}

fn parse_video_trak(trak: &[u8]) -> Result<Option<MovVideoTrack>, MediaError> {
    let Some(mdia) = child(trak, b"mdia") else {
        return Ok(None);
    };
    let is_video = child(mdia, b"hdlr").is_some_and(|hdlr| hdlr.get(8..12) == Some(b"vide"));
    if !is_video {
        return Ok(None);
    }
    let timescale = child(mdia, b"mdhd")
        .and_then(mdhd_timescale)
        .ok_or_else(|| MediaError::Decode("video track has no timescale".to_string()))?;
    let stbl = child(mdia, b"minf")
        .and_then(|minf| child(minf, b"stbl"))
        .ok_or_else(|| MediaError::Decode("video track has no sample table".to_string()))?;
    let (codec, width, height) = child(stbl, b"stsd")
        .and_then(stsd_entry)
        .ok_or_else(|| MediaError::Decode("video track has no sample description".to_string()))?;
    let samples = build_samples(stbl)?;
    Ok(Some(MovVideoTrack {
        codec,
        width,
        height,
        timescale,
        samples,
    }))
}

fn mdhd_timescale(payload: &[u8]) -> Option<u32> {
    let offset = match payload.first()? {
        0 => 12,
        1 => 20,
        _ => return None,
    };
    be_u32(payload, offset).filter(|value| *value > 0)
}

/// First sample description: format code and the visual entry's pixel size.
fn stsd_entry(payload: &[u8]) -> Option<([u8; 4], u32, u32)> {
    let entry = payload.get(8..)?;
    let mut codec = [0u8; 4];
    codec.copy_from_slice(entry.get(4..8)?);
    let width = u32::from(be_u16(entry, 32)?);
    let height = u32::from(be_u16(entry, 34)?);
    Some((codec, width, height))
}

fn build_samples(stbl: &[u8]) -> Result<Vec<MovSample>, MediaError> {
    let invalid = |what: &str| MediaError::Decode(format!("invalid {what} table"));

    let stsz = child(stbl, b"stsz").ok_or_else(|| invalid("stsz"))?;
    let fixed = be_u32(stsz, 4).ok_or_else(|| invalid("stsz"))?;
    let count = be_u32(stsz, 8).ok_or_else(|| invalid("stsz"))? as usize;
    let mut sizes = Vec::with_capacity(count.min(1 << 20));
    for index in 0..count {
        let size = if fixed != 0 {
            fixed
        } else {
            be_u32(stsz, 12 + index * 4).ok_or_else(|| invalid("stsz"))?
        };
        sizes.push(size);
    }

    let chunk_offsets: Vec<u64> = if let Some(stco) = child(stbl, b"stco") {
        let entries = be_u32(stco, 4).ok_or_else(|| invalid("stco"))? as usize;
        (0..entries)
            .map(|index| be_u32(stco, 8 + index * 4).map(u64::from))
            .collect::<Option<_>>()
            .ok_or_else(|| invalid("stco"))?
    } else if let Some(co64) = child(stbl, b"co64") {
        let entries = be_u32(co64, 4).ok_or_else(|| invalid("co64"))? as usize;
        (0..entries)
            .map(|index| be_u64(co64, 8 + index * 8))
            .collect::<Option<_>>()
            .ok_or_else(|| invalid("co64"))?
    } else {
        return Err(invalid("chunk offset"));
    };

    let stsc = child(stbl, b"stsc").ok_or_else(|| invalid("stsc"))?;
    let stsc_count = be_u32(stsc, 4).ok_or_else(|| invalid("stsc"))? as usize;
    let mut runs = Vec::with_capacity(stsc_count);
    for index in 0..stsc_count {
        let base = 8 + index * 12;
        let first_chunk = be_u32(stsc, base).ok_or_else(|| invalid("stsc"))?;
        let per_chunk = be_u32(stsc, base + 4).ok_or_else(|| invalid("stsc"))?;
        if first_chunk == 0 {
            return Err(invalid("stsc"));
        }
        runs.push((first_chunk as usize, per_chunk as usize));
    }

    let stts = child(stbl, b"stts").ok_or_else(|| invalid("stts"))?;
    let stts_count = be_u32(stts, 4).ok_or_else(|| invalid("stts"))? as usize;
    let mut deltas = Vec::with_capacity(count.min(1 << 20));
    for index in 0..stts_count {
        let base = 8 + index * 8;
        let run = be_u32(stts, base).ok_or_else(|| invalid("stts"))? as usize;
        let delta = be_u32(stts, base + 4).ok_or_else(|| invalid("stts"))?;
        for _ in 0..run {
            if deltas.len() == count {
                break;
            }
            deltas.push(delta);
        }
    }

    let mut samples = Vec::with_capacity(count.min(1 << 20));
    let mut time = 0u64;
    let mut sample_index = 0usize;
    for (chunk_index, chunk_offset) in chunk_offsets.iter().enumerate() {
        let chunk_number = chunk_index + 1;
        let per_chunk = runs
            .iter()
            .rev()
            .find(|(first, _)| *first <= chunk_number)
            .map(|(_, per_chunk)| *per_chunk)
            .unwrap_or(0);
        let mut offset = *chunk_offset;
        for _ in 0..per_chunk {
            if sample_index >= count {
                break;
            }
            let size = sizes[sample_index];
            let duration = deltas.get(sample_index).copied().unwrap_or(0);
            samples.push(MovSample {
                offset,
                size,
                time,
                duration,
            });
            offset += u64::from(size);
            time += u64::from(duration);
            sample_index += 1;
        }
    }
    if samples.len() != count {
        return Err(MediaError::Decode(format!(
            "sample table maps {} of {count} samples",
            samples.len()
        )));
    }
    Ok(samples)
}

fn be_u16(data: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(offset..offset + 2)?.try_into().ok()?))
}

fn be_u32(data: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(offset..offset + 4)?.try_into().ok()?))
}

fn be_u64(data: &[u8], offset: usize) -> Option<u64> {
    Some(u64::from_be_bytes(data.get(offset..offset + 8)?.try_into().ok()?))
}

/// Builders for synthetic QuickTime files, shared with the Hap tests.
#[cfg(test)]
pub(crate) mod fixture {
    pub fn boxed(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(payload.len() + 8);
        out.extend_from_slice(&((payload.len() + 8) as u32).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    fn full(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut payload = vec![0u8; 4];
        payload.extend_from_slice(body);
        boxed(kind, &payload)
    }

    /// A `.mov` with one video track whose samples are stored back to back in `mdat`,
    /// two samples per chunk, at `delta` timescale units per frame.
    pub fn movie(codec: &[u8; 4], width: u16, height: u16, timescale: u32, delta: u32, frames: &[Vec<u8>]) -> Vec<u8> {
        let ftyp = boxed(b"ftyp", b"qt  \0\0\0\0qt  ");
        let mut mdat_payload = Vec::new();
        for frame in frames {
            mdat_payload.extend_from_slice(frame);
        }
        let mdat = boxed(b"mdat", &mdat_payload);
        let data_start = (ftyp.len() + 8) as u32;

        let mut stsd_entry = Vec::new();
        stsd_entry.extend_from_slice(&[0u8; 6]);
        stsd_entry.extend_from_slice(&1u16.to_be_bytes());
        stsd_entry.extend_from_slice(&[0u8; 16]);
        stsd_entry.extend_from_slice(&width.to_be_bytes());
        stsd_entry.extend_from_slice(&height.to_be_bytes());
        stsd_entry.extend_from_slice(&[0u8; 50]);
        let mut stsd_body = 1u32.to_be_bytes().to_vec();
        stsd_body.extend_from_slice(&boxed(codec, &stsd_entry));

        let mut stts_body = 1u32.to_be_bytes().to_vec();
        stts_body.extend_from_slice(&(frames.len() as u32).to_be_bytes());
        stts_body.extend_from_slice(&delta.to_be_bytes());

        let mut stsz_body = 0u32.to_be_bytes().to_vec();
        stsz_body.extend_from_slice(&(frames.len() as u32).to_be_bytes());
        for frame in frames {
            stsz_body.extend_from_slice(&(frame.len() as u32).to_be_bytes());
        }

        let mut stsc_body = 1u32.to_be_bytes().to_vec();
        stsc_body.extend_from_slice(&1u32.to_be_bytes());
        stsc_body.extend_from_slice(&2u32.to_be_bytes());
        stsc_body.extend_from_slice(&1u32.to_be_bytes());

        let chunks: Vec<u32> = {
            let mut offsets = Vec::new();
            let mut offset = data_start;
            for pair in frames.chunks(2) {
                offsets.push(offset);
                offset += pair.iter().map(|frame| frame.len() as u32).sum::<u32>();
            }
            offsets
        };
        let mut stco_body = (chunks.len() as u32).to_be_bytes().to_vec();
        for offset in &chunks {
            stco_body.extend_from_slice(&offset.to_be_bytes());
        }

        let stbl = boxed(
            b"stbl",
            &[
                full(b"stsd", &stsd_body),
                full(b"stts", &stts_body),
                full(b"stsc", &stsc_body),
                full(b"stsz", &stsz_body),
                full(b"stco", &stco_body),
            ]
            .concat(),
        );
        let minf = boxed(b"minf", &stbl);
        let mut mdhd_body = vec![0u8; 8];
        mdhd_body.extend_from_slice(&timescale.to_be_bytes());
        mdhd_body.extend_from_slice(&(delta * frames.len() as u32).to_be_bytes());
        mdhd_body.extend_from_slice(&[0u8; 4]);
        let mut hdlr_body = vec![0u8; 4];
        hdlr_body.extend_from_slice(b"vide");
        hdlr_body.extend_from_slice(&[0u8; 13]);
        let mdia = boxed(b"mdia", &[full(b"mdhd", &mdhd_body), full(b"hdlr", &hdlr_body), minf].concat());
        let mut sound_hdlr = vec![0u8; 4];
        sound_hdlr.extend_from_slice(b"soun");
        sound_hdlr.extend_from_slice(&[0u8; 13]);
        let audio_trak = boxed(b"trak", &boxed(b"mdia", &full(b"hdlr", &sound_hdlr)));
        let moov = boxed(b"moov", &[audio_trak, boxed(b"trak", &mdia)].concat());
        [ftyp, mdat, moov].concat()
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::movie;
    use super::*;

    fn moov_payload(file: &[u8]) -> &[u8] {
        let (_, moov) = children(file)
            .into_iter()
            .find(|(kind, _)| kind == b"moov")
            .expect("moov");
        moov
    }

    #[test]
    fn parses_the_video_track_and_sample_offsets() {
        let frames = vec![vec![1u8; 10], vec![2u8; 20], vec![3u8; 30]];
        let file = movie(b"Hap1", 64, 32, 600, 20, &frames);
        let track = MovVideoTrack::parse_moov(moov_payload(&file)).expect("track");
        assert_eq!(&track.codec, b"Hap1");
        assert_eq!((track.width, track.height), (64, 32));
        assert_eq!(track.timescale, 600);
        assert_eq!(track.samples.len(), 3);
        for (sample, frame) in track.samples.iter().zip(&frames) {
            let start = sample.offset as usize;
            assert_eq!(&file[start..start + sample.size as usize], frame.as_slice());
        }
        assert_eq!(track.samples[2].time, 40);
        assert!((track.frame_rate() - 30.0).abs() < 1e-9);
        assert_eq!(track.duration_ms(), 100);
    }

    #[test]
    fn maps_times_to_frames() {
        let frames = vec![vec![0u8; 4]; 5];
        let file = movie(b"Hap1", 8, 8, 30, 1, &frames);
        let track = MovVideoTrack::parse_moov(moov_payload(&file)).expect("track");
        assert_eq!(track.sample_index_at_ms(0), 0);
        assert_eq!(track.sample_index_at_ms(33), 0);
        assert_eq!(track.sample_index_at_ms(34), 1);
        assert_eq!(track.sample_index_at_ms(10_000), 4);
        assert_eq!(track.sample_time_ms(3), 100);
    }

    #[test]
    fn reads_samples_from_disk() {
        let frames = vec![vec![7u8; 16], vec![9u8; 8]];
        let file = movie(b"HapY", 8, 8, 25, 1, &frames);
        let path = std::env::temp_dir().join(format!("lumen-mov-{}.mov", std::process::id()));
        std::fs::write(&path, &file).expect("write fixture");
        let track = MovVideoTrack::open(&path).expect("open");
        let mut handle = File::open(&path).expect("reopen");
        assert_eq!(track.read_sample(&mut handle, 1).expect("sample"), vec![9u8; 8]);
        assert!(track.read_sample(&mut handle, 2).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_files_without_video() {
        assert!(MovVideoTrack::parse_moov(&[]).is_err());
    }
}
