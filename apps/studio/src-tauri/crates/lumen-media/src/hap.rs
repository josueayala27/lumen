//! Hap frame decoding (Vidvox Hap, Hap Alpha, Hap Q, Hap Q Alpha, Hap R).
//!
//! A Hap frame is GPU block-compressed texture data (BC1/BC3/BC4/BC7) wrapped in
//! sections and an optional Snappy second stage. Decoding only undoes the second
//! stage; the texture data goes to the GPU as-is. Every frame is independent, so
//! seeking is exact. Layout follows the Hap specification (Vidvox, HapVideoDRAFT).

use crate::MediaError;

/// Pixel format of one decoded texture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HapTextureFormat {
    /// RGB DXT1 (`Hap1`).
    Bc1,
    /// RGBA DXT5 (`Hap5`).
    Bc3,
    /// Scaled YCoCg DXT5 (`HapY`, colour plane of `HapM`). Needs a colour conversion.
    Bc3YCoCg,
    /// Alpha RGTC1 (`HapA`, alpha plane of `HapM`).
    Bc4,
    /// RGBA BPTC UNORM (`Hap7`).
    Bc7,
}

impl HapTextureFormat {
    /// Bytes per 4×4 block.
    pub fn block_bytes(self) -> usize {
        match self {
            HapTextureFormat::Bc1 | HapTextureFormat::Bc4 => 8,
            HapTextureFormat::Bc3 | HapTextureFormat::Bc3YCoCg | HapTextureFormat::Bc7 => 16,
        }
    }

    /// Expected payload length for a `width`×`height` image.
    pub fn data_len(self, width: u32, height: u32) -> usize {
        let blocks_x = width.div_ceil(4) as usize;
        let blocks_y = height.div_ceil(4) as usize;
        blocks_x * blocks_y * self.block_bytes()
    }
}

/// One block-compressed image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HapTexture {
    pub format: HapTextureFormat,
    pub data: Vec<u8>,
}

/// A decoded frame: one texture, or Hap Q Alpha's colour plus alpha.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HapFrame {
    pub textures: Vec<HapTexture>,
}

/// QuickTime sample description codes that carry Hap frames.
pub fn is_hap_codec(codec: &[u8; 4]) -> bool {
    matches!(
        codec,
        b"Hap1" | b"Hap5" | b"HapY" | b"HapM" | b"HapA" | b"Hap7"
    )
}

const MULTIPLE_IMAGES: u8 = 0x0D;
const DECODE_INSTRUCTIONS: u8 = 0x01;
const CHUNK_COMPRESSORS: u8 = 0x02;
const CHUNK_SIZES: u8 = 0x03;
const CHUNK_OFFSETS: u8 = 0x04;
const COMPRESSOR_NONE: u8 = 0x0A;
const COMPRESSOR_SNAPPY: u8 = 0x0B;
const COMPRESSOR_COMPLEX: u8 = 0x0C;
/// Upper bound for one decompressed texture (8K × 8K BC3).
const MAX_TEXTURE_BYTES: usize = 64 * 1024 * 1024;

fn invalid(message: impl Into<String>) -> MediaError {
    MediaError::Decode(format!("hap: {}", message.into()))
}

/// One section: its type byte, payload, and the bytes after it.
fn section(data: &[u8]) -> Result<(u8, &[u8], &[u8]), MediaError> {
    if data.len() < 4 {
        return Err(invalid("truncated section header"));
    }
    let short = u32::from(data[0]) | u32::from(data[1]) << 8 | u32::from(data[2]) << 16;
    let kind = data[3];
    let (size, header): (usize, usize) = if short == 0 {
        let bytes = data
            .get(4..8)
            .ok_or_else(|| invalid("truncated section header"))?;
        (u32::from_le_bytes(bytes.try_into().unwrap()) as usize, 8)
    } else {
        (short as usize, 4)
    };
    let end = header
        .checked_add(size)
        .filter(|end| *end <= data.len())
        .ok_or_else(|| invalid("section runs past the frame"))?;
    Ok((kind, &data[header..end], &data[end..]))
}

fn texture_format(code: u8) -> Result<HapTextureFormat, MediaError> {
    match code & 0x0F {
        0x0B => Ok(HapTextureFormat::Bc1),
        0x0E => Ok(HapTextureFormat::Bc3),
        0x0F => Ok(HapTextureFormat::Bc3YCoCg),
        0x01 => Ok(HapTextureFormat::Bc4),
        0x0C => Ok(HapTextureFormat::Bc7),
        0x02 | 0x03 => Err(MediaError::Unsupported(
            "Hap HDR (BC6) is not supported".to_string(),
        )),
        other => Err(invalid(format!("unknown texture format 0x{other:X}"))),
    }
}

fn snappy(data: &[u8]) -> Result<Vec<u8>, MediaError> {
    let length = snap::raw::decompress_len(data).map_err(|error| invalid(error.to_string()))?;
    if length > MAX_TEXTURE_BYTES {
        return Err(invalid(format!("texture of {length} bytes is too large")));
    }
    snap::raw::Decoder::new()
        .decompress_vec(data)
        .map_err(|error| invalid(error.to_string()))
}

fn le_u32_table(data: &[u8]) -> Result<Vec<u32>, MediaError> {
    let (entries, rest) = data.as_chunks::<4>();
    if !rest.is_empty() {
        return Err(invalid("chunk table is not a multiple of four bytes"));
    }
    Ok(entries
        .iter()
        .map(|bytes| u32::from_le_bytes(*bytes))
        .collect())
}

/// Undoes chunked second-stage compression ("decode instructions").
fn decode_complex(payload: &[u8]) -> Result<Vec<u8>, MediaError> {
    let (kind, instructions, frame_data) = section(payload)?;
    if kind != DECODE_INSTRUCTIONS {
        return Err(invalid("complex section has no decode instructions"));
    }
    let mut compressors: Option<&[u8]> = None;
    let mut sizes: Option<Vec<u32>> = None;
    let mut offsets: Option<Vec<u32>> = None;
    let mut rest = instructions;
    while !rest.is_empty() {
        let (kind, body, tail) = section(rest)?;
        match kind {
            CHUNK_COMPRESSORS => compressors = Some(body),
            CHUNK_SIZES => sizes = Some(le_u32_table(body)?),
            CHUNK_OFFSETS => offsets = Some(le_u32_table(body)?),
            _ => {}
        }
        rest = tail;
    }
    let compressors = compressors.ok_or_else(|| invalid("missing chunk compressor table"))?;
    let sizes = sizes.ok_or_else(|| invalid("missing chunk size table"))?;
    if compressors.len() != sizes.len() {
        return Err(invalid("chunk tables disagree on chunk count"));
    }
    if offsets
        .as_ref()
        .is_some_and(|offsets| offsets.len() != sizes.len())
    {
        return Err(invalid("chunk tables disagree on chunk count"));
    }

    let mut output = Vec::new();
    let mut running = 0usize;
    for (index, (&compressor, &size)) in compressors.iter().zip(&sizes).enumerate() {
        let start = match &offsets {
            Some(offsets) => offsets[index] as usize,
            None => running,
        };
        let end = start
            .checked_add(size as usize)
            .filter(|end| *end <= frame_data.len())
            .ok_or_else(|| invalid(format!("chunk {index} runs past the frame")))?;
        let chunk = &frame_data[start..end];
        match compressor {
            COMPRESSOR_NONE => output.extend_from_slice(chunk),
            COMPRESSOR_SNAPPY => output.extend_from_slice(&snappy(chunk)?),
            other => return Err(invalid(format!("unknown chunk compressor 0x{other:X}"))),
        }
        if output.len() > MAX_TEXTURE_BYTES {
            return Err(invalid("decompressed texture is too large"));
        }
        running = end;
    }
    Ok(output)
}

fn decode_texture(kind: u8, payload: &[u8]) -> Result<HapTexture, MediaError> {
    let format = texture_format(kind)?;
    let data = match kind >> 4 {
        COMPRESSOR_NONE => payload.to_vec(),
        COMPRESSOR_SNAPPY => snappy(payload)?,
        COMPRESSOR_COMPLEX => decode_complex(payload)?,
        other => {
            return Err(invalid(format!(
                "unknown second-stage compressor 0x{other:X}"
            )))
        }
    };
    Ok(HapTexture { format, data })
}

/// Decodes one Hap frame into block-compressed textures.
pub fn decode_frame(data: &[u8]) -> Result<HapFrame, MediaError> {
    let (kind, payload, _) = section(data)?;
    if kind != MULTIPLE_IMAGES {
        return Ok(HapFrame {
            textures: vec![decode_texture(kind, payload)?],
        });
    }
    let mut textures = Vec::new();
    let mut rest = payload;
    while !rest.is_empty() {
        let (kind, body, tail) = section(rest)?;
        textures.push(decode_texture(kind, body)?);
        rest = tail;
    }
    match textures.as_slice() {
        [color, alpha]
            if color.format == HapTextureFormat::Bc3YCoCg
                && alpha.format == HapTextureFormat::Bc4 =>
        {
            Ok(HapFrame { textures })
        }
        _ => Err(invalid(
            "multiple-image frames must be Scaled YCoCg DXT5 plus RGTC1 alpha",
        )),
    }
}

/// Checks that each texture has the byte length its format needs at `width`×`height`.
pub fn validate_frame(frame: &HapFrame, width: u32, height: u32) -> Result<(), MediaError> {
    for texture in &frame.textures {
        let expected = texture.format.data_len(width, height);
        if texture.data.len() < expected {
            return Err(invalid(format!(
                "{:?} texture has {} bytes, expected {expected}",
                texture.format,
                texture.data.len()
            )));
        }
    }
    Ok(())
}

/// Builders for synthetic Hap frames, shared with other tests.
#[cfg(test)]
pub(crate) mod fixture {
    pub fn section(kind: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        if payload.len() < 1 << 24 && !payload.is_empty() {
            let size = payload.len() as u32;
            out.extend_from_slice(&size.to_le_bytes()[..3]);
            out.push(kind);
        } else {
            out.extend_from_slice(&[0, 0, 0, kind]);
            out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        }
        out.extend_from_slice(payload);
        out
    }

    pub fn snappy(data: &[u8]) -> Vec<u8> {
        snap::raw::Encoder::new()
            .compress_vec(data)
            .expect("snappy")
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::{section as encode, snappy as compress};
    use super::*;

    fn blocks(format: HapTextureFormat, width: u32, height: u32, seed: u8) -> Vec<u8> {
        (0..format.data_len(width, height))
            .map(|index| seed.wrapping_add(index as u8))
            .collect()
    }

    #[test]
    fn decodes_uncompressed_and_snappy_textures() {
        let raw = blocks(HapTextureFormat::Bc1, 8, 8, 3);
        let plain = decode_frame(&encode(0xAB, &raw)).expect("plain");
        assert_eq!(
            plain.textures,
            vec![HapTexture {
                format: HapTextureFormat::Bc1,
                data: raw.clone()
            }]
        );

        let raw = blocks(HapTextureFormat::Bc3YCoCg, 16, 8, 9);
        let frame = decode_frame(&encode(0xBF, &compress(&raw))).expect("snappy");
        assert_eq!(frame.textures[0].format, HapTextureFormat::Bc3YCoCg);
        assert_eq!(frame.textures[0].data, raw);
        validate_frame(&frame, 16, 8).expect("valid size");
        assert!(validate_frame(&frame, 32, 32).is_err());
    }

    #[test]
    fn decodes_chunked_frames_with_and_without_offsets() {
        let raw = blocks(HapTextureFormat::Bc3, 16, 16, 1);
        let (first, second) = raw.split_at(raw.len() / 2);
        let compressed = compress(second);
        let mut frame_data = first.to_vec();
        frame_data.extend_from_slice(&compressed);

        let sizes: Vec<u8> = [first.len() as u32, compressed.len() as u32]
            .iter()
            .flat_map(|size| size.to_le_bytes())
            .collect();
        let tables = [
            encode(CHUNK_COMPRESSORS, &[COMPRESSOR_NONE, COMPRESSOR_SNAPPY]),
            encode(CHUNK_SIZES, &sizes),
        ]
        .concat();
        let mut payload = encode(DECODE_INSTRUCTIONS, &tables);
        payload.extend_from_slice(&frame_data);
        let frame = decode_frame(&encode(0xCE, &payload)).expect("chunked");
        assert_eq!(frame.textures[0].data, raw);

        // Same chunks stored in reverse order, located through the offset table.
        let mut reversed = compressed.clone();
        reversed.extend_from_slice(first);
        let offsets: Vec<u8> = [compressed.len() as u32, 0]
            .iter()
            .flat_map(|offset| offset.to_le_bytes())
            .collect();
        let tables = [
            encode(CHUNK_COMPRESSORS, &[COMPRESSOR_NONE, COMPRESSOR_SNAPPY]),
            encode(CHUNK_SIZES, &sizes),
            encode(CHUNK_OFFSETS, &offsets),
        ]
        .concat();
        let mut payload = encode(DECODE_INSTRUCTIONS, &tables);
        payload.extend_from_slice(&reversed);
        let frame = decode_frame(&encode(0xCE, &payload)).expect("offsets");
        assert_eq!(frame.textures[0].data, raw);
    }

    #[test]
    fn decodes_hap_q_alpha_as_two_planes() {
        let color = blocks(HapTextureFormat::Bc3YCoCg, 8, 8, 5);
        let alpha = blocks(HapTextureFormat::Bc4, 8, 8, 7);
        let inner = [encode(0xBF, &compress(&color)), encode(0xA1, &alpha)].concat();
        let frame = decode_frame(&encode(MULTIPLE_IMAGES, &inner)).expect("hap q alpha");
        assert_eq!(frame.textures.len(), 2);
        assert_eq!(frame.textures[1].format, HapTextureFormat::Bc4);
        assert_eq!(frame.textures[1].data, alpha);

        let wrong = [
            encode(0xAB, &blocks(HapTextureFormat::Bc1, 8, 8, 0)),
            encode(0xA1, &alpha),
        ]
        .concat();
        assert!(decode_frame(&encode(MULTIPLE_IMAGES, &wrong)).is_err());
    }

    #[test]
    fn long_headers_and_bad_input() {
        let raw = blocks(HapTextureFormat::Bc4, 4, 4, 0);
        let mut long = vec![0, 0, 0, 0xA1];
        long.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        long.extend_from_slice(&raw);
        assert_eq!(
            decode_frame(&long).expect("long header").textures[0].data,
            raw
        );

        assert!(decode_frame(&[]).is_err());
        assert!(decode_frame(&[0x10, 0, 0, 0xAB, 1, 2]).is_err());
        assert!(decode_frame(&encode(0xA2, &[0; 16])).is_err());
        assert!(decode_frame(&encode(0xBB, &[0xFF, 0xFF, 0xFF])).is_err());
        assert!(is_hap_codec(b"HapY"));
        assert!(!is_hap_codec(b"avc1"));
    }

    #[test]
    fn plays_a_hap_movie_frame_by_frame() {
        // Three 8×8 Hap Q frames, Snappy-compressed, in a 25 fps QuickTime file.
        let raws: Vec<Vec<u8>> = (0..3)
            .map(|seed| blocks(HapTextureFormat::Bc3YCoCg, 8, 8, seed * 40))
            .collect();
        let samples: Vec<Vec<u8>> = raws
            .iter()
            .map(|raw| encode(0xBF, &compress(raw)))
            .collect();
        let movie = crate::mov::fixture::movie(b"HapY", 8, 8, 25, 1, &samples);
        let path = std::env::temp_dir().join(format!("lumen-hap-{}.mov", std::process::id()));
        std::fs::write(&path, &movie).expect("write movie");

        let track = crate::mov::MovVideoTrack::open(&path).expect("track");
        assert!(is_hap_codec(&track.codec));
        let mut file = std::fs::File::open(&path).expect("open");
        for (time_ms, expected) in [(0u64, 0usize), (40, 1), (79, 1), (80, 2)] {
            let index = track.sample_index_at_ms(time_ms);
            assert_eq!(index, expected, "frame at {time_ms} ms");
            let frame =
                decode_frame(&track.read_sample(&mut file, index).expect("sample")).expect("frame");
            validate_frame(&frame, track.width, track.height).expect("size");
            assert_eq!(frame.textures[0].data, raws[expected]);
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn block_sizes_round_up_to_whole_blocks() {
        assert_eq!(HapTextureFormat::Bc1.data_len(1920, 1080), 480 * 270 * 8);
        assert_eq!(HapTextureFormat::Bc3.data_len(5, 5), 4 * 16);
    }
}
