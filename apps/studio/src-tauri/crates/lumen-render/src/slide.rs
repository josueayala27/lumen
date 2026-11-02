//! One `slide` source as the slide renderer draws it, and the editor layout it produces.

use serde::Serialize;

use crate::composition::{CompositionAsset, CompositionFont, Size, SlideElement};

/// A slide source prepared for drawing: its elements (already re-laid out for the screen), the
/// slide size and the composition fonts and assets they use.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct SlidePage {
    pub revision: u64,
    pub size: Size,
    pub elements: Vec<SlideElement>,
    pub fonts: Vec<CompositionFont>,
    pub assets: Vec<CompositionAsset>,
}

/// Box of one slide element, normalized to the slide.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SlideBounds {
    pub element_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One shaped text line of a slide element, normalized to the slide.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SlideTextRun {
    pub element_id: String,
    pub line: u32,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub caret_stops: Vec<f64>,
}

/// Editor layout of a drawn slide, from the same shaping pass as its pixels.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct SlideLayout {
    pub bounds: Vec<SlideBounds>,
    pub text_runs: Vec<SlideTextRun>,
}
