//! Scene model and renderer interface.
//!
//! The TypeScript `Scene` in `packages/schema/src/scene.ts` is the contract. This crate mirrors the
//! subset the native renderer needs; wgpu and cosmic-text land in the Phase 0.5 spike.

use serde::{Deserialize, Serialize};

mod renderer;

pub use renderer::{
    create_window_surface, scene_clear_color, spike_scene, ClearColor, FrameTiming, PendingSurface,
    RenderStats, SurfaceRenderer,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub schema_version: u32,
    pub revision: u64,
    pub role: SceneRole,
    pub viewport: Viewport,
    /// Background layer. Only its color is used by the clear pass in the Phase 0.5 spike.
    #[serde(default)]
    pub background: Option<Layer>,
    pub layers: Vec<Layer>,
    pub fonts: Vec<FontRef>,
    pub assets: Vec<AssetRef>,
    pub safe_area: SafeArea,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SceneRole {
    Audience,
    Stage,
    Preview,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct SafeArea {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontRef {
    pub id: String,
    pub family: String,
    pub path: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    pub id: String,
    pub hash: String,
    pub kind: String,
    pub local_path: Option<String>,
    pub url: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Layer {
    Text {
        id: String,
        frame: Frame,
        z: i32,
        opacity: f64,
        runs: Vec<TextRun>,
        font_id: String,
        font_size: f64,
        color: String,
    },
    Shape {
        id: String,
        frame: Frame,
        z: i32,
        opacity: f64,
        fill: String,
    },
    Image {
        id: String,
        frame: Frame,
        z: i32,
        opacity: f64,
        asset_id: String,
    },
    Video {
        id: String,
        frame: Frame,
        z: i32,
        opacity: f64,
        asset_id: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextRun {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
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

/// Layout data for the editor overlay. Empty until Rust text shaping lands.
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub revision: u64,
    pub bounds: Vec<PreviewBounds>,
    pub text_runs: Vec<PreviewTextRun>,
}

/// The spike has no text shaping, so the layout is intentionally empty.
pub fn empty_preview_result(scene: &Scene) -> PreviewResult {
    PreviewResult {
        revision: scene.revision,
        bounds: Vec::new(),
        text_runs: Vec::new(),
    }
}

/// Fills raw RGBA bytes with the scene background color. No layers are drawn yet.
pub fn render_preview_rgba(scene: &Scene, width: u32, height: u32) -> Vec<u8> {
    let pixel = scene_clear_color(scene).to_rgba8();
    let pixels = (width as usize).saturating_mul(height as usize);
    let mut bytes = Vec::with_capacity(pixels.saturating_mul(4));
    for _ in 0..pixels {
        bytes.extend_from_slice(&pixel);
    }
    bytes
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_a_minimal_scene() {
        let json = r#"{
            "schemaVersion": 1,
            "revision": 3,
            "role": "audience",
            "viewport": { "width": 1920.0, "height": 1080.0, "scale": 1.0 },
            "layers": [],
            "fonts": [],
            "assets": [],
            "safeArea": { "top": 0.05, "right": 0.05, "bottom": 0.05, "left": 0.05 }
        }"#;
        let scene: Scene = serde_json::from_str(json).expect("scene");
        assert_eq!(scene.revision, 3);
        assert_eq!(scene.role, SceneRole::Audience);
        assert!(scene.layers.is_empty());
        assert!(scene.background.is_none());
    }

    #[test]
    fn deserializes_a_background_layer() {
        let json = r##"{
            "schemaVersion": 1,
            "revision": 4,
            "role": "audience",
            "viewport": { "width": 1920.0, "height": 1080.0, "scale": 1.0 },
            "background": {
                "kind": "shape",
                "id": "bg",
                "frame": { "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 },
                "z": 0,
                "opacity": 1.0,
                "fill": "#101828"
            },
            "layers": [],
            "fonts": [],
            "assets": [],
            "safeArea": { "top": 0.05, "right": 0.05, "bottom": 0.05, "left": 0.05 }
        }"##;
        let scene: Scene = serde_json::from_str(json).expect("scene");
        assert!(scene.background.is_some());
    }

    #[test]
    fn preview_fills_background_and_returns_empty_layout() {
        let scene = spike_scene();
        let bytes = render_preview_rgba(&scene, 2, 2);
        assert_eq!(bytes.len(), 16);
        assert_eq!(&bytes[0..4], &[16, 24, 40, 255]);

        let layout = empty_preview_result(&scene);
        assert_eq!(layout.revision, scene.revision);
        assert!(layout.bounds.is_empty());
        assert!(layout.text_runs.is_empty());
    }

    #[test]
    fn preview_is_empty_for_zero_size() {
        assert!(render_preview_rgba(&spike_scene(), 0, 10).is_empty());
    }
}
