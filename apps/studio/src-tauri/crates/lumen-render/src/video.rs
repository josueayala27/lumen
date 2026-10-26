//! Video frames as the renderer receives them.
//!
//! Frames are reference counted so one decoded frame reaches every output and
//! the preview without copying. Block-compressed frames (Hap) upload to the GPU
//! as-is when the device supports BC textures; otherwise `bc` decodes them on
//! the CPU first.

use std::sync::Arc;

/// Pixel payload of one video frame.
#[derive(Debug, Clone)]
pub enum VideoPixels {
    /// Tightly packed sRGB RGBA, `width * height * 4` bytes.
    Rgba(Arc<[u8]>),
    /// Opaque RGB DXT1 (Hap). Index-3 transparency is ignored.
    Bc1(Arc<[u8]>),
    /// RGBA DXT5 (Hap Alpha).
    Bc3(Arc<[u8]>),
    /// Scaled YCoCg DXT5 (Hap Q).
    Bc3YCoCg(Arc<[u8]>),
    /// Scaled YCoCg DXT5 plus RGTC1 alpha (Hap Q Alpha).
    Bc3YCoCgAlpha { color: Arc<[u8]>, alpha: Arc<[u8]> },
    /// RGTC1 single channel (Hap Alpha-Only), shown as greyscale.
    Bc4(Arc<[u8]>),
    /// RGBA BPTC (Hap R).
    Bc7(Arc<[u8]>),
}

/// One decoded frame for a video asset.
#[derive(Debug, Clone)]
pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    pub pixels: VideoPixels,
}

impl VideoFrame {
    pub fn rgba(width: u32, height: u32, rgba: Vec<u8>) -> Self {
        Self {
            width,
            height,
            pixels: VideoPixels::Rgba(Arc::from(rgba)),
        }
    }

    /// True when the payload is block compressed.
    pub fn is_compressed(&self) -> bool {
        !matches!(self.pixels, VideoPixels::Rgba(_))
    }
}

/// Bytes needed for a BC image with `block_bytes` per 4×4 block.
pub(crate) fn bc_len(width: u32, height: u32, block_bytes: usize) -> usize {
    width.div_ceil(4) as usize * height.div_ceil(4) as usize * block_bytes
}
