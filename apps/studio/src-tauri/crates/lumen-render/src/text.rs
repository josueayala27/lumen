//! cosmic-text shaping and CPU glyph placement for text layers.

use std::collections::{HashMap, HashSet};

use cosmic_text::{
    Align as CosmicAlign, Attrs, Buffer, CacheKey, Color as CosmicColor, Family, FontSystem,
    Metrics, Shaping, Style, SwashCache, SwashContent, UnderlineStyle, Weight, Wrap,
};

use crate::color::ClearColor;
use crate::geometry::{rotated_bounds, FrameRect};
use crate::{
    Frame, Layer, PreviewBounds, PreviewTextRun, Scene, SceneFont, TextAlign, TextFit, TextVAlign,
};

const ATLAS_WIDTH: u32 = 2048;
const ATLAS_HEIGHT: u32 = 2048;
const ATLAS_PADDING: u32 = 1;
const SHRINK_STEPS: u32 = 32;

/// One rasterized glyph quad in target pixels, before rotation.
#[derive(Debug, Clone, Copy)]
pub(crate) struct GlyphDraw {
    pub cache_key: CacheKey,
    pub layer_index: u32,
    pub rect: FrameRect,
    pub color: [f32; 4],
    pub rotation: f32,
    pub center: (f32, f32),
}

#[derive(Debug, Default)]
pub(crate) struct TextLayout {
    pub bounds: Vec<PreviewBounds>,
    pub text_runs: Vec<PreviewTextRun>,
    pub glyphs: Vec<GlyphDraw>,
}

#[derive(Debug, Clone)]
pub(crate) struct AtlasData {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
    pub uvs: HashMap<CacheKey, [f32; 4]>,
}

impl AtlasData {
    fn empty() -> Self {
        Self {
            width: 1,
            height: 1,
            pixels: vec![0, 0, 0, 0],
            uvs: HashMap::new(),
        }
    }
}

pub(crate) struct TextEngine {
    font_system: FontSystem,
    swash: SwashCache,
    loaded_fonts: HashSet<String>,
}

impl TextEngine {
    pub(crate) fn new() -> Self {
        Self {
            font_system: FontSystem::new(),
            swash: SwashCache::new(),
            loaded_fonts: HashSet::new(),
        }
    }

    /// Shapes every text layer and returns the editor layout plus glyph quads.
    pub(crate) fn layout(&mut self, scene: &Scene, width: u32, height: u32) -> TextLayout {
        let mut result = TextLayout::default();
        if width == 0 || height == 0 {
            return result;
        }
        self.register_fonts(scene);
        let width = width as f32;
        let height = height as f32;
        let scale_x = width / scene.viewport.width.max(1.0) as f32;

        let layers = scene.background.iter().chain(scene.layers.iter());
        for (layer_index, layer) in layers.enumerate() {
            let frame = layer.frame();
            let bounds = rotated_bounds(frame, width, height);
            result.bounds.push(PreviewBounds {
                element_id: layer.id().to_string(),
                x: bounds.x,
                y: bounds.y,
                width: bounds.w,
                height: bounds.h,
            });
            if let Layer::Text {
                id,
                frame,
                opacity,
                runs,
                font_id,
                font_size,
                weight,
                color,
                align,
                v_align,
                line_height,
                letter_spacing,
                fit,
                padding,
                max_lines,
                ..
            } = layer
            {
                self.layout_text(
                    scene,
                    layer_index as u32,
                    id,
                    *frame,
                    *opacity,
                    runs,
                    font_id,
                    *font_size,
                    *weight,
                    color,
                    *align,
                    *v_align,
                    *line_height,
                    *letter_spacing,
                    *fit,
                    *padding,
                    *max_lines,
                    scale_x,
                    width,
                    height,
                    &mut result,
                );
            }
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    fn layout_text(
        &mut self,
        scene: &Scene,
        layer_index: u32,
        id: &str,
        frame: Frame,
        opacity: f64,
        runs: &[crate::TextRun],
        font_id: &str,
        font_size: f64,
        weight: u32,
        color: &str,
        align: TextAlign,
        v_align: TextVAlign,
        line_height: f64,
        letter_spacing: f64,
        fit: TextFit,
        padding: f64,
        max_lines: Option<u32>,
        scale: f32,
        width: f32,
        height: f32,
        result: &mut TextLayout,
    ) {
        let frame_rect = FrameRect::from_frame(frame, width, height);
        let padding_px = (padding as f32 * scale).max(0.0);
        let block_x = frame_rect.x + padding_px;
        let block_y = frame_rect.y + padding_px;
        let block_w = (frame_rect.w - padding_px * 2.0).max(1.0);
        let block_h = (frame_rect.h - padding_px * 2.0).max(1.0);
        let family = self.resolve_family(scene, font_id);
        let base_size = (font_size as f32 * scale).max(1.0);
        let line_height = line_height.max(0.01) as f32;
        let letter_spacing = if base_size > 0.0 {
            letter_spacing as f32 / base_size
        } else {
            0.0
        };
        let wrap = match fit {
            TextFit::None => Wrap::None,
            TextFit::Wrap | TextFit::Shrink => Wrap::Word,
        };
        let align = match align {
            TextAlign::Left => CosmicAlign::Left,
            TextAlign::Center => CosmicAlign::Center,
            TextAlign::Right => CosmicAlign::Right,
        };
        let layer_color = ClearColor::parse_or_black(color);
        let height_limit = match max_lines {
            Some(max_lines) if max_lines > 0 => {
                block_h.min(base_size * line_height * max_lines as f32)
            }
            _ => block_h,
        };

        let mut size = base_size;
        let mut shaped;
        let mut total_height;
        let mut attempts = 0;
        loop {
            shaped = self.shape(
                &family,
                runs,
                size,
                line_height,
                weight,
                letter_spacing,
                wrap,
                align,
                layer_color,
                block_w,
                height_limit,
            );
            total_height = shaped.total_height;
            if fit != TextFit::Shrink || total_height <= height_limit || attempts >= SHRINK_STEPS {
                break;
            }
            size *= 0.9;
            attempts += 1;
        }

        let v_offset = match v_align {
            TextVAlign::Top => 0.0,
            TextVAlign::Middle => (block_h - total_height).max(0.0) * 0.5,
            TextVAlign::Bottom => (block_h - total_height).max(0.0),
        };
        let origin_x = block_x;
        let origin_y = block_y + v_offset;
        let rotation = frame.rotation as f32;
        let center = frame_rect.center();
        let opacity = opacity.clamp(0.0, 1.0);

        for (line_index, line) in shaped.lines.iter().enumerate() {
            if let Some(max_lines) = max_lines {
                if line_index as u32 >= max_lines {
                    break;
                }
            }
            let caret_stops = line
                .caret_stops
                .iter()
                .map(|x| f64::from((origin_x + *x) / width))
                .collect();
            result.text_runs.push(PreviewTextRun {
                element_id: id.to_string(),
                line: line_index as u32,
                text: line.text.clone(),
                x: f64::from((origin_x + line.x) / width),
                y: f64::from((origin_y + line.top) / height),
                width: f64::from(line.width / width),
                height: f64::from(line.height / height),
                caret_stops,
            });
        }

        for glyph in shaped.glyphs {
            let color = glyph
                .color
                .map(|color| {
                    let (r, g, b, a) = color.as_rgba_tuple();
                    ClearColor::from_rgba8(r, g, b, a)
                })
                .unwrap_or(layer_color)
                .with_alpha(opacity);
            let physical = glyph.physical((origin_x, origin_y), 1.0);
            let Some(image) = self
                .swash
                .get_image(&mut self.font_system, physical.cache_key)
            else {
                continue;
            };
            let glyph_w = image.placement.width as f32;
            let glyph_h = image.placement.height as f32;
            if glyph_w <= 0.0 || glyph_h <= 0.0 {
                continue;
            }
            result.glyphs.push(GlyphDraw {
                cache_key: physical.cache_key,
                layer_index,
                rect: FrameRect {
                    x: physical.x as f32 + image.placement.left as f32,
                    y: physical.y as f32 - image.placement.top as f32,
                    w: glyph_w,
                    h: glyph_h,
                },
                color: color.to_array(),
                rotation,
                center,
            });
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn shape(
        &mut self,
        family: &str,
        runs: &[crate::TextRun],
        font_size: f32,
        line_height: f32,
        weight: u32,
        letter_spacing: f32,
        wrap: Wrap,
        align: CosmicAlign,
        layer_color: ClearColor,
        block_w: f32,
        block_h: f32,
    ) -> ShapedBlock {
        let metrics = Metrics::new(font_size, font_size * line_height);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_wrap(wrap);
        buffer.set_size(Some(block_w), Some(block_h));

        let family = if family.is_empty() {
            Family::SansSerif
        } else {
            Family::Name(family)
        };
        let default = shape_attrs(
            family,
            weight,
            false,
            false,
            layer_color,
            letter_spacing,
        );
        let spans: Vec<(&str, Attrs<'_>)> = runs
            .iter()
            .map(|run| {
                let color = run
                    .color
                    .as_deref()
                    .map(ClearColor::parse_or_black)
                    .unwrap_or(layer_color);
                let attrs = shape_attrs(
                    family,
                    if run.bold { weight.max(700) } else { weight },
                    run.italic,
                    run.underline,
                    color,
                    letter_spacing,
                );
                (run.text.as_str(), attrs)
            })
            .collect();
        buffer.set_rich_text(spans, &default, Shaping::Advanced, Some(align));
        buffer.shape_until_scroll(&mut self.font_system, false);

        let mut shaped = ShapedBlock::default();
        for run in buffer.layout_runs() {
            let line = ShapedLine::from_run(&run);
            if !line.text.is_empty() || !run.glyphs.is_empty() {
                shaped.total_height = run.line_top + run.line_height;
                shaped.glyphs.extend(run.glyphs.iter().cloned());
                shaped.lines.push(line);
            }
        }
        shaped
    }

    /// Rasterizes the glyphs used by a layout into one RGBA atlas.
    pub(crate) fn build_atlas(&mut self, glyphs: &[GlyphDraw]) -> AtlasData {
        let mut atlas = AtlasData {
            width: ATLAS_WIDTH,
            height: ATLAS_HEIGHT,
            pixels: vec![0; ATLAS_WIDTH as usize * ATLAS_HEIGHT as usize * 4],
            uvs: HashMap::new(),
        };
        if glyphs.is_empty() {
            return AtlasData::empty();
        }

        let mut cursor_x = ATLAS_PADDING;
        let mut cursor_y = ATLAS_PADDING;
        let mut shelf_height = 0;
        for glyph in glyphs {
            if atlas.uvs.contains_key(&glyph.cache_key) {
                continue;
            }
            let Some(image) = self
                .swash
                .get_image(&mut self.font_system, glyph.cache_key)
            else {
                continue;
            };
            let image_w = image.placement.width;
            let image_h = image.placement.height;
            if image_w == 0 || image_h == 0 {
                continue;
            }
            if cursor_x + image_w + ATLAS_PADDING > ATLAS_WIDTH {
                cursor_x = ATLAS_PADDING;
                cursor_y += shelf_height + ATLAS_PADDING;
                shelf_height = 0;
            }
            if cursor_y + image_h + ATLAS_PADDING > ATLAS_HEIGHT {
                continue;
            }

            blit_glyph(&mut atlas.pixels, image, cursor_x, cursor_y);
            atlas.uvs.insert(
                glyph.cache_key,
                [
                    cursor_x as f32 / ATLAS_WIDTH as f32,
                    cursor_y as f32 / ATLAS_HEIGHT as f32,
                    (cursor_x + image_w) as f32 / ATLAS_WIDTH as f32,
                    (cursor_y + image_h) as f32 / ATLAS_HEIGHT as f32,
                ],
            );
            cursor_x += image_w + ATLAS_PADDING;
            shelf_height = shelf_height.max(image_h);
        }
        atlas
    }

    fn register_fonts(&mut self, scene: &Scene) {
        for font in &scene.fonts {
            if self.loaded_fonts.contains(&font.path) {
                continue;
            }
            if self
                .font_system
                .db_mut()
                .load_font_file(&font.path)
                .is_ok()
            {
                self.loaded_fonts.insert(font.path.clone());
            }
        }
    }

    fn resolve_family(&self, scene: &Scene, font_id: &str) -> String {
        let Some(font) = scene.fonts.iter().find(|font| font.id == font_id) else {
            return String::new();
        };
        if self.family_exists(font) {
            return font.family.clone();
        }
        for fallback in &font.fallback {
            if self.family_exists_named(fallback) {
                return fallback.clone();
            }
        }
        String::new()
    }

    fn family_exists(&self, font: &SceneFont) -> bool {
        self.family_exists_named(&font.family)
    }

    fn family_exists_named(&self, family: &str) -> bool {
        self.font_system.db().faces().any(|face| {
            face.families
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case(family))
        })
    }
}

#[allow(clippy::too_many_arguments)]
fn shape_attrs<'a>(
    family: Family<'a>,
    weight: u32,
    italic: bool,
    underline: bool,
    color: ClearColor,
    letter_spacing: f32,
) -> Attrs<'a> {
    let [r, g, b, a] = color.to_rgba8();
    let mut attrs = Attrs::new()
        .family(family)
        .weight(Weight(weight.clamp(100, 900) as u16))
        .style(if italic { Style::Italic } else { Style::Normal })
        .color(CosmicColor::rgba(r, g, b, a))
        .letter_spacing(letter_spacing);
    if underline {
        attrs = attrs.underline(UnderlineStyle::Single);
    }
    attrs
}

#[derive(Debug, Default)]
struct ShapedBlock {
    lines: Vec<ShapedLine>,
    glyphs: Vec<cosmic_text::LayoutGlyph>,
    total_height: f32,
}

#[derive(Debug)]
struct ShapedLine {
    text: String,
    x: f32,
    top: f32,
    width: f32,
    height: f32,
    caret_stops: Vec<f32>,
}

impl ShapedLine {
    fn from_run(run: &cosmic_text::LayoutRun<'_>) -> Self {
        let text = match (run.glyphs.first(), run.glyphs.last()) {
            (Some(first), Some(last)) => run
                .text
                .get(first.start.min(run.text.len())..last.end.min(run.text.len()))
                .unwrap_or_default()
                .to_string(),
            _ => String::new(),
        };
        let mut caret_stops: Vec<f32> = run.glyphs.iter().map(|glyph| glyph.x).collect();
        if let Some(last) = run.glyphs.last() {
            caret_stops.push(last.x + last.w);
        }
        caret_stops.sort_by(|left, right| left.total_cmp(right));
        caret_stops.dedup_by(|left, right| (*left - *right).abs() < 0.01);
        let x = run
            .glyphs
            .iter()
            .map(|glyph| glyph.x)
            .fold(f32::INFINITY, f32::min);
        let x = if x.is_finite() { x } else { 0.0 };
        Self {
            text,
            x,
            top: run.line_top,
            width: run.line_w,
            height: run.line_height,
            caret_stops,
        }
    }
}

fn blit_glyph(
    pixels: &mut [u8],
    image: &cosmic_text::SwashImage,
    origin_x: u32,
    origin_y: u32,
) {
    let width = image.placement.width;
    let height = image.placement.height;
    for row in 0..height {
        for column in 0..width {
            let source = (row * width + column) as usize;
            let target = (((origin_y + row) * ATLAS_WIDTH + origin_x + column) * 4) as usize;
            match image.content {
                SwashContent::Mask => {
                    pixels[target] = 255;
                    pixels[target + 1] = 255;
                    pixels[target + 2] = 255;
                    pixels[target + 3] = image.data.get(source).copied().unwrap_or(0);
                }
                SwashContent::SubpixelMask => {
                    pixels[target] = 255;
                    pixels[target + 1] = 255;
                    pixels[target + 2] = 255;
                    pixels[target + 3] = image.data.get(source * 3).copied().unwrap_or(0);
                }
                SwashContent::Color => {
                    let source = source * 4;
                    pixels[target] = image.data.get(source).copied().unwrap_or(0);
                    pixels[target + 1] = image.data.get(source + 1).copied().unwrap_or(0);
                    pixels[target + 2] = image.data.get(source + 2).copied().unwrap_or(0);
                    pixels[target + 3] = image.data.get(source + 3).copied().unwrap_or(0);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_layout_has_no_bounds() {
        let mut engine = TextEngine::new();
        let layout = engine.layout(&crate::spike_scene(), 0, 0);
        assert!(layout.bounds.is_empty());
        assert!(layout.text_runs.is_empty());
        assert!(layout.glyphs.is_empty());
    }

    #[test]
    fn atlas_start_stop_is_valid_when_no_glyphs_are_drawn() {
        let mut engine = TextEngine::new();
        let atlas = engine.build_atlas(&[]);
        assert_eq!(atlas.width, 1);
        assert_eq!(atlas.pixels.len(), 4);
        assert!(atlas.uvs.is_empty());
    }
}
