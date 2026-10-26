//! CPU decode of BC1/BC3/BC4 blocks and Scaled YCoCg, used when the GPU has
//! no BC texture support and for Hap Q Alpha, whose two planes are merged here.
//! Output is tightly packed RGBA at the frame's real size.

fn rgb565(value: u16) -> [u8; 3] {
    let r = ((value >> 11) & 0x1F) as u32;
    let g = ((value >> 5) & 0x3F) as u32;
    let b = (value & 0x1F) as u32;
    [
        ((r * 527 + 23) >> 6) as u8,
        ((g * 259 + 33) >> 6) as u8,
        ((b * 527 + 23) >> 6) as u8,
    ]
}

/// Colour endpoints and indices of a BC1 block. `four_colour` forces the
/// four-colour palette, as BC3 colour blocks always use it.
fn colour_block(block: &[u8], four_colour: bool) -> [[u8; 4]; 16] {
    let c0 = u16::from_le_bytes([block[0], block[1]]);
    let c1 = u16::from_le_bytes([block[2], block[3]]);
    let a = rgb565(c0);
    let b = rgb565(c1);
    let mix = |wa: u32, wb: u32, total: u32| -> [u8; 4] {
        [
            ((a[0] as u32 * wa + b[0] as u32 * wb) / total) as u8,
            ((a[1] as u32 * wa + b[1] as u32 * wb) / total) as u8,
            ((a[2] as u32 * wa + b[2] as u32 * wb) / total) as u8,
            255,
        ]
    };
    let palette = if four_colour || c0 > c1 {
        [
            [a[0], a[1], a[2], 255],
            [b[0], b[1], b[2], 255],
            mix(2, 1, 3),
            mix(1, 2, 3),
        ]
    } else {
        [
            [a[0], a[1], a[2], 255],
            [b[0], b[1], b[2], 255],
            mix(1, 1, 2),
            [0, 0, 0, 0],
        ]
    };
    let indices = u32::from_le_bytes([block[4], block[5], block[6], block[7]]);
    let mut out = [[0u8; 4]; 16];
    for (texel, pixel) in out.iter_mut().enumerate() {
        *pixel = palette[((indices >> (texel * 2)) & 3) as usize];
    }
    out
}

/// One RGTC1/BC4 (or BC3 alpha) block.
fn single_channel_block(block: &[u8]) -> [u8; 16] {
    let a0 = block[0] as u32;
    let a1 = block[1] as u32;
    let mut palette = [0u8; 8];
    palette[0] = a0 as u8;
    palette[1] = a1 as u8;
    if a0 > a1 {
        for step in 1..7u32 {
            palette[step as usize + 1] = (((7 - step) * a0 + step * a1) / 7) as u8;
        }
    } else {
        for step in 1..5u32 {
            palette[step as usize + 1] = (((5 - step) * a0 + step * a1) / 5) as u8;
        }
        palette[6] = 0;
        palette[7] = 255;
    }
    let mut bits = 0u64;
    for (index, byte) in block[2..8].iter().enumerate() {
        bits |= u64::from(*byte) << (8 * index);
    }
    let mut out = [0u8; 16];
    for (texel, value) in out.iter_mut().enumerate() {
        *value = palette[((bits >> (texel * 3)) & 7) as usize];
    }
    out
}

/// Walks blocks in raster order and writes 4×4 texels clipped to the image.
fn for_each_block<F>(
    width: u32,
    height: u32,
    block_bytes: usize,
    data: &[u8],
    out: &mut [u8],
    mut write: F,
) where
    F: FnMut(&[u8], &mut [[u8; 4]; 16]),
{
    let blocks_x = width.div_ceil(4) as usize;
    let blocks_y = height.div_ceil(4) as usize;
    let width = width as usize;
    let height = height as usize;
    for by in 0..blocks_y {
        for bx in 0..blocks_x {
            let start = (by * blocks_x + bx) * block_bytes;
            let Some(block) = data.get(start..start + block_bytes) else {
                return;
            };
            let mut texels = [[0u8; 4]; 16];
            write(block, &mut texels);
            for ty in 0..4 {
                let y = by * 4 + ty;
                if y >= height {
                    break;
                }
                for tx in 0..4 {
                    let x = bx * 4 + tx;
                    if x >= width {
                        break;
                    }
                    let offset = (y * width + x) * 4;
                    out[offset..offset + 4].copy_from_slice(&texels[ty * 4 + tx]);
                }
            }
        }
    }
}

fn image(width: u32, height: u32) -> Vec<u8> {
    vec![0u8; width as usize * height as usize * 4]
}

/// Opaque RGB DXT1.
pub fn decode_bc1(width: u32, height: u32, data: &[u8]) -> Vec<u8> {
    let mut out = image(width, height);
    for_each_block(width, height, 8, data, &mut out, |block, texels| {
        *texels = colour_block(block, false);
        for texel in texels.iter_mut() {
            texel[3] = 255;
        }
    });
    out
}

/// RGBA DXT5.
pub fn decode_bc3(width: u32, height: u32, data: &[u8]) -> Vec<u8> {
    let mut out = image(width, height);
    for_each_block(width, height, 16, data, &mut out, |block, texels| {
        let alpha = single_channel_block(&block[0..8]);
        *texels = colour_block(&block[8..16], true);
        for (texel, value) in texels.iter_mut().zip(alpha) {
            texel[3] = value;
        }
    });
    out
}

/// RGTC1 as greyscale with full alpha.
pub fn decode_bc4(width: u32, height: u32, data: &[u8]) -> Vec<u8> {
    let mut out = image(width, height);
    for_each_block(width, height, 8, data, &mut out, |block, texels| {
        for (texel, value) in texels.iter_mut().zip(single_channel_block(block)) {
            *texel = [value, value, value, 255];
        }
    });
    out
}

/// Converts Scaled YCoCg texels (Co, Cg, scale, Y in R, G, B, A) to RGB with full alpha.
/// Follows van Waveren and Castaño, "Real-Time YCoCg-DXT Compression" (2007).
pub fn ycocg_to_rgba(pixels: &mut [u8]) {
    const OFFSET: f32 = 128.0 / 255.0;
    for texel in pixels.as_chunks_mut::<4>().0 {
        let co = texel[0] as f32 / 255.0 - OFFSET;
        let cg = texel[1] as f32 / 255.0 - OFFSET;
        let scale = texel[2] as f32 / 255.0 * (255.0 / 8.0) + 1.0;
        let y = texel[3] as f32 / 255.0;
        let co = co / scale;
        let cg = cg / scale;
        let to_byte = |value: f32| (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        texel[0] = to_byte(y + co - cg);
        texel[1] = to_byte(y + cg);
        texel[2] = to_byte(y - co - cg);
        texel[3] = 255;
    }
}

/// Scaled YCoCg DXT5, optionally with an RGTC1 alpha plane.
pub fn decode_ycocg(width: u32, height: u32, color: &[u8], alpha: Option<&[u8]>) -> Vec<u8> {
    let mut out = decode_bc3(width, height, color);
    ycocg_to_rgba(&mut out);
    if let Some(alpha) = alpha {
        let matte = decode_bc4(width, height, alpha);
        for (texel, matte) in out
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(matte.as_chunks::<4>().0)
        {
            texel[3] = matte[0];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bc1_solid_block_and_clipping() {
        // c0 = c1 = pure red (0xF800), all indices 0.
        let block = [0x00, 0xF8, 0x00, 0xF8, 0, 0, 0, 0];
        let pixels = decode_bc1(3, 2, &block);
        assert_eq!(pixels.len(), 3 * 2 * 4);
        assert!(pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|texel| texel == &[255, 0, 0, 255]));
    }

    #[test]
    fn bc1_three_colour_mode_stays_opaque() {
        // c0 < c1 selects the three-colour palette; index 3 would be transparent black.
        let block = [0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
        let pixels = decode_bc1(4, 4, &block);
        assert!(pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|texel| texel == [0, 0, 0, 255]));
    }

    #[test]
    fn bc3_alpha_interpolates() {
        let mut block = [0u8; 16];
        block[0] = 255;
        block[1] = 0;
        // Texel 0 uses alpha index 1 (value 0); the rest index 0 (255).
        block[2] = 0b001;
        block[8..10].copy_from_slice(&0xFFFFu16.to_le_bytes());
        block[10..12].copy_from_slice(&0xFFFFu16.to_le_bytes());
        let pixels = decode_bc3(4, 4, &block);
        assert_eq!(&pixels[0..4], &[255, 255, 255, 0]);
        assert_eq!(&pixels[4..8], &[255, 255, 255, 255]);
    }

    #[test]
    fn bc4_six_value_mode_has_extremes() {
        let mut block = [0u8; 8];
        block[0] = 10;
        block[1] = 200;
        // Texel 0 index 6 → 0, texel 1 index 7 → 255.
        block[2] = 0b111_110;
        let pixels = decode_bc4(4, 4, &block);
        assert_eq!(pixels[0], 0);
        assert_eq!(pixels[4], 255);
        assert_eq!(pixels[8], 10);
    }

    #[test]
    fn ycocg_neutral_grey_round_trips() {
        // Co = Cg = 0.5 (128), scale byte 0, Y = 0.5 → mid grey.
        let mut texel = [128, 128, 0, 128];
        ycocg_to_rgba(&mut texel);
        assert!(texel[..3].iter().all(|channel| channel.abs_diff(128) <= 1));
        assert_eq!(texel[3], 255);
    }

    #[test]
    fn short_data_leaves_the_rest_black() {
        let pixels = decode_bc1(8, 4, &[0x00, 0xF8, 0x00, 0xF8, 0, 0, 0, 0]);
        assert_eq!(&pixels[0..4], &[255, 0, 0, 255]);
        assert_eq!(&pixels[16..20], &[0, 0, 0, 0]);
    }
}
