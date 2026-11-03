//! Render contract v2 and the wgpu compositor.
//!
//! `Composition` plus `Screen[]` (`packages/schema/src/composition.ts`, `slide.ts` and
//! `screen.ts`) is the only renderer contract. This crate mirrors it exactly in [`composition`]
//! and renders it with wgpu and cosmic-text in [`compositor`].

mod asset;
mod bc;
mod blur;
mod color;
pub mod composition;
pub mod compositor;
pub mod effects;
mod geometry;
pub mod mapping;
mod renderer;
mod slide;
mod text;
mod video;

pub use color::ClearColor;
pub use composition::{
    AssetKind, AssetRef, AssetState, ColorSpace, Composition, CompositionAsset, CompositionFont,
    Fit, Frame, Insets, IntrinsicSize, Screen, SlideElement, TextAlign, TextFit, TextOutline,
    TextRun, TextShadow, TextVAlign, TransitionKind,
};
pub use compositor::{
    CompositionBounds, CompositionPreviewResult, CompositionTextRun, CompositionTransition,
    Compositor, ScreenOutput,
};
pub use geometry::{easing_progress, fit_uv, rotated_bounds, FrameRect, UvRect};
pub use renderer::{
    create_window_surface, surface_action, CompositionFrame, FrameTiming, OffscreenOutput,
    PendingSurface,
    PreviewRenderer, RenderStats, SurfaceAction, SurfaceFactory, SurfaceRenderer,
};
pub use video::{VideoFrame, VideoPixels};

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
