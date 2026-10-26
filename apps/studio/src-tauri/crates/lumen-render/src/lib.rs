//! Scene model and renderer interface.
//!
//! The TypeScript `Scene` in `packages/schema/src/scene.ts` is the contract. This crate mirrors the
//! subset the native renderer needs; wgpu and cosmic-text land in the Phase 0.5 spike.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub schema_version: u32,
    pub revision: u64,
    pub role: SceneRole,
    pub viewport: Viewport,
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

#[derive(Debug, Clone, PartialEq)]
pub struct PreviewBounds {
    pub element_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
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
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::MissingAsset(id) => write!(formatter, "missing asset {id}"),
            RenderError::MissingFont(id) => write!(formatter, "missing font {id}"),
            RenderError::Backend(message) => write!(formatter, "render backend: {message}"),
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
    }
}
