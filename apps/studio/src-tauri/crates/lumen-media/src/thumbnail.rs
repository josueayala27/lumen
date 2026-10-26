//! Image thumbnail generation. Video posters need a decoder backend, so this
//! module only handles still images.

use std::io::Cursor;

use crate::MediaError;

pub const DEFAULT_THUMBNAIL_EDGE: u32 = 320;
const MIN_THUMBNAIL_EDGE: u32 = 16;
const MAX_THUMBNAIL_EDGE: u32 = 1024;

/// Decodes an image and returns a PNG thumbnail no larger than `max_edge`.
pub fn thumbnail_bytes(data: &[u8], max_edge: u32) -> Result<Vec<u8>, MediaError> {
    let edge = max_edge.clamp(MIN_THUMBNAIL_EDGE, MAX_THUMBNAIL_EDGE);
    let image =
        image::load_from_memory(data).map_err(|error| MediaError::Decode(error.to_string()))?;
    let thumbnail = if image.width() <= edge && image.height() <= edge {
        image
    } else {
        image.thumbnail(edge, edge)
    };
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| MediaError::Decode(error.to_string()))?;
    Ok(output.into_inner())
}

pub fn thumbnail_file(path: &str, max_edge: u32) -> Result<Vec<u8>, MediaError> {
    let data = std::fs::read(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => MediaError::Missing(path.to_string()),
        _ => MediaError::Decode(error.to_string()),
    })?;
    thumbnail_bytes(&data, max_edge)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnail_keeps_aspect_and_returns_png() {
        let source = image::DynamicImage::new_rgba8(800, 400);
        let mut encoded = Cursor::new(Vec::new());
        source
            .write_to(&mut encoded, image::ImageFormat::Png)
            .expect("encode source");
        let thumbnail = thumbnail_bytes(encoded.get_ref(), 200).expect("thumbnail");
        assert!(thumbnail.starts_with(&[0x89, 0x50, 0x4E, 0x47]));
        let decoded = image::load_from_memory(&thumbnail).expect("decode thumbnail");
        assert_eq!((decoded.width(), decoded.height()), (200, 100));
    }
}
