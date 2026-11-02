//! Pure layout and mapping maths for the per-screen stage. No wgpu here.
//!
//! Layer filters, screen grouping, region crop, text preset re-layout, corner-pin homography,
//! mesh interpolation, warp grids and the edge-blend ramp. The WGSL passes in `compositor.wgsl`
//! use the same formulas.

use crate::composition::{
    CompositionLayer, EdgeBlend, LayerFilter, LayerTransform, Layout, LayoutText, Mapping, Mesh,
    Point, Region, Screen, Size, TextPreset,
};
use crate::Layer as SlideElement;

/// Largest render target edge; matches the wgpu default limit.
pub const MAX_TARGET_EDGE: u32 = 8192;

/// Whether a layout draws a layer: every layer, or a matching id or tag.
pub fn layer_matches(filter: &LayerFilter, layer: &CompositionLayer) -> bool {
    match filter {
        LayerFilter::All => true,
        LayerFilter::Only { ids, tags } => {
            ids.contains(&layer.id) || layer.tags.iter().any(|tag| tags.contains(tag))
        }
    }
}

/// Text settings a layout applies to slide sources; `full` at 1× when unset.
pub fn resolve_text(layout: &Layout) -> LayoutText {
    layout.text.clone().unwrap_or_default()
}

/// What makes two screens share one canvas render: the layer filter, the text override and,
/// for presets placed in output space, the region.
#[derive(Debug, Clone, PartialEq)]
pub struct CanvasKey {
    pub filter: LayerFilter,
    pub text: LayoutText,
    pub region: Option<Region>,
}

impl CanvasKey {
    pub fn for_layout(layout: &Layout) -> Self {
        let text = resolve_text(layout);
        let region = matches!(text.preset, TextPreset::LowerThird | TextPreset::Strip)
            .then_some(layout.region);
        Self {
            filter: layout.layers.clone(),
            text,
            region,
        }
    }
}

/// Groups enabled screens that can share one canvas render. Returns screen indices per group,
/// in first-seen order.
pub fn group_screens(screens: &[Screen]) -> Vec<(CanvasKey, Vec<usize>)> {
    let mut groups: Vec<(CanvasKey, Vec<usize>)> = Vec::new();
    for (index, screen) in screens.iter().enumerate() {
        if !screen.enabled {
            continue;
        }
        let key = CanvasKey::for_layout(&screen.layout);
        match groups.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, members)) => members.push(index),
            None => groups.push((key, vec![index])),
        }
    }
    groups
}

/// Canvas pixels to render so `region` fills an `out_w × out_h` output without upscaling,
/// clamped to [`MAX_TARGET_EDGE`].
pub fn canvas_render_size(canvas: Size, region: Region, out_w: u32, out_h: u32) -> (u32, u32) {
    let canvas_w = canvas.width.max(1.0);
    let canvas_h = canvas.height.max(1.0);
    let region_w = region.w.max(1e-6);
    let region_h = region.h.max(1e-6);
    let scale = (f64::from(out_w) / (canvas_w * region_w))
        .max(f64::from(out_h) / (canvas_h * region_h))
        .max(1e-3);
    let mut width = canvas_w * scale;
    let mut height = canvas_h * scale;
    let edge = width.max(height);
    if edge > f64::from(MAX_TARGET_EDGE) {
        let shrink = f64::from(MAX_TARGET_EDGE) / edge;
        width *= shrink;
        height *= shrink;
    }
    (
        (width.round() as u32).clamp(1, MAX_TARGET_EDGE),
        (height.round() as u32).clamp(1, MAX_TARGET_EDGE),
    )
}

/// Canvas UV for a point `(u, v)` of a screen showing `region`.
pub fn region_uv(region: Region, u: f64, v: f64) -> (f64, f64) {
    (region.x + u * region.w, region.y + v * region.h)
}

/// Maps a canvas-normalized rectangle into a region's normalized space.
pub fn rect_in_region(region: Region, x: f64, y: f64, w: f64, h: f64) -> (f64, f64, f64, f64) {
    (
        (x - region.x) / region.w,
        (y - region.y) / region.h,
        w / region.w,
        h / region.h,
    )
}

/// Canvas-normalized point to the layer's own `0..1` box, undoing rotation around the anchor.
/// `aspect` is canvas width over height, so rotation is in square pixels.
pub fn canvas_to_layer(transform: &LayerTransform, aspect: f64, x: f64, y: f64) -> (f64, f64) {
    let pivot_x = transform.x + transform.anchor_x * transform.w;
    let pivot_y = transform.y + transform.anchor_y * transform.h;
    let dx = (x - pivot_x) * aspect;
    let dy = y - pivot_y;
    let (sin, cos) = (-transform.rotation).to_radians().sin_cos();
    let rx = (dx * cos - dy * sin) / aspect;
    let ry = dx * sin + dy * cos;
    let w = if transform.w.abs() < 1e-9 { 1e-9 } else { transform.w };
    let h = if transform.h.abs() < 1e-9 { 1e-9 } else { transform.h };
    ((pivot_x + rx - transform.x) / w, (pivot_y + ry - transform.y) / h)
}

/// Output-space frames for re-laid-out text, per preset. Same values as the TS adapter.
const LOWER_THIRD: (f64, f64, f64, f64) = (0.06, 0.74, 0.88, 0.2);
const STRIP: (f64, f64, f64, f64) = (0.02, 0.88, 0.96, 0.1);

/// Slide elements as one screen shows them: the layout's text preset, scale and colour applied,
/// matching `restyleText` in packages/core/src/compositionScene.ts. Elements stay in slide space;
/// preset frames are output-space and are mapped back through the region and the layer box.
pub fn slide_elements_for_layout(
    elements: &[SlideElement],
    transform: &LayerTransform,
    canvas: Size,
    slide_size: Size,
    text: &LayoutText,
    region: Region,
) -> Vec<SlideElement> {
    // Slide pixels to canvas pixels; the TS adapter scales fonts by this factor.
    let font_scale = (transform.h * canvas.height / slide_size.height.max(1.0)).max(1e-6);
    let to_slide = |(x, y, w, h): (f64, f64, f64, f64)| {
        let (cx, cy) = region_uv(region, x, y);
        let box_w = if transform.w.abs() < 1e-9 { 1e-9 } else { transform.w };
        let box_h = if transform.h.abs() < 1e-9 { 1e-9 } else { transform.h };
        crate::Frame {
            x: (cx - transform.x) / box_w,
            y: (cy - transform.y) / box_h,
            w: w * region.w / box_w,
            h: h * region.h / box_h,
            rotation: 0.0,
        }
    };
    let mut out = Vec::with_capacity(elements.len());
    for element in elements {
        let SlideElement::Text {
            frame,
            font_size,
            color,
            runs,
            max_lines,
            ..
        } = element
        else {
            out.push(element.clone());
            continue;
        };
        if text.preset == TextPreset::Hidden {
            continue;
        }
        let mut restyled = element.clone();
        let SlideElement::Text {
            frame: new_frame,
            font_size: new_size,
            color: new_color,
            runs: new_runs,
            max_lines: new_max,
            ..
        } = &mut restyled
        else {
            unreachable!("cloned a text element");
        };
        // Font size in the TS adapter's viewport pixels.
        let viewport_size = font_size * font_scale * text.scale;
        if let Some(override_color) = &text.color {
            *new_color = override_color.clone();
            *new_runs = runs
                .iter()
                .map(|run| crate::TextRun {
                    color: None,
                    ..run.clone()
                })
                .collect();
        } else {
            *new_color = color.clone();
        }
        match text.preset {
            TextPreset::LowerThird => {
                *new_frame = to_slide(LOWER_THIRD);
                *new_size = (viewport_size * 0.55).max(18.0) / font_scale;
                *new_max = Some(2);
            }
            TextPreset::Strip => {
                *new_frame = to_slide(STRIP);
                *new_size = (viewport_size * 0.4).max(14.0) / font_scale;
                *new_max = Some(1);
            }
            TextPreset::Full | TextPreset::Hidden => {
                *new_frame = *frame;
                *new_size = font_size * text.scale;
                *new_max = *max_lines;
            }
        }
        out.push(restyled);
    }
    out
}

// --- Warp --------------------------------------------------------------------

/// Projective transform from the unit square to a quad (tl, tr, br, bl), row-major 3×3.
/// Heckbert's square-to-quad mapping. Returns `None` for a degenerate quad.
pub fn homography(quad: &[Point; 4]) -> Option<[f64; 9]> {
    let [p0, p1, p2, p3] = quad;
    let sx = p0.x - p1.x + p2.x - p3.x;
    let sy = p0.y - p1.y + p2.y - p3.y;
    if sx.abs() < 1e-12 && sy.abs() < 1e-12 {
        // Parallelogram: affine.
        return Some([
            p1.x - p0.x,
            p2.x - p1.x,
            p0.x,
            p1.y - p0.y,
            p2.y - p1.y,
            p0.y,
            0.0,
            0.0,
            1.0,
        ]);
    }
    let dx1 = p1.x - p2.x;
    let dx2 = p3.x - p2.x;
    let dy1 = p1.y - p2.y;
    let dy2 = p3.y - p2.y;
    let det = dx1 * dy2 - dx2 * dy1;
    if det.abs() < 1e-12 {
        return None;
    }
    let g = (sx * dy2 - dx2 * sy) / det;
    let h = (dx1 * sy - sx * dy1) / det;
    Some([
        p1.x - p0.x + g * p1.x,
        p3.x - p0.x + h * p3.x,
        p0.x,
        p1.y - p0.y + g * p1.y,
        p3.y - p0.y + h * p3.y,
        p0.y,
        g,
        h,
        1.0,
    ])
}

/// Applies a homography to `(u, v)`.
pub fn apply_homography(matrix: &[f64; 9], u: f64, v: f64) -> (f64, f64) {
    let w = matrix[6] * u + matrix[7] * v + matrix[8];
    let w = if w.abs() < 1e-12 { 1e-12 } else { w };
    (
        (matrix[0] * u + matrix[1] * v + matrix[2]) / w,
        (matrix[3] * u + matrix[4] * v + matrix[5]) / w,
    )
}

/// Bilinear point inside a quad (tl, tr, br, bl) at `(u, v)`, as `quadPoint` in TS.
pub fn quad_point(quad: &[Point; 4], u: f64, v: f64) -> Point {
    let [tl, tr, br, bl] = quad;
    let top = (tl.x + (tr.x - tl.x) * u, tl.y + (tr.y - tl.y) * u);
    let bottom = (bl.x + (br.x - bl.x) * u, bl.y + (br.y - bl.y) * u);
    Point {
        x: top.0 + (bottom.0 - top.0) * v,
        y: top.1 + (bottom.1 - top.1) * v,
    }
}

/// Mesh point at a fractional grid position, interpolated from its cell (TS `meshPointAt`).
/// Returns `None` when the mesh has fewer points than `cols × rows`.
pub fn mesh_point(mesh: &Mesh, u: f64, v: f64) -> Option<Point> {
    let cols = mesh.cols.max(2) as usize;
    let rows = mesh.rows.max(2) as usize;
    if mesh.points.len() < cols * rows {
        return None;
    }
    let fx = u.clamp(0.0, 1.0) * (cols - 1) as f64;
    let fy = v.clamp(0.0, 1.0) * (rows - 1) as f64;
    let col = (fx.floor() as usize).min(cols - 2);
    let row = (fy.floor() as usize).min(rows - 2);
    let at = |c: usize, r: usize| mesh.points[r * cols + c];
    Some(quad_point(
        &[at(col, row), at(col + 1, row), at(col + 1, row + 1), at(col, row + 1)],
        fx - col as f64,
        fy - row as f64,
    ))
}

/// Where content point `(u, v)` lands in normalized output space. The mesh refines the corner
/// pin (its points already include the pin), so a valid mesh wins; otherwise the corner pin.
pub fn warp_point(mapping: &Mapping, homography_matrix: Option<&[f64; 9]>, u: f64, v: f64) -> Point {
    if let Some(point) = mapping.mesh.as_ref().and_then(|mesh| mesh_point(mesh, u, v)) {
        return point;
    }
    if let Some(matrix) = homography_matrix {
        let (x, y) = apply_homography(matrix, u, v);
        return Point { x, y };
    }
    Point { x: u, y: v }
}

/// One warp grid vertex: output position in normalized output space and content UV.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WarpVertex {
    pub position: [f32; 2],
    pub uv: [f32; 2],
}

/// Triangle list covering the content, warped by the corner pin and mesh. One draw call does
/// warp and mapping. `segments` subdivides each axis; an unwarped mapping uses one quad.
pub fn warp_grid(mapping: &Mapping, segments: u32) -> Vec<WarpVertex> {
    let warped = mapping.corner_pin.is_some() || mapping.mesh.is_some();
    let segments = if warped { segments.max(1) } else { 1 };
    let matrix = mapping.corner_pin.as_ref().and_then(homography);
    let mut grid = Vec::with_capacity(((segments + 1) * (segments + 1)) as usize);
    for row in 0..=segments {
        for col in 0..=segments {
            let u = f64::from(col) / f64::from(segments);
            let v = f64::from(row) / f64::from(segments);
            let point = warp_point(mapping, matrix.as_ref(), u, v);
            grid.push(WarpVertex {
                position: [point.x as f32, point.y as f32],
                uv: [u as f32, v as f32],
            });
        }
    }
    let stride = (segments + 1) as usize;
    let mut vertices = Vec::with_capacity((segments * segments * 6) as usize);
    for row in 0..segments as usize {
        for col in 0..segments as usize {
            let tl = grid[row * stride + col];
            let tr = grid[row * stride + col + 1];
            let bl = grid[(row + 1) * stride + col];
            let br = grid[(row + 1) * stride + col + 1];
            vertices.extend_from_slice(&[tl, tr, br, tl, br, bl]);
        }
    }
    vertices
}

/// Edge-blend ramp for a position `x` in `0..1` across the overlap (0 at the outer edge).
/// `power` shapes the S-curve (Bourke); the result is a linear-light multiplier, so `gamma`
/// 2.2 makes two overlapping projectors sum to one.
pub fn edge_blend_ramp(x: f64, gamma: f64, power: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    let power = power.max(1e-3);
    let curve = if x < 0.5 {
        0.5 * (2.0 * x).powf(power)
    } else {
        1.0 - 0.5 * (2.0 * (1.0 - x)).powf(power)
    };
    curve.powf(2.2 / gamma.max(1e-3))
}

/// Combined edge-blend multiplier at content point `(u, v)`.
pub fn edge_blend_factor(blend: &EdgeBlend, u: f64, v: f64) -> f64 {
    let side = |distance: f64, side: &crate::composition::EdgeBlendSide| {
        if side.width <= 0.0 {
            1.0
        } else {
            edge_blend_ramp(distance / side.width, side.gamma, side.power)
        }
    };
    side(u, &blend.left) * side(1.0 - u, &blend.right) * side(v, &blend.top) * side(1.0 - v, &blend.bottom)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composition::{EdgeBlendSide, ScreenTarget};

    fn layer(id: &str, tags: &[&str]) -> CompositionLayer {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": id, "transform": {}, "tags": tags
        }))
        .expect("layer")
    }

    fn screen(filter: LayerFilter, text: Option<LayoutText>, region: Region) -> Screen {
        let mut screen = Screen::canvas(Size {
            width: 1920.0,
            height: 1080.0,
        });
        screen.target = ScreenTarget::Virtual;
        screen.layout.layers = filter;
        screen.layout.text = text;
        screen.layout.region = region;
        screen
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn filters_layers_by_id_or_tag() {
        let lyrics = layer("l1", &["lyrics"]);
        let video = layer("l2", &["visuals"]);
        assert!(layer_matches(&LayerFilter::All, &lyrics));
        let only = LayerFilter::Only {
            ids: vec!["l2".into()],
            tags: vec!["lyrics".into()],
        };
        assert!(layer_matches(&only, &lyrics));
        assert!(layer_matches(&only, &video));
        let none = LayerFilter::Only {
            ids: vec![],
            tags: vec!["other".into()],
        };
        assert!(!layer_matches(&none, &lyrics));
    }

    #[test]
    fn groups_screens_by_filter_and_text() {
        let lower = LayoutText {
            preset: TextPreset::LowerThird,
            ..LayoutText::default()
        };
        let left = Region {
            x: 0.0,
            y: 0.0,
            w: 0.5,
            h: 1.0,
        };
        let right = Region { x: 0.5, ..left };
        let mut disabled = screen(LayerFilter::All, None, Region::FULL);
        disabled.enabled = false;
        let screens = vec![
            screen(LayerFilter::All, None, left),
            // Unset text equals `full` at 1×, so this shares the first canvas.
            screen(LayerFilter::All, Some(LayoutText::default()), right),
            screen(LayerFilter::All, Some(lower.clone()), left),
            // Output-space presets depend on the region.
            screen(LayerFilter::All, Some(lower), right),
            disabled,
        ];
        let groups: Vec<Vec<usize>> = group_screens(&screens)
            .into_iter()
            .map(|(_, members)| members)
            .collect();
        assert_eq!(groups, vec![vec![0, 1], vec![2], vec![3]]);
    }

    #[test]
    fn sizes_the_canvas_so_the_region_fills_the_output() {
        let canvas = Size {
            width: 3840.0,
            height: 1080.0,
        };
        let half = Region {
            x: 0.5,
            y: 0.0,
            w: 0.5,
            h: 1.0,
        };
        assert_eq!(canvas_render_size(canvas, half, 1920, 1080), (3840, 1080));
        assert_eq!(canvas_render_size(canvas, half, 960, 540), (1920, 540));
        // A full region keeps every axis at or above the output size.
        assert_eq!(canvas_render_size(canvas, Region::FULL, 1920, 1080), (3840, 1080));
        let tiny = Region {
            x: 0.0,
            y: 0.0,
            w: 0.1,
            h: 0.1,
        };
        let (w, h) = canvas_render_size(canvas, tiny, 1920, 1080);
        assert_eq!(w, MAX_TARGET_EDGE);
        assert!(h < w);
    }

    #[test]
    fn crops_regions() {
        let region = Region {
            x: 0.25,
            y: 0.5,
            w: 0.5,
            h: 0.5,
        };
        assert_eq!(region_uv(region, 0.0, 0.0), (0.25, 0.5));
        assert_eq!(region_uv(region, 1.0, 1.0), (0.75, 1.0));
        assert_eq!(rect_in_region(region, 0.25, 0.5, 0.5, 0.25), (0.0, 0.0, 1.0, 0.5));
    }

    #[test]
    fn maps_canvas_points_into_rotated_layers() {
        let transform = LayerTransform {
            x: 0.25,
            y: 0.25,
            w: 0.5,
            h: 0.5,
            rotation: 90.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
        };
        // Square canvas: the box centre stays put, corners rotate.
        let (u, v) = canvas_to_layer(&transform, 1.0, 0.5, 0.5);
        assert!(close(u, 0.5) && close(v, 0.5));
        // Clockwise 90°: the top-left corner of the box is drawn at the top-right.
        let (u, v) = canvas_to_layer(&transform, 1.0, 0.75, 0.25);
        assert!(close(u, 0.0) && close(v, 0.0), "{u},{v}");
        let unrotated = LayerTransform::default();
        let (u, v) = canvas_to_layer(&unrotated, 16.0 / 9.0, 0.3, 0.7);
        assert!(close(u, 0.3) && close(v, 0.7));
    }

    fn text_element(font_size: f64) -> SlideElement {
        serde_json::from_value(serde_json::json!({
            "kind": "text", "id": "t", "frame": { "x": 0.1, "y": 0.3, "w": 0.8, "h": 0.4 },
            "runs": [{ "text": "Hi", "color": "#ff0000" }], "fontId": "inter",
            "fontSize": font_size, "color": "#ffffff"
        }))
        .expect("text")
    }

    #[test]
    fn re_lays_out_text_like_the_typescript_adapter() {
        let shape: SlideElement = serde_json::from_value(serde_json::json!({
            "kind": "shape", "id": "s", "frame": { "x": 0, "y": 0, "w": 1, "h": 1 }, "fill": "#000"
        }))
        .expect("shape");
        let elements = vec![shape.clone(), text_element(72.0)];
        let canvas = Size {
            width: 1920.0,
            height: 1080.0,
        };
        let full = LayerTransform::default();

        let hidden = LayoutText {
            preset: TextPreset::Hidden,
            ..LayoutText::default()
        };
        let out = slide_elements_for_layout(&elements, &full, canvas, canvas, &hidden, Region::FULL);
        assert_eq!(out, vec![shape.clone()]);

        let scaled = LayoutText {
            preset: TextPreset::Full,
            scale: 1.5,
            color: Some("#00ff00".into()),
        };
        let out = slide_elements_for_layout(&elements, &full, canvas, canvas, &scaled, Region::FULL);
        match &out[1] {
            SlideElement::Text {
                font_size,
                color,
                runs,
                frame,
                ..
            } => {
                assert!(close(*font_size, 108.0));
                assert_eq!(color, "#00ff00");
                assert!(runs[0].color.is_none());
                assert!(close(frame.x, 0.1));
            }
            other => panic!("expected text, got {other:?}"),
        }

        let lower = LayoutText {
            preset: TextPreset::LowerThird,
            ..LayoutText::default()
        };
        let left = Region {
            x: 0.0,
            y: 0.0,
            w: 0.5,
            h: 1.0,
        };
        let out = slide_elements_for_layout(&elements, &full, canvas, canvas, &lower, left);
        match &out[1] {
            SlideElement::Text {
                font_size,
                frame,
                max_lines,
                runs,
                ..
            } => {
                // max(18, 72 × 0.55) in TS viewport pixels; the box is the full canvas.
                assert!(close(*font_size, 39.6));
                assert_eq!(*max_lines, Some(2));
                // Output frame 0.06..0.94 of the left half of the canvas.
                assert!(close(frame.x, 0.03) && close(frame.w, 0.44));
                assert!(close(frame.y, 0.74) && close(frame.h, 0.2));
                assert_eq!(runs[0].color.as_deref(), Some("#ff0000"));
            }
            other => panic!("expected text, got {other:?}"),
        }

        let strip = LayoutText {
            preset: TextPreset::Strip,
            ..LayoutText::default()
        };
        let out = slide_elements_for_layout(&[text_element(20.0)], &full, canvas, canvas, &strip, Region::FULL);
        match &out[0] {
            SlideElement::Text {
                font_size,
                max_lines,
                ..
            } => {
                assert!(close(*font_size, 14.0));
                assert_eq!(*max_lines, Some(1));
            }
            other => panic!("expected text, got {other:?}"),
        }
    }

    fn pin(points: [(f64, f64); 4]) -> [Point; 4] {
        points.map(|(x, y)| Point { x, y })
    }

    #[test]
    fn homography_maps_unit_square_corners_onto_the_pin() {
        let quads = [
            pin([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]),
            pin([(0.1, 0.0), (0.9, 0.1), (1.0, 0.95), (0.0, 1.0)]),
            pin([(0.2, 0.1), (0.7, 0.1), (0.7, 0.6), (0.2, 0.6)]),
        ];
        for quad in quads {
            let matrix = homography(&quad).expect("homography");
            for (index, (u, v)) in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)].iter().enumerate() {
                let (x, y) = apply_homography(&matrix, *u, *v);
                assert!(close(x, quad[index].x) && close(y, quad[index].y), "corner {index}: {x},{y}");
            }
        }
        // Perspective: the centre of a trapezoid is not its bilinear centre.
        let trapezoid = pin([(0.3, 0.0), (0.7, 0.0), (1.0, 1.0), (0.0, 1.0)]);
        let matrix = homography(&trapezoid).expect("homography");
        let (_, y) = apply_homography(&matrix, 0.5, 0.5);
        assert!(y < 0.5, "the narrow far half is compressed: {y}");
        let collapsed = pin([(0.0, 0.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0)]);
        assert!(homography(&collapsed).is_none_or(|m| m.iter().all(|v| v.is_finite())));
    }

    #[test]
    fn mesh_interpolates_cells_like_the_typescript_helper() {
        let mesh = Mesh {
            cols: 3,
            rows: 2,
            points: vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 0.5, y: 0.1 },
                Point { x: 1.0, y: 0.0 },
                Point { x: 0.0, y: 1.0 },
                Point { x: 0.5, y: 0.9 },
                Point { x: 1.0, y: 1.0 },
            ],
        };
        let centre = mesh_point(&mesh, 0.5, 0.0).expect("point");
        assert!(close(centre.x, 0.5) && close(centre.y, 0.1));
        let quarter = mesh_point(&mesh, 0.25, 0.5).expect("point");
        assert!(close(quarter.x, 0.25) && close(quarter.y, 0.5));
        let corner = mesh_point(&mesh, 1.0, 1.0).expect("point");
        assert!(close(corner.x, 1.0) && close(corner.y, 1.0));
        let broken = Mesh {
            points: vec![],
            ..mesh
        };
        assert!(mesh_point(&broken, 0.5, 0.5).is_none());
    }

    #[test]
    fn warp_grid_is_one_quad_unwarped_and_follows_the_pin() {
        let flat = warp_grid(&Mapping::default(), 16);
        assert_eq!(flat.len(), 6);
        assert_eq!(flat[0].position, [0.0, 0.0]);
        assert_eq!(flat[2].position, [1.0, 1.0]);

        let mapping = Mapping {
            corner_pin: Some(pin([(0.1, 0.0), (0.9, 0.1), (1.0, 0.95), (0.0, 1.0)])),
            ..Mapping::default()
        };
        let grid = warp_grid(&mapping, 4);
        assert_eq!(grid.len(), 4 * 4 * 6);
        let at = |u: f32, v: f32| {
            grid.iter()
                .find(|vertex| vertex.uv == [u, v])
                .expect("vertex")
                .position
        };
        assert!((at(0.0, 0.0)[0] - 0.1).abs() < 1e-5);
        assert!((at(1.0, 1.0)[1] - 0.95).abs() < 1e-5);
    }

    #[test]
    fn edge_blend_ramp_sums_to_one_across_the_overlap() {
        assert!(close(edge_blend_ramp(0.0, 2.2, 1.0), 0.0));
        assert!(close(edge_blend_ramp(1.0, 2.2, 1.0), 1.0));
        for power in [1.0, 2.0, 3.0] {
            for step in 0..=10 {
                let x = f64::from(step) / 10.0;
                let sum = edge_blend_ramp(x, 2.2, power) + edge_blend_ramp(1.0 - x, 2.2, power);
                assert!(close(sum, 1.0), "power {power} x {x}: {sum}");
            }
        }
        // A higher gamma lifts the ramp.
        assert!(edge_blend_ramp(0.25, 3.0, 1.0) > edge_blend_ramp(0.25, 2.2, 1.0));
        // Power steepens the S-curve.
        assert!(edge_blend_ramp(0.25, 2.2, 2.0) < edge_blend_ramp(0.25, 2.2, 1.0));

        let blend = EdgeBlend {
            right: EdgeBlendSide {
                width: 0.2,
                ..EdgeBlendSide::default()
            },
            ..EdgeBlend::default()
        };
        assert!(close(edge_blend_factor(&blend, 0.5, 0.5), 1.0));
        assert!(close(edge_blend_factor(&blend, 0.9, 0.5), 0.5));
        assert!(close(edge_blend_factor(&blend, 1.0, 0.5), 0.0));
    }
}
