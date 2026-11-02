//! Render contract v2: composition, screens, layouts and mapping.
//!
//! Mirrors `packages/schema/src/composition.ts`, `packages/schema/src/slide.ts` and
//! `packages/schema/src/screen.ts` field for field. Zod defaults are serde defaults here. See
//! docs/architecture/02-render-contract.md and docs/architecture/10-screens-and-mapping.md.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};


/// Pixel or slide size.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

/// Composition of sources, layers, effects and masks. Knows nothing about screens.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Composition {
    pub schema_version: u32,
    pub revision: u64,
    pub canvas: Size,
    #[serde(default)]
    pub color_space: ColorSpace,
    pub sources: Vec<Source>,
    /// Bottom to top.
    pub layers: Vec<CompositionLayer>,
    #[serde(default)]
    pub master: Master,
    #[serde(default)]
    pub fonts: Vec<CompositionFont>,
    #[serde(default)]
    pub assets: Vec<CompositionAsset>,
}

impl Composition {
    pub fn source(&self, id: &str) -> Option<&Source> {
        self.sources.iter().find(|source| source.id() == id)
    }

    pub fn asset(&self, id: &str) -> Option<&CompositionAsset> {
        self.assets.iter().find(|asset| asset.id == id)
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GradientKind {
    #[default]
    Linear,
    Radial,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaintStop {
    pub at: f64,
    pub color: String,
}

/// An animatable parameter value: a number, a colour string or a boolean.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ParamValue {
    Number(f64),
    Bool(bool),
    Text(String),
}

pub type Params = BTreeMap<String, ParamValue>;

/// A source produces pixels. Several layers can share one source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum Source {
    Video {
        id: String,
        #[serde(default)]
        name: String,
        asset: AssetRef,
        #[serde(default = "yes", rename = "loop")]
        loop_: bool,
        #[serde(default)]
        in_ms: f64,
        /// End of the played range; `None` plays to the end of the file.
        #[serde(default)]
        out_ms: Option<f64>,
        #[serde(default = "one")]
        rate: f64,
        #[serde(default)]
        reverse: bool,
        #[serde(default = "yes")]
        muted: bool,
        #[serde(default = "one")]
        volume: f64,
    },
    Image {
        id: String,
        #[serde(default)]
        name: String,
        asset: AssetRef,
    },
    Slide {
        id: String,
        #[serde(default)]
        name: String,
        /// Bumps when the slide content changes; drives slide transitions.
        #[serde(default)]
        revision: u64,
        /// Text, shape and image elements with the v1 layer shapes.
        elements: Vec<SlideElement>,
        safe_area: Insets,
        size: Size,
    },
    Solid {
        id: String,
        #[serde(default)]
        name: String,
        color: String,
    },
    Gradient {
        id: String,
        #[serde(default)]
        name: String,
        #[serde(default)]
        gradient: GradientKind,
        stops: Vec<PaintStop>,
        #[serde(default)]
        angle: f64,
    },
    Shader {
        id: String,
        #[serde(default)]
        name: String,
        shader_id: String,
        #[serde(default)]
        params: Params,
    },
    /// Reserved for Wave E3. Renders nothing.
    Ndi { id: String, name: String },
    /// Reserved for Wave E3. Renders nothing.
    Camera {
        id: String,
        #[serde(default)]
        name: String,
        device_id: String,
    },
}

impl Source {
    pub fn id(&self) -> &str {
        match self {
            Source::Video { id, .. }
            | Source::Image { id, .. }
            | Source::Slide { id, .. }
            | Source::Solid { id, .. }
            | Source::Gradient { id, .. }
            | Source::Shader { id, .. }
            | Source::Ndi { id, .. }
            | Source::Camera { id, .. } => id,
        }
    }
}

/// Effect kinds the renderer knows. Unknown kinds are skipped with a warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EffectKind {
    Color,
    Blur,
    Key,
    Transform,
    Kaleidoscope,
    Feedback,
}

impl EffectKind {
    pub fn parse(kind: &str) -> Option<Self> {
        Some(match kind {
            "color" => Self::Color,
            "blur" => Self::Blur,
            "key" => Self::Key,
            "transform" => Self::Transform,
            "kaleidoscope" => Self::Kaleidoscope,
            "feedback" => Self::Feedback,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: String,
    /// Kept as text so an unknown kind deserializes and is skipped at render time.
    pub kind: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub params: Params,
}

impl Effect {
    pub fn effect_kind(&self) -> Option<EffectKind> {
        EffectKind::parse(&self.kind)
    }
}

/// Mask in normalized coordinates: layer space for layer masks, output space for mapping masks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Mask {
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default)]
        radius: f64,
        #[serde(default)]
        feather: f64,
        #[serde(default)]
        invert: bool,
    },
    Polygon {
        points: Vec<[f64; 2]>,
        #[serde(default)]
        feather: f64,
        #[serde(default)]
        invert: bool,
    },
    Image {
        asset: AssetRef,
        #[serde(default)]
        invert: bool,
    },
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BlendMode {
    #[default]
    Normal,
    Add,
    Screen,
    Multiply,
    Overlay,
    Difference,
    Alpha,
}

/// Normalized to the canvas. Positions may leave 0..1.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayerTransform {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "one")]
    pub w: f64,
    #[serde(default = "one")]
    pub h: f64,
    /// Degrees, clockwise on screen.
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "half")]
    pub anchor_x: f64,
    #[serde(default = "half")]
    pub anchor_y: f64,
}

impl Default for LayerTransform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
            rotation: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionLayer {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// `None` renders nothing.
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub transform: LayerTransform,
    #[serde(default)]
    pub fit: Fit,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub blend: BlendMode,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub mask: Option<Mask>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Master {
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub effects: Vec<Effect>,
}

impl Default for Master {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            effects: Vec::new(),
        }
    }
}

// --- Screens -----------------------------------------------------------------

/// Stable monitor identity: name plus position.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScreenRef {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ScreenTarget {
    Display {
        #[serde(rename = "ref")]
        ref_: ScreenRef,
    },
    Ndi {
        name: String,
    },
    Virtual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum LayerFilter {
    All,
    Only {
        #[serde(default)]
        ids: Vec<String>,
        #[serde(default)]
        tags: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Region {
    pub const FULL: Region = Region {
        x: 0.0,
        y: 0.0,
        w: 1.0,
        h: 1.0,
    };
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TextPreset {
    #[default]
    Full,
    LowerThird,
    Strip,
    Hidden,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutText {
    #[serde(default)]
    pub preset: TextPreset,
    /// Multiplies font size.
    #[serde(default = "one")]
    pub scale: f64,
    #[serde(default)]
    pub color: Option<String>,
}

impl Default for LayoutText {
    fn default() -> Self {
        Self {
            preset: TextPreset::Full,
            scale: 1.0,
            color: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StagePart {
    Current,
    Next,
    Notes,
    Clock,
    Timers,
    Message,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageLayout {
    pub show: Vec<StagePart>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub layers: LayerFilter,
    pub region: Region,
    pub safe_area: Insets,
    #[serde(default)]
    pub text: Option<LayoutText>,
    /// Drawn under the screen's layers.
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub stage: Option<StageLayout>,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            layers: LayerFilter::All,
            region: Region::FULL,
            safe_area: Insets::default(),
            text: None,
            background: None,
            stage: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct EdgeBlendSide {
    /// Normalized overlap width; 0 turns the side off.
    #[serde(default)]
    pub width: f64,
    #[serde(default = "gamma_default")]
    pub gamma: f64,
    #[serde(default = "one")]
    pub power: f64,
}

impl Default for EdgeBlendSide {
    fn default() -> Self {
        Self {
            width: 0.0,
            gamma: 2.2,
            power: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct EdgeBlend {
    pub left: EdgeBlendSide,
    pub right: EdgeBlendSide,
    pub top: EdgeBlendSide,
    pub bottom: EdgeBlendSide,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Mesh {
    pub cols: u32,
    pub rows: u32,
    /// Row-major control points, normalized output.
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct MappingColor {
    #[serde(default)]
    pub brightness: f64,
    #[serde(default = "one")]
    pub contrast: f64,
    #[serde(default = "one")]
    pub gamma: f64,
    #[serde(default = "one")]
    pub red: f64,
    #[serde(default = "one")]
    pub green: f64,
    #[serde(default = "one")]
    pub blue: f64,
}

impl Default for MappingColor {
    fn default() -> Self {
        Self {
            brightness: 0.0,
            contrast: 1.0,
            gamma: 1.0,
            red: 1.0,
            green: 1.0,
            blue: 1.0,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    /// tl, tr, br, bl in normalized output space.
    #[serde(default)]
    pub corner_pin: Option<[Point; 4]>,
    #[serde(default)]
    pub mesh: Option<Mesh>,
    #[serde(default)]
    pub edge_blend: Option<EdgeBlend>,
    /// In output space.
    #[serde(default)]
    pub masks: Vec<Mask>,
    #[serde(default)]
    pub color: MappingColor,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScreenRole {
    #[default]
    Audience,
    Stage,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TestPattern {
    Grid,
    Bars,
    Identify,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Screen {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub target: ScreenTarget,
    /// Output pixels; display targets follow the monitor.
    pub size: Size,
    #[serde(default)]
    pub role: ScreenRole,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub blackout: bool,
    #[serde(default)]
    pub test_pattern: Option<TestPattern>,
    pub layout: Layout,
    #[serde(default)]
    pub mapping: Mapping,
}

impl Screen {
    /// A virtual screen that shows the whole canvas unchanged; used for canvas previews.
    pub fn canvas(size: Size) -> Self {
        Self {
            id: "canvas".into(),
            name: "Canvas".into(),
            target: ScreenTarget::Virtual,
            size,
            role: ScreenRole::Audience,
            enabled: true,
            blackout: false,
            test_pattern: None,
            layout: Layout::default(),
            mapping: Mapping::default(),
        }
    }
}

// --- Slide content, fonts and assets ------------------------------------------
//
// Mirrors `packages/schema/src/slide.ts`: the fonts and assets a composition carries and the
// text, shape and image elements a `slide` source draws.

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColorSpace {
    #[default]
    Srgb,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct Insets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionFont {
    pub id: String,
    pub family: String,
    pub path: String,
    pub hash: String,
    #[serde(default)]
    pub fallback: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionAsset {
    pub id: String,
    pub hash: String,
    pub kind: AssetKind,
    #[serde(default)]
    pub local_path: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    pub intrinsic: IntrinsicSize,
    #[serde(default)]
    pub state: AssetState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Video,
    Font,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetState {
    #[default]
    Ready,
    Missing,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct IntrinsicSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    pub asset_id: String,
    pub hash: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub rotation: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum SlideElement {
    Text {
        id: String,
        frame: Frame,
        #[serde(default)]
        z: i32,
        #[serde(default = "one")]
        opacity: f64,
        #[serde(default)]
        runs: Vec<TextRun>,
        font_id: String,
        font_size: f64,
        #[serde(default = "weight_default")]
        weight: u32,
        color: String,
        #[serde(default)]
        align: TextAlign,
        #[serde(default)]
        v_align: TextVAlign,
        #[serde(default = "line_height_default")]
        line_height: f64,
        #[serde(default)]
        letter_spacing: f64,
        #[serde(default)]
        fit: TextFit,
        #[serde(default)]
        padding: f64,
        #[serde(default)]
        max_lines: Option<u32>,
        #[serde(default)]
        shadow: Option<TextShadow>,
        #[serde(default)]
        outline: Option<TextOutline>,
    },
    Shape {
        id: String,
        frame: Frame,
        #[serde(default)]
        z: i32,
        #[serde(default = "one")]
        opacity: f64,
        fill: String,
        #[serde(default)]
        stroke: Option<String>,
        #[serde(default)]
        stroke_width: f64,
        #[serde(default)]
        radius: f64,
    },
    Image {
        id: String,
        frame: Frame,
        #[serde(default)]
        z: i32,
        #[serde(default = "one")]
        opacity: f64,
        source: AssetRef,
        #[serde(default)]
        fit: Fit,
        #[serde(default)]
        radius: f64,
    },
}

impl SlideElement {
    pub fn id(&self) -> &str {
        match self {
            SlideElement::Text { id, .. }
            | SlideElement::Shape { id, .. }
            | SlideElement::Image { id, .. } => id,
        }
    }

    pub fn frame(&self) -> Frame {
        match self {
            SlideElement::Text { frame, .. }
            | SlideElement::Shape { frame, .. }
            | SlideElement::Image { frame, .. } => *frame,
        }
    }

    pub fn z(&self) -> i32 {
        match self {
            SlideElement::Text { z, .. }
            | SlideElement::Shape { z, .. }
            | SlideElement::Image { z, .. } => *z,
        }
    }

    pub fn opacity(&self) -> f64 {
        match self {
            SlideElement::Text { opacity, .. }
            | SlideElement::Shape { opacity, .. }
            | SlideElement::Image { opacity, .. } => *opacity,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TextRun {
    pub text: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    Left,
    #[default]
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TextVAlign {
    Top,
    #[default]
    Middle,
    Bottom,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TextFit {
    #[default]
    Wrap,
    Shrink,
    None,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    #[default]
    Cover,
    Contain,
    Stretch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextShadow {
    pub color: String,
    pub blur: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextOutline {
    pub color: String,
    pub width: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransitionKind {
    Cut,
    Fade,
    Dissolve,
    Slide,
    Zoom,
}

const fn weight_default() -> u32 {
    400
}

const fn line_height_default() -> f64 {
    1.2
}

const fn one() -> f64 {
    1.0
}

const fn half() -> f64 {
    0.5
}

const fn gamma_default() -> f64 {
    2.2
}

const fn yes() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Fixture {
        composition: Composition,
        screens: Vec<Screen>,
    }

    /// `createShowDoc()` from packages/core/src/show.ts, parsed by the Zod schemas.
    const SHOW_DOC: &str = include_str!("../fixtures/show-doc.json");
    /// Every source kind, blend mode, mask kind and mapping field, parsed by the Zod schemas.
    const FULL: &str = include_str!("../fixtures/full-composition.json");

    #[test]
    fn deserializes_the_default_show_document() {
        let fixture: Fixture = serde_json::from_str(SHOW_DOC).expect("show doc");
        let composition = fixture.composition;
        assert_eq!(composition.schema_version, 2);
        assert_eq!(composition.canvas.width, 1920.0);
        assert_eq!(composition.layers.len(), 3);
        assert_eq!(composition.layers[2].tags, vec!["lyrics"]);
        assert!(composition.layers[0].source_id.is_none());
        assert_eq!(composition.layers[0].transform.anchor_x, 0.5);
        assert_eq!(fixture.screens.len(), 3);
        assert_eq!(fixture.screens[0].target, ScreenTarget::Virtual);
        match &fixture.screens[1].layout.layers {
            LayerFilter::Only { ids, tags } => {
                assert_eq!(ids.len(), 2);
                assert!(tags.is_empty());
            }
            other => panic!("expected only filter, got {other:?}"),
        }
        assert_eq!(
            fixture.screens[1]
                .layout
                .text
                .as_ref()
                .map(|text| text.preset),
            Some(TextPreset::Hidden)
        );
        assert_eq!(
            fixture.screens[2]
                .layout
                .text
                .as_ref()
                .map(|text| text.preset),
            Some(TextPreset::LowerThird)
        );
        assert_eq!(fixture.screens[0].mapping.color, MappingColor::default());
    }

    #[test]
    fn deserializes_every_source_mask_and_mapping_field() {
        let fixture: Fixture = serde_json::from_str(FULL).expect("full composition");
        let composition = &fixture.composition;
        assert_eq!(composition.revision, 12);
        assert_eq!(composition.sources.len(), 8);
        match composition.source("src_video") {
            Some(Source::Video {
                in_ms,
                out_ms,
                loop_,
                asset,
                ..
            }) => {
                assert_eq!(*in_ms, 500.0);
                assert!(out_ms.is_none());
                assert!(*loop_);
                assert_eq!(asset.asset_id, "asset_clip");
            }
            other => panic!("expected video, got {other:?}"),
        }
        match composition.source("src_slide") {
            Some(Source::Slide {
                elements,
                revision,
                size,
                ..
            }) => {
                assert_eq!(*revision, 3);
                assert_eq!(elements.len(), 3);
                assert_eq!(size.width, 1920.0);
            }
            other => panic!("expected slide, got {other:?}"),
        }
        assert!(matches!(
            composition.source("src_gradient"),
            Some(Source::Gradient {
                gradient: GradientKind::Radial,
                ..
            })
        ));
        match composition.source("src_plasma") {
            Some(Source::Shader {
                shader_id, params, ..
            }) => {
                assert_eq!(shader_id, "plasma");
                assert_eq!(params.get("scale"), Some(&ParamValue::Number(2.0)));
                assert_eq!(
                    params.get("colorA"),
                    Some(&ParamValue::Text("#ff2d95".into()))
                );
            }
            other => panic!("expected shader, got {other:?}"),
        }
        assert!(
            matches!(composition.source("src_ndi"), Some(Source::Ndi { name, .. }) if name == "CAM 1")
        );
        assert!(
            matches!(composition.source("src_camera"), Some(Source::Camera { device_id, .. }) if device_id == "dev-1")
        );

        let blends: Vec<BlendMode> = composition.layers.iter().map(|layer| layer.blend).collect();
        assert_eq!(
            blends,
            vec![
                BlendMode::Normal,
                BlendMode::Screen,
                BlendMode::Multiply,
                BlendMode::Alpha,
                BlendMode::Normal,
                BlendMode::Difference,
                BlendMode::Overlay,
                BlendMode::Add
            ]
        );
        let video = &composition.layers[1];
        assert_eq!(video.transform.rotation, 15.0);
        assert_eq!(video.transform.anchor_y, 1.0);
        assert_eq!(video.fit, Fit::Contain);
        assert_eq!(video.effects[0].effect_kind(), Some(EffectKind::Key));
        assert_eq!(
            video.effects[0].params.get("invert"),
            Some(&ParamValue::Bool(false))
        );
        assert!(matches!(video.mask, Some(Mask::Rect { radius, .. }) if radius == 0.05));
        assert!(
            matches!(&composition.layers[2].mask, Some(Mask::Polygon { points, invert: true, .. }) if points.len() == 3)
        );
        assert!(matches!(
            composition.layers[3].mask,
            Some(Mask::Image { .. })
        ));
        assert!(!composition.layers[5].enabled);
        assert_eq!(composition.master.opacity, 0.9);
        assert_eq!(
            composition.master.effects[0].effect_kind(),
            Some(EffectKind::Blur)
        );

        let left = &fixture.screens[0];
        assert!(
            matches!(&left.target, ScreenTarget::Display { ref_ } if ref_.name == "Projector A" && ref_.x == 1920.0)
        );
        assert_eq!(left.layout.region.w, 0.55);
        assert_eq!(left.layout.background.as_deref(), Some("#101010"));
        let text = left.layout.text.as_ref().expect("text");
        assert_eq!(text.preset, TextPreset::Strip);
        assert_eq!(text.color.as_deref(), Some("#ffff00"));
        let mapping = &left.mapping;
        assert_eq!(mapping.corner_pin.expect("pin")[1].y, 0.03);
        let mesh = mapping.mesh.as_ref().expect("mesh");
        assert_eq!(mesh.points.len(), (mesh.cols * mesh.rows) as usize);
        let blend = mapping.edge_blend.expect("edge blend");
        assert_eq!(blend.right.width, 0.1);
        assert_eq!(blend.right.power, 2.0);
        assert_eq!(mapping.masks.len(), 1);
        assert_eq!(mapping.color.green, 0.95);

        let ndi = &fixture.screens[1];
        assert!(matches!(&ndi.target, ScreenTarget::Ndi { name } if name == "Lumen"));
        assert!(ndi.blackout);
        assert_eq!(ndi.test_pattern, Some(TestPattern::Grid));
        assert_eq!(ndi.role, ScreenRole::Stage);
    }

    #[test]
    fn round_trips_through_json() {
        let fixture: Fixture = serde_json::from_str(FULL).expect("full composition");
        let json = serde_json::to_string(&fixture.composition).expect("serialize");
        let again: Composition = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(again, fixture.composition);
        let json = serde_json::to_string(&fixture.screens[0]).expect("serialize screen");
        assert!(json.contains("\"cornerPin\""));
        assert!(json.contains("\"edgeBlend\""));
        assert!(json.contains("\"testPattern\""));
        let again: Screen = serde_json::from_str(&json).expect("deserialize screen");
        assert_eq!(again, fixture.screens[0]);
    }

    #[test]
    fn keeps_unknown_effect_kinds_for_a_warning_instead_of_failing() {
        let json = r##"{
            "schemaVersion": 2, "revision": 1, "canvas": { "width": 1280, "height": 720 },
            "sources": [{ "kind": "solid", "id": "s", "color": "#ff0000" }],
            "layers": [{
                "id": "l", "name": "L", "sourceId": "s", "transform": {},
                "effects": [
                    { "id": "e1", "kind": "glitch", "params": { "amount": 0.5 } },
                    { "id": "e2", "kind": "blur" }
                ]
            }],
            "master": {}
        }"##;
        let composition: Composition = serde_json::from_str(json).expect("composition");
        let layer = &composition.layers[0];
        assert_eq!(layer.effects[0].effect_kind(), None);
        assert_eq!(layer.effects[1].effect_kind(), Some(EffectKind::Blur));
        assert!(layer.effects[1].enabled);
        assert!(layer.effects[1].params.is_empty());
        assert_eq!(layer.transform, LayerTransform::default());
        assert_eq!(layer.fit, Fit::Cover);
        assert_eq!(layer.opacity, 1.0);
        assert_eq!(composition.master, Master::default());
        assert!(composition.fonts.is_empty());
    }
}
