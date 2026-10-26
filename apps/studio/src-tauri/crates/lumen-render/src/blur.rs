//! Separable box blur used for text shadow rasterization.
//!
//! Three box passes approximate a Gaussian closely enough for drop shadows while staying O(pixels)
//! per pass. This runs on the CPU only when a scene revision contains a blurred shadow.

const BOX_PASSES: f64 = 3.0;
const MAX_BOX_RADIUS: u32 = 256;

/// Converts a Gaussian sigma in pixels to the box radius for [`BOX_PASSES`] separable passes.
pub(crate) fn box_radius_for_sigma(sigma: f64) -> u32 {
    if !sigma.is_finite() || sigma <= 0.0 {
        return 0;
    }
    let radius = ((12.0 * sigma * sigma / BOX_PASSES + 1.0).sqrt() - 1.0) / 2.0;
    (radius.round() as u32).min(MAX_BOX_RADIUS)
}

/// Blurs an RGBA buffer with [`BOX_PASSES`] horizontal and vertical box passes.
pub(crate) fn blur_rgba(pixels: &[u8], width: u32, height: u32, radius: u32) -> Vec<u8> {
    if width == 0 || height == 0 || radius == 0 {
        return pixels.to_vec();
    }
    let expected = width as usize * height as usize * 4;
    if pixels.len() < expected {
        return Vec::new();
    }
    let mut current = pixels[..expected].to_vec();
    let mut scratch = vec![0; expected];
    for _ in 0..BOX_PASSES as u32 {
        box_pass(&current, &mut scratch, width, height, radius, true);
        box_pass(&scratch, &mut current, width, height, radius, false);
    }
    current
}

fn box_pass(src: &[u8], dst: &mut [u8], width: u32, height: u32, radius: u32, horizontal: bool) {
    let count = radius as usize * 2 + 1;
    let width = width as usize;
    let height = height as usize;
    if horizontal {
        for row in 0..height {
            let base = row * width * 4;
            slide_line(
                &src[base..base + width * 4],
                &mut dst[base..base + width * 4],
                count,
            );
        }
    } else {
        let mut line = Vec::with_capacity(height * 4);
        let mut blurred = vec![0u8; height * 4];
        for column in 0..width {
            line.clear();
            for row in 0..height {
                let index = (row * width + column) * 4;
                line.extend_from_slice(&src[index..index + 4]);
            }
            slide_line(&line, &mut blurred, count);
            for row in 0..height {
                let index = (row * width + column) * 4;
                dst[index..index + 4].copy_from_slice(&blurred[row * 4..row * 4 + 4]);
            }
        }
    }
}

/// Sliding-window average over one RGBA line, with edge clamping.
fn slide_line(src: &[u8], dst: &mut [u8], count: usize) {
    let pixels = src.len() / 4;
    if pixels == 0 {
        return;
    }
    let radius = (count - 1) / 2;
    let mut sums = [0u32; 4];
    for offset in -(radius as isize)..=(radius as isize) {
        let index = offset.clamp(0, pixels as isize - 1) as usize;
        for (channel, sum) in sums.iter_mut().enumerate() {
            *sum += u32::from(src[index * 4 + channel]);
        }
    }
    for index in 0..pixels {
        for (channel, sum) in sums.iter_mut().enumerate() {
            dst[index * 4 + channel] = ((*sum + count as u32 / 2) / count as u32) as u8;
        }
        if index + 1 < pixels {
            let entering = (index + 1 + radius).min(pixels - 1);
            let leaving = index.saturating_sub(radius);
            for (channel, sum) in sums.iter_mut().enumerate() {
                *sum = sum
                    .saturating_add(u32::from(src[entering * 4 + channel]))
                    .saturating_sub(u32::from(src[leaving * 4 + channel]));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_radius_leaves_pixels_unchanged() {
        let pixels = vec![10, 20, 30, 40, 50, 60, 70, 80];
        assert_eq!(blur_rgba(&pixels, 2, 1, 0), pixels);
        assert_eq!(box_radius_for_sigma(0.0), 0);
        assert_eq!(box_radius_for_sigma(f64::NAN), 0);
    }

    #[test]
    fn radius_grows_with_sigma() {
        assert!(box_radius_for_sigma(1.0) >= 1);
        assert!(box_radius_for_sigma(8.0) > box_radius_for_sigma(2.0));
        assert!(box_radius_for_sigma(10_000.0) <= MAX_BOX_RADIUS);
    }

    #[test]
    fn constant_color_is_unchanged() {
        let pixels = vec![200u8; 16 * 16 * 4];
        let blurred = blur_rgba(&pixels, 16, 16, 3);
        assert!(blurred.iter().all(|byte| *byte == 200));
    }

    #[test]
    fn impulse_spreads_without_wrapping() {
        let width = 15;
        let height = 15;
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        let center = ((7 * width + 7) * 4) as usize;
        pixels[center..center + 4].copy_from_slice(&[255, 255, 255, 255]);
        let blurred = blur_rgba(&pixels, width, height, 2);
        let alpha = |x: i32, y: i32| blurred[((y * width as i32 + x) * 4 + 3) as usize];
        assert!(alpha(7, 7) < 255);
        assert!(alpha(7, 7) > 0);
        assert!(alpha(6, 7) > 0);
        assert_eq!(alpha(0, 0), 0);
    }

    #[test]
    fn short_buffer_is_rejected() {
        assert!(blur_rgba(&[0; 4], 4, 4, 1).is_empty());
    }
}
