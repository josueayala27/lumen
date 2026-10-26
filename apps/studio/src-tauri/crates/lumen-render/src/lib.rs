//! Scene model and renderer interface.
//!
//! The TypeScript `Scene` in `packages/schema/src/scene.ts` is the contract. This crate mirrors it
//! exactly and renders it with wgpu and cosmic-text.

use serde::{Deserialize, Serialize};

mod asset;
mod bc;
mod blur;
mod color;
mod geometry;
mod renderer;
mod text;
mod video;

pub use color::ClearColor;
pub use video::{VideoFrame, VideoPixels};
pub use geometry::{easing_progress, fit_uv, rotated_bounds, FrameRect, UvRect};
pub use renderer::{
    create_window_surface, scene_clear_color, spike_scene, surface_action, FrameTiming,
    PendingSurface, PreviewFrame, PreviewRenderer, RenderStats, SurfaceAction, SurfaceFactory,
    SurfaceRenderer,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub schema_version: u32,
    pub revision: u64,
    pub role: SceneRole,
    pub viewport: Viewport,
    #[serde(default)]
    pub color_space: ColorSpace,
    #[serde(default)]
    pub background: Option<Layer>,
    pub layers: Vec<Layer>,
    pub fonts: Vec<SceneFont>,
    pub assets: Vec<SceneAsset>,
    pub safe_area: SafeArea,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SceneRole {
    Audience,
    Stage,
    #[default]
    Preview,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColorSpace {
    #[default]
    Srgb,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
    #[serde(default = "one")]
    pub scale: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct SafeArea {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneFont {
    pub id: String,
    pub family: String,
    pub path: String,
    pub hash: String,
    #[serde(default)]
    pub fallback: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneAsset {
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
pub struct LayerSource {
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
pub enum Layer {
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
        source: LayerSource,
        #[serde(default)]
        fit: LayerFit,
        #[serde(default)]
        radius: f64,
    },
    Video {
        id: String,
        frame: Frame,
        #[serde(default)]
        z: i32,
        #[serde(default = "one")]
        opacity: f64,
        source: LayerSource,
        #[serde(default)]
        fit: LayerFit,
        #[serde(default = "one_bool", rename = "loop")]
        loop_: bool,
        #[serde(default = "one_bool")]
        muted: bool,
        #[serde(default = "one")]
        volume: f64,
        #[serde(default)]
        start_ms: u64,
    },
}

impl Layer {
    pub fn id(&self) -> &str {
        match self {
            Layer::Text { id, .. }
            | Layer::Shape { id, .. }
            | Layer::Image { id, .. }
            | Layer::Video { id, .. } => id,
        }
    }

    pub fn frame(&self) -> Frame {
        match self {
            Layer::Text { frame, .. }
            | Layer::Shape { frame, .. }
            | Layer::Image { frame, .. }
            | Layer::Video { frame, .. } => *frame,
        }
    }

    pub fn z(&self) -> i32 {
        match self {
            Layer::Text { z, .. }
            | Layer::Shape { z, .. }
            | Layer::Image { z, .. }
            | Layer::Video { z, .. } => *z,
        }
    }

    pub fn opacity(&self) -> f64 {
        match self {
            Layer::Text { opacity, .. }
            | Layer::Shape { opacity, .. }
            | Layer::Image { opacity, .. }
            | Layer::Video { opacity, .. } => *opacity,
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
pub enum LayerFit {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewBounds {
    pub element_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Layout data for the editor overlay, in normalized slide coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTextRun {
    pub element_id: String,
    pub line: u32,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub caret_stops: Vec<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub revision: u64,
    pub bounds: Vec<PreviewBounds>,
    pub text_runs: Vec<PreviewTextRun>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransitionPlan {
    pub from_revision: u64,
    pub to_revision: u64,
    pub from: Scene,
    pub to: Scene,
    pub kind: TransitionKind,
    pub duration_ms: u64,
    #[serde(default)]
    pub easing: String,
}

pub trait Renderer {
    fn render(&mut self, scene: &Scene) -> Result<(), RenderError>;
    fn preview(&mut self, scene: &Scene, width: u32, height: u32) -> Result<Vec<u8>, RenderError>;
}

#[derive(Debug)]
pub enum RenderError {
    MissingAsset(String),
    MissingFont(String),
    Backend(String),
    SurfaceLost,
    SurfaceOutdated,
    SurfaceTimeout,
    SurfaceOccluded,
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::MissingAsset(id) => write!(formatter, "missing asset {id}"),
            RenderError::MissingFont(id) => write!(formatter, "missing font {id}"),
            RenderError::Backend(message) => write!(formatter, "render backend: {message}"),
            RenderError::SurfaceLost => write!(formatter, "surface lost"),
            RenderError::SurfaceOutdated => write!(formatter, "surface outdated"),
            RenderError::SurfaceTimeout => write!(formatter, "surface acquire timeout"),
            RenderError::SurfaceOccluded => write!(formatter, "surface occluded"),
        }
    }
}

impl std::error::Error for RenderError {}

const fn one() -> f64 {
    1.0
}

const fn one_bool() -> bool {
    true
}

const fn weight_default() -> u32 {
    400
}

const fn line_height_default() -> f64 {
    1.2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_the_typescript_contract_exactly() {
        let json = r##"{
            "schemaVersion": 1,
            "revision": 7,
            "role": "stage",
            "viewport": { "width": 1920.0, "height": 1080.0, "scale": 1.0 },
            "colorSpace": "srgb",
            "background": {
                "kind": "shape",
                "id": "bg",
                "frame": { "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0, "rotation": 0.0 },
                "z": 0,
                "opacity": 1.0,
                "fill": "#101828",
                "stroke": null,
                "strokeWidth": 0,
                "radius": 12
            },
            "layers": [
                {
                    "kind": "text",
                    "id": "title",
                    "frame": { "x": 0.1, "y": 0.2, "w": 0.8, "h": 0.3, "rotation": 15 },
                    "z": 2,
                    "opacity": 0.9,
                    "runs": [{ "text": "Hello", "bold": true, "italic": false, "underline": true, "color": "#ffffff" }],
                    "fontId": "inter",
                    "fontSize": 64,
                    "weight": 700,
                    "color": "#ffffff",
                    "align": "left",
                    "vAlign": "bottom",
                    "lineHeight": 1.4,
                    "letterSpacing": 1.5,
                    "fit": "shrink",
                    "padding": 8,
                    "maxLines": 3,
                    "shadow": { "color": "#00000080", "blur": 4, "offsetX": 1, "offsetY": 2 },
                    "outline": { "color": "#000000", "width": 2 }
                },
                {
                    "kind": "image",
                    "id": "photo",
                    "frame": { "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0, "rotation": 0 },
                    "z": 1,
                    "opacity": 1.0,
                    "source": { "assetId": "asset_photo", "hash": "photo-hash" },
                    "fit": "contain",
                    "radius": 24
                },
                {
                    "kind": "video",
                    "id": "clip",
                    "frame": { "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0, "rotation": 0 },
                    "z": 1,
                    "opacity": 1.0,
                    "source": { "assetId": "asset_clip", "hash": "clip-hash" },
                    "fit": "stretch",
                    "loop": false,
                    "muted": true,
                    "volume": 0.5,
                    "startMs": 1200
                }
            ],
            "fonts": [{ "id": "inter", "family": "Inter", "path": "/tmp/Inter.ttf", "hash": "f1", "fallback": ["Helvetica", "Arial"] }],
            "assets": [
                { "id": "asset_photo", "hash": "photo-hash", "kind": "image", "localPath": "/tmp/photo.png", "url": null, "intrinsic": { "width": 1920, "height": 1080 }, "state": "ready" },
                { "id": "asset_clip", "hash": "clip-hash", "kind": "video", "localPath": null, "url": "https://example.test/clip.mp4", "intrinsic": { "width": 1280, "height": 720 }, "state": "missing" }
            ],
            "safeArea": { "top": 0.05, "right": 0.05, "bottom": 0.05, "left": 0.05 }
        }"##;
        let scene: Scene = serde_json::from_str(json).expect("scene");
        assert_eq!(scene.role, SceneRole::Stage);
        assert_eq!(scene.color_space, ColorSpace::Srgb);
        assert_eq!(scene.layers.len(), 3);
        assert_eq!(scene.fonts[0].fallback, vec!["Helvetica", "Arial"]);
        assert_eq!(scene.assets[0].intrinsic.width, 1920.0);
        assert_eq!(scene.assets[1].state, AssetState::Missing);
        assert_eq!(scene.layers[0].frame().rotation, 15.0);
        match &scene.layers[0] {
            Layer::Text {
                fit,
                v_align,
                max_lines,
                weight,
                ..
            } => {
                assert_eq!(*fit, TextFit::Shrink);
                assert_eq!(*v_align, TextVAlign::Bottom);
                assert_eq!(*max_lines, Some(3));
                assert_eq!(*weight, 700);
            }
            other => panic!("expected text layer, got {other:?}"),
        }
        match &scene.layers[1] {
            Layer::Image { fit, radius, .. } => {
                assert_eq!(*fit, LayerFit::Contain);
                assert_eq!(*radius, 24.0);
            }
            other => panic!("expected image layer, got {other:?}"),
        }
        match &scene.layers[2] {
            Layer::Video { loop_, volume, .. } => {
                assert!(!*loop_);
                assert_eq!(*volume, 0.5);
            }
            other => panic!("expected video layer, got {other:?}"),
        }
    }

    #[test]
    fn deserializes_defaults_for_optional_contract_fields() {
        let json = r#"{
            "schemaVersion": 1,
            "revision": 1,
            "role": "audience",
            "viewport": { "width": 1920.0, "height": 1080.0 },
            "layers": [],
            "fonts": [],
            "assets": [],
            "safeArea": { "top": 0.1, "right": 0.1, "bottom": 0.1, "left": 0.1 }
        }"#;
        let scene: Scene = serde_json::from_str(json).expect("scene");
        assert_eq!(scene.color_space, ColorSpace::Srgb);
        assert_eq!(scene.viewport.scale, 1.0);
        assert!(scene.background.is_none());
    }

    #[test]
    fn deserializes_transition_plans() {
        let json = r##"{
            "fromRevision": 1,
            "toRevision": 2,
            "from": {
                "schemaVersion": 1, "revision": 1, "role": "audience",
                "viewport": { "width": 1920.0, "height": 1080.0, "scale": 1.0 },
                "layers": [], "fonts": [], "assets": [],
                "safeArea": { "top": 0.0, "right": 0.0, "bottom": 0.0, "left": 0.0 }
            },
            "to": {
                "schemaVersion": 1, "revision": 2, "role": "audience",
                "viewport": { "width": 1920.0, "height": 1080.0, "scale": 1.0 },
                "layers": [], "fonts": [], "assets": [],
                "safeArea": { "top": 0.0, "right": 0.0, "bottom": 0.0, "left": 0.0 }
            },
            "kind": "dissolve",
            "durationMs": 800,
            "easing": "easeInOut"
        }"##;
        let plan: TransitionPlan = serde_json::from_str(json).expect("plan");
        assert_eq!(plan.kind, TransitionKind::Dissolve);
        assert_eq!(plan.duration_ms, 800);
        assert_eq!(plan.from_revision, 1);
        assert_eq!(plan.to_revision, 2);
    }
}
