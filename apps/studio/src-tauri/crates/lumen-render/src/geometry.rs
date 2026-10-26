//! Pure geometry, fit and transition math. No wgpu and no font shaping lives here.

use crate::{Frame, LayerFit};

/// A rectangle in target pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl FrameRect {
    pub fn from_frame(frame: Frame, width: f32, height: f32) -> Self {
        Self {
            x: frame.x as f32 * width,
            y: frame.y as f32 * height,
            w: frame.w as f32 * width,
            h: frame.h as f32 * height,
        }
    }

    pub fn center(self) -> (f32, f32) {
        (self.x + self.w * 0.5, self.y + self.h * 0.5)
    }
}

/// Texture coordinates for a fitted frame quad.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UvRect {
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
    /// True when pixels outside the sampled image must be discarded (contain/cover letterbox).
    pub discard_outside: bool,
}

/// Computes UVs for `cover`, `contain` and `stretch`. Pixels outside the image are marked for
/// discard so a clamped sampler never smears edge texels into a letterbox.
pub fn fit_uv(
    fit: LayerFit,
    frame_w: f32,
    frame_h: f32,
    intrinsic_w: f32,
    intrinsic_h: f32,
) -> UvRect {
    if frame_w <= 0.0
        || frame_h <= 0.0
        || intrinsic_w <= 0.0
        || intrinsic_h <= 0.0
        || fit == LayerFit::Stretch
    {
        return UvRect {
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            discard_outside: false,
        };
    }

    let scale_x = frame_w / intrinsic_w;
    let scale_y = frame_h / intrinsic_h;
    let scale = match fit {
        LayerFit::Cover => scale_x.max(scale_y),
        LayerFit::Contain => scale_x.min(scale_y),
        LayerFit::Stretch => 1.0,
    };
    let draw_w = intrinsic_w * scale;
    let draw_h = intrinsic_h * scale;
    let offset_x = (frame_w - draw_w) * 0.5;
    let offset_y = (frame_h - draw_h) * 0.5;

    UvRect {
        u0: -offset_x / draw_w,
        v0: -offset_y / draw_h,
        u1: (frame_w - offset_x) / draw_w,
        v1: (frame_h - offset_y) / draw_h,
        discard_outside: true,
    }
}

/// Rotates a point around a center by `angle_degrees` clockwise in screen space.
pub fn rotate_point(x: f32, y: f32, cx: f32, cy: f32, angle_degrees: f32) -> (f32, f32) {
    if angle_degrees == 0.0 {
        return (x, y);
    }
    let radians = angle_degrees.to_radians();
    let (sin, cos) = radians.sin_cos();
    let dx = x - cx;
    let dy = y - cy;
    (cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
}

/// Axis-aligned bounds of a possibly rotated frame, in normalized slide coordinates.
pub fn rotated_bounds(frame: Frame, width: f32, height: f32) -> Frame {
    if frame.rotation == 0.0 || width <= 0.0 || height <= 0.0 {
        return frame;
    }
    let rect = FrameRect::from_frame(frame, width, height);
    let (cx, cy) = rect.center();
    let corners = [
        (rect.x, rect.y),
        (rect.x + rect.w, rect.y),
        (rect.x + rect.w, rect.y + rect.h),
        (rect.x, rect.y + rect.h),
    ];
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for (x, y) in corners {
        let (x, y) = rotate_point(x, y, cx, cy, frame.rotation as f32);
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    Frame {
        x: f64::from(min_x / width),
        y: f64::from(min_y / height),
        w: f64::from((max_x - min_x) / width),
        h: f64::from((max_y - min_y) / height),
        rotation: 0.0,
    }
}

/// Normalizes and eases a transition progress value.
pub fn easing_progress(easing: &str, progress: f64) -> f64 {
    let t = progress.clamp(0.0, 1.0);
    let normalized = easing
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "easein" | "easeincubic" => t * t * t,
        "easeout" | "easeoutcubic" => {
            let inverse = 1.0 - t;
            1.0 - inverse * inverse * inverse
        }
        "easeinout" | "easeinoutcubic" | "ease" => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                let inverse = -2.0 * t + 2.0;
                1.0 - inverse * inverse * inverse / 2.0
            }
        }
        _ => t,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Frame {
        Frame {
            x: 0.25,
            y: 0.25,
            w: 0.5,
            h: 0.5,
            rotation: 0.0,
        }
    }

    #[test]
    fn stretches_when_intrinsic_size_is_missing() {
        let uv = fit_uv(LayerFit::Cover, 100.0, 100.0, 0.0, 10.0);
        assert_eq!(uv.u0, 0.0);
        assert_eq!(uv.v1, 1.0);
        assert!(!uv.discard_outside);
    }

    #[test]
    fn cover_crops_and_stretch_does_not() {
        let cover = fit_uv(LayerFit::Cover, 100.0, 50.0, 100.0, 100.0);
        assert!((cover.u0 - 0.0).abs() < 1e-6);
        assert!((cover.v0 - 0.25).abs() < 1e-6);
        assert!((cover.v1 - 0.75).abs() < 1e-6);
        assert!(cover.discard_outside);

        let stretch = fit_uv(LayerFit::Stretch, 100.0, 50.0, 100.0, 100.0);
        assert_eq!(stretch.v1, 1.0);
        assert!(!stretch.discard_outside);
    }

    #[test]
    fn contain_letterboxes_inside_the_frame() {
        let contain = fit_uv(LayerFit::Contain, 100.0, 50.0, 100.0, 100.0);
        assert!((contain.v0 - -0.5).abs() < 1e-6);
        assert!((contain.v1 - 1.5).abs() < 1e-6);
        assert!(contain.discard_outside);
    }

    #[test]
    fn unrotated_bounds_are_the_frame() {
        assert_eq!(rotated_bounds(frame(), 1920.0, 1080.0), frame());
    }

    #[test]
    fn rotated_bounds_cover_the_rotated_corners() {
        let rotated = Frame {
            rotation: 90.0,
            ..frame()
        };
        let bounds = rotated_bounds(rotated, 100.0, 100.0);
        assert!((bounds.x - 0.25).abs() < 1e-5);
        assert!((bounds.w - 0.5).abs() < 1e-4);
        assert!((bounds.h - 0.5).abs() < 1e-4);
    }

    #[test]
    fn easing_is_clamped_and_monotonic() {
        assert_eq!(easing_progress("linear", -1.0), 0.0);
        assert_eq!(easing_progress("linear", 2.0), 1.0);
        assert!((easing_progress("easeInOut", 0.5) - 0.5).abs() < 1e-6);
        assert!(easing_progress("easeIn", 0.25) < 0.25);
        assert!(easing_progress("easeOut", 0.25) > 0.25);
        assert_eq!(easing_progress("unknown", 0.3), 0.3);
    }

    #[test]
    fn rotation_moves_points_around_the_center() {
        let (x, y) = rotate_point(10.0, 0.0, 0.0, 0.0, 90.0);
        assert!(x.abs() < 1e-5);
        assert!((y - 10.0).abs() < 1e-5);
    }
}
