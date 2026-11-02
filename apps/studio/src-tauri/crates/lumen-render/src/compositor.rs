//! Composition renderer (render contract v2).
//!
//! Per frame: render each used source once into its own texture, then blend each enabled layer
//! onto the canvas with its fit, transform, effects chain, mask, opacity and blend mode, run the
//! master chain, and draw the screen stage (region, background, warp, edge blend, output masks,
//! colour, test pattern, blackout) into the output. Every intermediate texture holds
//! premultiplied linear RGBA in `Rgba16Float`; blending happens in WGSL with ping-pong targets.
//! See docs/architecture/02-render-contract.md and 10-screens-and-mapping.md.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use wgpu::util::DeviceExt;

use crate::composition::{
    BlendMode, Composition, CompositionLayer, Effect, EffectKind, GradientKind, Mask, Screen,
    Source,
};
use crate::effects::{effect_params, generator_params, linear_color, Generator, ParamBlock};
use crate::geometry::{easing_progress, fit_uv, UvRect};
use crate::mapping::{
    canvas_render_size, layer_matches, rect_in_region, resolve_text, slide_elements_for_layout,
    warp_grid, WarpVertex,
};
use crate::renderer::{asset_key, SceneRenderer, MODE_OPAQUE, MODE_YCOCG};
use crate::video::VideoFrame;
use crate::{LayerFit, PreviewResult, RenderError, Scene, SceneRole, TransitionKind, Viewport};

const SHADER: &str = include_str!("compositor.wgsl");
const SCREEN_SHADER: &str = include_str!("screen.wgsl");
/// Canvas, layer and effect targets.
const WORK_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// Slide sources render through the v1 scene renderer into this format.
const SLIDE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;
/// Largest source texture edge for generators and slides.
const MAX_SOURCE_EDGE: u32 = 4096;
/// Warp grid subdivisions per axis when a corner pin or mesh is set.
const WARP_SEGMENTS: u32 = 32;
const MAX_POLYGON_POINTS: usize = 48;
const MAX_OUTPUT_MASKS: usize = 4;
const MAX_OUTPUT_MASK_POINTS: usize = 14;
const MAX_GRADIENT_STOPS: usize = 8;

type Uniform = [[f32; 4]; 32];
type ScreenUniform = [[f32; 4]; 64];

/// How layer source changes and slide revisions animate. A cut or zero duration switches at once.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionTransition {
    #[serde(default = "cut")]
    pub kind: TransitionKind,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub easing: String,
}

impl Default for CompositionTransition {
    fn default() -> Self {
        Self {
            kind: TransitionKind::Cut,
            duration_ms: 0,
            easing: String::new(),
        }
    }
}

fn cut() -> TransitionKind {
    TransitionKind::Cut
}

impl CompositionTransition {
    fn animates(&self) -> bool {
        self.kind != TransitionKind::Cut && self.duration_ms > 0
    }
}

/// Editor bounds of a layer or slide element, normalized to the screen output before mapping.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionBounds {
    pub layer_id: String,
    pub source_id: Option<String>,
    /// `None` for the layer box itself.
    pub element_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One shaped text line of a slide source, normalized to the screen output before mapping.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionTextRun {
    pub layer_id: String,
    pub source_id: String,
    pub element_id: String,
    pub line: u32,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub caret_stops: Vec<f64>,
}

/// `PreviewResult` for a composition: the v1 shape keyed by layer, source and element.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompositionPreviewResult {
    pub revision: u64,
    pub bounds: Vec<CompositionBounds>,
    pub text_runs: Vec<CompositionTextRun>,
}

#[derive(Clone)]
struct Target {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    width: u32,
    height: u32,
}

#[derive(Clone)]
struct SourceView {
    view: wgpu::TextureView,
    width: u32,
    height: u32,
    /// Slides and generators are rendered at the layer box size and stretch to it.
    stretch: bool,
}

struct CachedSource {
    target: Target,
    key: u64,
}

struct SlideCache {
    key: u64,
    revision: u64,
    target: Target,
    layout: PreviewResult,
    previous: Option<(Target, f64)>,
}

struct LayerFade {
    current: Option<String>,
    previous: Option<String>,
    started: f64,
}

fn hash_of<T: Hash>(value: T) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn header(code: f32, time: f32, width: u32, height: u32, extra: f32) -> Uniform {
    let mut uniform = [[0.0; 4]; 32];
    let (w, h) = (width.max(1) as f32, height.max(1) as f32);
    uniform[0] = [code, time, w / h, extra];
    uniform[1] = [1.0 / w, 1.0 / h, w, h];
    uniform
}

fn with_block(mut uniform: Uniform, block: &ParamBlock) -> Uniform {
    uniform[2..6].copy_from_slice(block);
    uniform
}

fn blend_code(blend: BlendMode) -> f32 {
    match blend {
        BlendMode::Normal => 0.0,
        BlendMode::Add => 1.0,
        BlendMode::Screen => 2.0,
        BlendMode::Multiply => 3.0,
        BlendMode::Overlay => 4.0,
        BlendMode::Difference => 5.0,
        BlendMode::Alpha => 6.0,
    }
}

fn effect_entry(kind: EffectKind) -> &'static str {
    match kind {
        EffectKind::Color => "fs_color",
        EffectKind::Blur => "fs_blur",
        EffectKind::Key => "fs_key",
        EffectKind::Transform => "fs_transform",
        EffectKind::Kaleidoscope => "fs_kaleidoscope",
        EffectKind::Feedback => "fs_feedback",
    }
}

fn transition_code(kind: TransitionKind) -> f32 {
    match kind {
        TransitionKind::Cut => 0.0,
        TransitionKind::Fade => 1.0,
        TransitionKind::Dissolve => 2.0,
        TransitionKind::Slide => 3.0,
        TransitionKind::Zoom => 4.0,
    }
}

fn uv_array(uv: UvRect) -> [f32; 4] {
    [uv.u0, uv.v0, uv.u1, uv.v1]
}

/// Box size of a layer in canvas render pixels, for generators and slides.
fn box_pixels(layer: &CompositionLayer, canvas_w: u32, canvas_h: u32) -> (u32, u32) {
    let edge = |value: f64, size: u32| {
        ((value.abs() * f64::from(size)).round() as u32).clamp(1, MAX_SOURCE_EDGE)
    };
    (
        edge(layer.transform.w, canvas_w),
        edge(layer.transform.h, canvas_h),
    )
}

/// Renders compositions and screens on one wgpu device.
pub struct Compositor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    slides: SceneRenderer,
    bind_layout: wgpu::BindGroupLayout,
    pipeline_layout: wgpu::PipelineLayout,
    module: wgpu::ShaderModule,
    screen_module: wgpu::ShaderModule,
    pipelines: HashMap<(&'static str, wgpu::TextureFormat), wgpu::RenderPipeline>,
    screen_pipelines: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
    sampler: wgpu::Sampler,
    blank: Target,
    pool: Vec<Target>,
    cached: HashMap<String, CachedSource>,
    slide_cache: HashMap<String, SlideCache>,
    fades: HashMap<String, LayerFade>,
    feedback: HashMap<String, Target>,
    video_seq: HashMap<String, u64>,
    transition: CompositionTransition,
    started: Instant,
    clock: Option<f64>,
    warned: HashSet<String>,
}

/// Per-frame state shared by the source and layer passes.
struct FrameContext<'a> {
    composition: &'a Composition,
    screen: &'a Screen,
    canvas_w: u32,
    canvas_h: u32,
    now: f64,
}

impl Compositor {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let texture_entry = |binding: u32| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("lumen-compositor-bind-layout"),
            entries: &[
                texture_entry(0),
                texture_entry(1),
                texture_entry(2),
                texture_entry(3),
                texture_entry(4),
                wgpu::BindGroupLayoutEntry {
                    binding: 5,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 6,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("lumen-compositor-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_layout)],
            immediate_size: 0,
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("lumen-compositor-shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let screen_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("lumen-screen-shader"),
            source: wgpu::ShaderSource::Wgsl(SCREEN_SHADER.into()),
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("lumen-compositor-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let blank = create_target(&device, "lumen-blank", 1, 1, WORK_FORMAT);
        let slides = SceneRenderer::for_slides(device.clone(), queue.clone(), SLIDE_FORMAT);
        Self {
            device,
            queue,
            slides,
            bind_layout,
            pipeline_layout,
            module,
            screen_module,
            pipelines: HashMap::new(),
            screen_pipelines: HashMap::new(),
            sampler,
            blank,
            pool: Vec::new(),
            cached: HashMap::new(),
            slide_cache: HashMap::new(),
            fades: HashMap::new(),
            feedback: HashMap::new(),
            video_seq: HashMap::new(),
            transition: CompositionTransition::default(),
            started: Instant::now(),
            clock: None,
            warned: HashSet::new(),
        }
    }

    /// Transition used for the next layer source changes and slide revisions.
    pub fn set_transition(&mut self, transition: CompositionTransition) {
        self.transition = transition;
    }

    /// Fixes the generator and transition clock (seconds); `None` follows wall time.
    pub fn set_clock(&mut self, seconds: Option<f64>) {
        self.clock = seconds;
    }

    fn now(&self) -> f64 {
        self.clock
            .unwrap_or_else(|| self.started.elapsed().as_secs_f64())
    }

    pub fn bc_supported(&self) -> bool {
        self.slides.bc_supported
    }

    /// Uploads a decoded video frame for every source that plays this asset.
    pub fn update_video(&mut self, asset_id: &str, frame: &VideoFrame) -> Result<(), RenderError> {
        self.slides.update_video(asset_id, frame)?;
        *self.video_seq.entry(asset_id.to_string()).or_default() += 1;
        Ok(())
    }

    fn warn_once(&mut self, key: String, message: impl FnOnce() -> String) {
        if self.warned.insert(key) {
            eprintln!("lumen-render: {}", message());
        }
    }

    fn take(&mut self, width: u32, height: u32) -> Target {
        if let Some(index) = self
            .pool
            .iter()
            .position(|target| target.width == width && target.height == height)
        {
            return self.pool.swap_remove(index);
        }
        create_target(&self.device, "lumen-work", width, height, WORK_FORMAT)
    }

    fn give(&mut self, target: Target) {
        // Keep the pool bounded across resizes.
        if self.pool.len() >= 24 {
            self.pool.remove(0);
        }
        self.pool.push(target);
    }

    fn pipeline(&mut self, entry: &'static str, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        if let Some(pipeline) = self.pipelines.get(&(entry, format)) {
            return pipeline.clone();
        }
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&self.pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &self.module,
                    entry_point: Some("vs_full"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &self.module,
                    entry_point: Some(entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        self.pipelines.insert((entry, format), pipeline.clone());
        pipeline
    }

    fn screen_pipeline(&mut self, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        if let Some(pipeline) = self.screen_pipelines.get(&format) {
            return pipeline.clone();
        }
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("lumen-screen-pipeline"),
                layout: Some(&self.pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &self.screen_module,
                    entry_point: Some("vs_screen"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[Some(wgpu::VertexBufferLayout {
                        array_stride: 16,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &[
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x2,
                                offset: 0,
                                shader_location: 0,
                            },
                            wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x2,
                                offset: 8,
                                shader_location: 1,
                            },
                        ],
                    })],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &self.screen_module,
                    entry_point: Some("fs_screen"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        self.screen_pipelines.insert(format, pipeline.clone());
        pipeline
    }

    fn bind_group(&self, textures: [Option<&wgpu::TextureView>; 5], uniform: &[u8]) -> wgpu::BindGroup {
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("lumen-compositor-uniform"),
                contents: uniform,
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let view = |index: usize| textures[index].unwrap_or(&self.blank.view);
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("lumen-compositor-bind-group"),
            layout: &self.bind_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(view(0)),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(view(1)),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(view(2)),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(view(3)),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::TextureView(view(4)),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: wgpu::BindingResource::Buffer(buffer.as_entire_buffer_binding()),
                },
            ],
        })
    }

    /// One full-screen pass of `compositor.wgsl` into `target`.
    fn pass(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        entry: &'static str,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        textures: [Option<&wgpu::TextureView>; 5],
        uniform: &Uniform,
    ) {
        let pipeline = self.pipeline(entry, format);
        let bind_group = self.bind_group(textures, bytemuck::cast_slice(uniform.as_slice()));
        let mut pass = begin_pass(encoder, target, entry);
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    fn clear(&self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView) {
        drop(begin_pass(encoder, target, "lumen-compositor-clear"));
    }

    /// Renders `composition` through `screen` into `output` (`width × height`, `format`).
    /// Use [`Screen::canvas`] to render the bare canvas.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        composition: &Composition,
        screen: &Screen,
        output: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) -> Result<CompositionPreviewResult, RenderError> {
        let now = self.now();
        let layout = &screen.layout;
        let region = layout.region;
        let (canvas_w, canvas_h) = canvas_render_size(composition.canvas, region, width, height);
        let ctx = FrameContext {
            composition,
            screen,
            canvas_w,
            canvas_h,
            now,
        };
        let mut preview = CompositionPreviewResult {
            revision: composition.revision,
            ..CompositionPreviewResult::default()
        };
        self.slides.load_image_assets(&composition.assets);
        self.forget_removed(composition);

        let canvas = if screen.enabled && !screen.blackout && screen.test_pattern.is_none() {
            Some(self.render_canvas(encoder, &ctx, &mut preview)?)
        } else {
            None
        };
        self.draw_screen(encoder, screen, canvas.as_ref(), output, format, width, height);
        if let Some(canvas) = canvas {
            self.give(canvas);
        }
        Ok(preview)
    }

    fn forget_removed(&mut self, composition: &Composition) {
        let sources: HashSet<&str> = composition.sources.iter().map(Source::id).collect();
        let layers: HashSet<&str> = composition
            .layers
            .iter()
            .map(|layer| layer.id.as_str())
            .collect();
        self.slide_cache
            .retain(|id, _| sources.contains(id.as_str()));
        self.cached.retain(|id, _| {
            id.split_once(':')
                .is_none_or(|(kind, rest)| kind != "source" || sources.contains(rest))
        });
        self.fades.retain(|id, _| layers.contains(id.as_str()));
        self.feedback.retain(|key, _| {
            key.split_once('/')
                .is_none_or(|(owner, _)| owner == "master" || layers.contains(owner))
        });
    }

    fn render_canvas(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        ctx: &FrameContext<'_>,
        preview: &mut CompositionPreviewResult,
    ) -> Result<Target, RenderError> {
        let (canvas_w, canvas_h) = (ctx.canvas_w, ctx.canvas_h);
        let composition = ctx.composition;
        let filter = &ctx.screen.layout.layers;
        let mut frame_sources: HashMap<String, Option<SourceView>> = HashMap::new();
        let mut borrowed: Vec<Target> = Vec::new();
        let mut current = self.take(canvas_w, canvas_h);
        self.clear(encoder, &current.view);
        let mut under: Option<Target> = None;

        for layer in &composition.layers {
            if !layer.enabled || layer.opacity <= 0.0 || !layer_matches(filter, layer) {
                continue;
            }
            let (active, previous, fade) = self.layer_fade(layer, ctx.now);
            let source_a = match &active {
                Some(id) => self.source_view(encoder, ctx, id, layer, &mut frame_sources, &mut borrowed, preview)?,
                None => None,
            };
            let source_b = match (&previous, fade < 1.0) {
                (Some(id), true) => self.source_view(encoder, ctx, id, layer, &mut frame_sources, &mut borrowed, preview)?,
                _ => None,
            };
            if source_a.is_none() && source_b.is_none() {
                continue;
            }
            preview.bounds.push(layer_bounds(layer, active.as_deref(), ctx));

            let effects = self.known_effects(&layer.id, &layer.effects);
            let (box_w, box_h) = (
                (layer.transform.w.abs() * f64::from(canvas_w)) as f32,
                (layer.transform.h.abs() * f64::from(canvas_h)) as f32,
            );
            let fit_rect = |view: &SourceView| {
                let fit = if view.stretch { LayerFit::Stretch } else { layer.fit };
                fit_uv(fit, box_w, box_h, view.width as f32, view.height as f32)
            };
            let mut uniform = [[0.0f32; 4]; 32];
            let uv_a = source_a.as_ref().map(fit_rect);
            let uv_b = source_b.as_ref().map(fit_rect);
            let full = UvRect {
                u0: 0.0,
                v0: 0.0,
                u1: 1.0,
                v1: 1.0,
                discard_outside: false,
            };
            let mix_b = if source_b.is_some() {
                if source_a.is_some() {
                    1.0 - fade as f32
                } else {
                    1.0
                }
            } else {
                0.0
            };
            // A layer fading out to nothing scales its opacity instead.
            let fade_out = if source_a.is_none() { 1.0 - fade as f32 } else { 1.0 };
            uniform[0] = [blend_code(layer.blend), layer.opacity.clamp(0.0, 1.0) as f32 * fade_out, mix_b, 0.0];
            let transform = &layer.transform;
            uniform[1] = [
                transform.x as f32,
                transform.y as f32,
                transform.w as f32,
                transform.h as f32,
            ];
            uniform[2] = [
                (transform.rotation as f32).to_radians(),
                transform.anchor_x as f32,
                transform.anchor_y as f32,
                canvas_w as f32 / canvas_h.max(1) as f32,
            ];
            uniform[3] = uv_array(uv_a.unwrap_or(full));
            uniform[4] = uv_array(uv_b.unwrap_or(full));
            let discard = |uv: Option<UvRect>| f32::from(u8::from(uv.is_some_and(|uv| uv.discard_outside)));
            uniform[5] = [discard(uv_a), discard(uv_b), 0.0, 0.0];
            let mask_view = self.write_mask(encoder, ctx, layer, &mut uniform)?;
            uniform[7][3] = f32::from(u8::from(under.is_some()));

            let a_view = source_a.as_ref().map(|view| view.view.clone());
            let b_view = source_b.as_ref().map(|view| view.view.clone());
            let processed = if effects.is_empty() {
                None
            } else {
                let mut place = uniform;
                place[0][0] = 99.0;
                let content = self.take(canvas_w, canvas_h);
                self.pass(
                    encoder,
                    "fs_layer",
                    &content.view,
                    WORK_FORMAT,
                    [None, a_view.as_ref(), b_view.as_ref(), None, None],
                    &place,
                );
                Some(self.run_effects(encoder, content, &effects, &layer.id, ctx))
            };
            if processed.is_some() {
                uniform[0][3] = 1.0;
            }
            let next = self.take(canvas_w, canvas_h);
            let layer_view = processed.as_ref().map(|target| target.view.clone()).or(a_view);
            self.pass(
                encoder,
                "fs_layer",
                &next.view,
                WORK_FORMAT,
                [
                    Some(&current.view),
                    layer_view.as_ref(),
                    b_view.as_ref(),
                    mask_view.as_ref(),
                    under.as_ref().map(|target| &target.view),
                ],
                &uniform,
            );
            if let Some(processed) = processed {
                self.give(processed);
            }
            if let Some(old) = under.replace(current) {
                self.give(old);
            }
            current = next;
        }
        if let Some(old) = under {
            self.give(old);
        }

        // Master chain, then master opacity.
        let master = &composition.master;
        let effects = self.known_effects("master", &master.effects);
        if !effects.is_empty() {
            current = self.run_effects(encoder, current, &effects, "master", ctx);
        }
        if master.opacity < 1.0 {
            let out = self.take(canvas_w, canvas_h);
            let mut uniform = header(0.0, ctx.now as f32, canvas_w, canvas_h, 0.0);
            uniform[2][0] = master.opacity.max(0.0) as f32;
            self.pass(encoder, "fs_opacity", &out.view, WORK_FORMAT, [Some(&current.view), None, None, None, None], &uniform);
            self.give(current);
            current = out;
        }
        for target in borrowed {
            self.give(target);
        }
        Ok(current)
    }

    /// Updates the crossfade state of a layer. Returns the active source, the source fading out
    /// and the eased progress (1 when settled).
    fn layer_fade(&mut self, layer: &CompositionLayer, now: f64) -> (Option<String>, Option<String>, f64) {
        let transition = self.transition.clone();
        let state = self.fades.entry(layer.id.clone()).or_insert_with(|| LayerFade {
            current: layer.source_id.clone(),
            previous: None,
            started: now,
        });
        if state.current != layer.source_id {
            state.previous = if transition.duration_ms > 0 && transition.kind != TransitionKind::Cut {
                state.current.take()
            } else {
                None
            };
            state.current = layer.source_id.clone();
            state.started = now;
        }
        let progress = if state.previous.is_some() && transition.duration_ms > 0 {
            ((now - state.started) * 1000.0 / transition.duration_ms as f64).clamp(0.0, 1.0)
        } else {
            1.0
        };
        if progress >= 1.0 {
            state.previous = None;
        }
        (
            state.current.clone(),
            state.previous.clone(),
            easing_progress(&transition.easing, progress),
        )
    }

    fn known_effects(&mut self, owner: &str, effects: &[Effect]) -> Vec<(EffectKind, Effect)> {
        let mut known = Vec::new();
        for effect in effects.iter().filter(|effect| effect.enabled) {
            match effect.effect_kind() {
                Some(kind) => known.push((kind, effect.clone())),
                None => self.warn_once(format!("effect:{}", effect.kind), || {
                    format!("skipping unknown effect kind `{}` on {owner}", effect.kind)
                }),
            }
        }
        known
    }

    fn run_effects(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        input: Target,
        effects: &[(EffectKind, Effect)],
        owner: &str,
        ctx: &FrameContext<'_>,
    ) -> Target {
        let (width, height) = (input.width, input.height);
        let pixel_scale = width as f32 / ctx.composition.canvas.width.max(1.0) as f32;
        let mut current = input;
        for (kind, effect) in effects {
            let block = effect_params(*kind, &effect.params);
            let uniform = with_block(header(0.0, ctx.now as f32, width, height, 0.0), &block);
            match kind {
                EffectKind::Blur => {
                    let mut horizontal = uniform;
                    horizontal[2][0] *= pixel_scale;
                    let temp = self.take(width, height);
                    self.pass(encoder, "fs_blur", &temp.view, WORK_FORMAT, [Some(&current.view), None, None, None, None], &horizontal);
                    let mut vertical = horizontal;
                    vertical[0][3] = 1.0;
                    self.pass(encoder, "fs_blur", &current.view, WORK_FORMAT, [Some(&temp.view), None, None, None, None], &vertical);
                    self.give(temp);
                }
                EffectKind::Feedback => {
                    let key = format!("{owner}/{}", effect.id);
                    let history = match self.feedback.remove(&key) {
                        Some(target) if target.width == width && target.height == height => target,
                        _ => create_target(&self.device, "lumen-feedback", width, height, WORK_FORMAT),
                    };
                    let out = self.take(width, height);
                    self.pass(encoder, "fs_feedback", &out.view, WORK_FORMAT, [Some(&current.view), Some(&history.view), None, None, None], &uniform);
                    encoder.copy_texture_to_texture(
                        out.texture.as_image_copy(),
                        history.texture.as_image_copy(),
                        wgpu::Extent3d {
                            width,
                            height,
                            depth_or_array_layers: 1,
                        },
                    );
                    self.feedback.insert(key, history);
                    self.give(current);
                    current = out;
                }
                _ => {
                    let out = self.take(width, height);
                    self.pass(encoder, effect_entry(*kind), &out.view, WORK_FORMAT, [Some(&current.view), None, None, None, None], &uniform);
                    self.give(current);
                    current = out;
                }
            }
        }
        current
    }

    /// Fills the mask fields of a layer uniform and returns the image mask texture, if any.
    fn write_mask(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        ctx: &FrameContext<'_>,
        layer: &CompositionLayer,
        uniform: &mut Uniform,
    ) -> Result<Option<wgpu::TextureView>, RenderError> {
        match &layer.mask {
            None => Ok(None),
            Some(Mask::Rect {
                x,
                y,
                w,
                h,
                radius,
                feather,
                invert,
            }) => {
                uniform[5][2] = 1.0;
                uniform[5][3] = f32::from(u8::from(*invert));
                uniform[6] = [*x as f32, *y as f32, *w as f32, *h as f32];
                uniform[7][0] = *radius as f32;
                uniform[7][1] = *feather as f32;
                Ok(None)
            }
            Some(Mask::Polygon {
                points,
                feather,
                invert,
            }) => {
                if points.len() > MAX_POLYGON_POINTS {
                    self.warn_once(format!("polygon:{}", layer.id), || {
                        format!("layer {} mask keeps the first {MAX_POLYGON_POINTS} polygon points", layer.id)
                    });
                }
                let count = points.len().min(MAX_POLYGON_POINTS);
                uniform[5][2] = 2.0;
                uniform[5][3] = f32::from(u8::from(*invert));
                uniform[7][1] = *feather as f32;
                uniform[7][2] = count as f32;
                for (index, point) in points.iter().take(count).enumerate() {
                    let slot = &mut uniform[8 + index / 2];
                    slot[(index % 2) * 2] = point[0] as f32;
                    slot[(index % 2) * 2 + 1] = point[1] as f32;
                }
                Ok(None)
            }
            Some(Mask::Image { asset, invert }) => {
                let view = ctx
                    .composition
                    .asset(&asset.asset_id)
                    .and_then(|scene_asset| self.image_view(encoder, &scene_asset.id, &scene_asset.hash));
                if view.is_none() {
                    // Missing mask image: hide nothing rather than everything.
                    return Ok(None);
                }
                uniform[5][2] = 3.0;
                uniform[5][3] = f32::from(u8::from(*invert));
                Ok(view.map(|view| view.view))
            }
        }
    }

    /// Converted image texture (premultiplied linear), cached per asset.
    fn image_view(&mut self, encoder: &mut wgpu::CommandEncoder, asset_id: &str, hash: &str) -> Option<SourceView> {
        let key = asset_key(asset_id, hash);
        let content_key = hash_of(&key);
        let cache_key = format!("image:{key}");
        if let Some(cached) = self.cached.get(&cache_key).filter(|cached| cached.key == content_key) {
            return Some(SourceView {
                view: cached.target.view.clone(),
                width: cached.target.width,
                height: cached.target.height,
                stretch: false,
            });
        }
        let (view, width, height) = {
            let image = self.slides.images.get(&key)?;
            (image.view.clone(), image.width, image.height)
        };
        let target = create_target(&self.device, "lumen-image-source", width, height, WORK_FORMAT);
        let mut uniform = header(0.0, 0.0, width, height, 0.0);
        uniform[2] = [1.0, 1.0, 0.0, 0.0];
        self.pass(encoder, "fs_convert", &target.view, WORK_FORMAT, [Some(&view), None, None, None, None], &uniform);
        let source = SourceView {
            view: target.view.clone(),
            width,
            height,
            stretch: false,
        };
        self.cached.insert(cache_key, CachedSource { target, key: content_key });
        Some(source)
    }

    /// The texture of one source this frame, rendered at most once per frame.
    #[allow(clippy::too_many_arguments)]
    fn source_view(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        ctx: &FrameContext<'_>,
        source_id: &str,
        layer: &CompositionLayer,
        frame_sources: &mut HashMap<String, Option<SourceView>>,
        borrowed: &mut Vec<Target>,
        preview: &mut CompositionPreviewResult,
    ) -> Result<Option<SourceView>, RenderError> {
        if let Some(view) = frame_sources.get(source_id) {
            // Slide layouts are reported per layer.
            if let Some(Source::Slide { .. }) = ctx.composition.source(source_id) {
                self.report_slide(source_id, layer, ctx, preview);
            }
            return Ok(view.clone());
        }
        let Some(source) = ctx.composition.source(source_id) else {
            self.warn_once(format!("missing-source:{source_id}"), || {
                format!("layer {} uses unknown source {source_id}", layer.id)
            });
            return Ok(None);
        };
        let view = match source {
            Source::Solid { color, .. } => {
                let mut block = [[0.0; 4]; 4];
                block[0] = linear_color(color).unwrap_or([0.0, 0.0, 0.0, 1.0]);
                Some(self.generated(encoder, source_id, 0.0, &block, (4, 4), hash_of(color), ctx.now))
            }
            Source::Gradient {
                gradient,
                stops,
                angle,
                ..
            } => {
                let size = box_pixels(layer, ctx.canvas_w, ctx.canvas_h);
                let code = if *gradient == GradientKind::Radial { 2.0 } else { 1.0 };
                let key = hash_of((serde_json::to_string(source).unwrap_or_default(), size));
                Some(self.gradient(encoder, source_id, code, stops, *angle, size, key))
            }
            Source::Shader {
                shader_id, params, ..
            } => match Generator::parse(shader_id) {
                Some(generator) => {
                    let size = box_pixels(layer, ctx.canvas_w, ctx.canvas_h);
                    let block = generator_params(generator, params);
                    // Animated: the key changes every frame.
                    let key = hash_of((ctx.now.to_bits(), serde_json::to_string(params).unwrap_or_default(), size));
                    Some(self.generated(encoder, source_id, generator as u32 as f32, &block, size, key, ctx.now))
                }
                None => {
                    self.warn_once(format!("shader:{shader_id}"), || {
                        format!("skipping unknown shader generator `{shader_id}`")
                    });
                    None
                }
            },
            Source::Image { asset, .. } => ctx
                .composition
                .asset(&asset.asset_id)
                .and_then(|scene_asset| self.image_view(encoder, &scene_asset.id, &scene_asset.hash)),
            Source::Video { asset, .. } => self.video_view(encoder, source_id, &asset.asset_id),
            Source::Slide { .. } => {
                let view = self.slide_view(encoder, ctx, source, layer, borrowed)?;
                self.report_slide(source_id, layer, ctx, preview);
                view
            }
            Source::Ndi { .. } | Source::Camera { .. } => {
                self.warn_once(format!("capture:{source_id}"), || {
                    format!("source {source_id} is a capture source; capture lands in Wave E3")
                });
                None
            }
        };
        frame_sources.insert(source_id.to_string(), view.clone());
        Ok(view)
    }

    /// Solid colour or shader generator into a cached per-source texture.
    #[allow(clippy::too_many_arguments)]
    fn generated(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        source_id: &str,
        code: f32,
        block: &ParamBlock,
        (width, height): (u32, u32),
        key: u64,
        now: f64,
    ) -> SourceView {
        let cache_key = format!("source:{source_id}");
        let fresh = self
            .cached
            .get(&cache_key)
            .is_some_and(|cached| cached.key == key && cached.target.width == width && cached.target.height == height);
        if !fresh {
            let target = match self.cached.remove(&cache_key) {
                Some(cached) if cached.target.width == width && cached.target.height == height => cached.target,
                _ => create_target(&self.device, "lumen-generator", width, height, WORK_FORMAT),
            };
            let uniform = with_block(header(code, now as f32, width, height, 0.0), block);
            self.pass(encoder, "fs_generator", &target.view, WORK_FORMAT, [None, None, None, None, None], &uniform);
            self.cached.insert(cache_key.clone(), CachedSource { target, key });
        }
        let target = &self.cached[&cache_key].target;
        SourceView {
            view: target.view.clone(),
            width,
            height,
            stretch: true,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn gradient(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        source_id: &str,
        code: f32,
        stops: &[crate::composition::PaintStop],
        angle: f64,
        (width, height): (u32, u32),
        key: u64,
    ) -> SourceView {
        let cache_key = format!("source:{source_id}");
        let fresh = self.cached.get(&cache_key).is_some_and(|cached| cached.key == key);
        if !fresh {
            let target = create_target(&self.device, "lumen-gradient", width, height, WORK_FORMAT);
            let mut uniform = header(code, 0.0, width, height, 0.0);
            let mut sorted: Vec<&crate::composition::PaintStop> = stops.iter().collect();
            sorted.sort_by(|a, b| a.at.total_cmp(&b.at));
            let count = sorted.len().min(MAX_GRADIENT_STOPS);
            uniform[2] = [count as f32, (angle as f32).to_radians(), 0.0, 0.0];
            for (index, stop) in sorted.iter().take(count).enumerate() {
                uniform[3 + index / 4][index % 4] = stop.at.clamp(0.0, 1.0) as f32;
                // sRGB-encoded: stops interpolate in sRGB like CSS gradients.
                uniform[5 + index] = crate::color::ClearColor::parse(&stop.color)
                    .map(|color| color.to_array())
                    .unwrap_or([0.0, 0.0, 0.0, 1.0]);
            }
            self.pass(encoder, "fs_generator", &target.view, WORK_FORMAT, [None, None, None, None, None], &uniform);
            self.cached.insert(cache_key.clone(), CachedSource { target, key });
        }
        let target = &self.cached[&cache_key].target;
        SourceView {
            view: target.view.clone(),
            width: target.width,
            height: target.height,
            stretch: true,
        }
    }

    /// Latest decoded frame of a video, converted once per new frame.
    fn video_view(&mut self, encoder: &mut wgpu::CommandEncoder, source_id: &str, asset_id: &str) -> Option<SourceView> {
        let (view, width, height, mode, uv_scale) = {
            let video = self.slides.videos.get(asset_id)?;
            (
                video.gpu.view.clone(),
                video.frame_width.max(1),
                video.frame_height.max(1),
                video.mode,
                video.uv_scale(),
            )
        };
        let seq = self.video_seq.get(asset_id).copied().unwrap_or(0);
        let cache_key = format!("source:{source_id}");
        let fresh = self.cached.get(&cache_key).is_some_and(|cached| {
            cached.key == seq && cached.target.width == width && cached.target.height == height
        });
        if !fresh {
            let target = match self.cached.remove(&cache_key) {
                Some(cached) if cached.target.width == width && cached.target.height == height => cached.target,
                _ => create_target(&self.device, "lumen-video-source", width, height, WORK_FORMAT),
            };
            let code = if (mode - MODE_YCOCG).abs() < 0.1 {
                3.0
            } else if (mode - MODE_OPAQUE).abs() < 0.1 {
                1.0
            } else {
                0.0
            };
            let mut uniform = header(code, 0.0, width, height, 0.0);
            uniform[2] = [uv_scale.0, uv_scale.1, 0.0, 0.0];
            self.pass(encoder, "fs_convert", &target.view, WORK_FORMAT, [Some(&view), None, None, None, None], &uniform);
            self.cached.insert(cache_key.clone(), CachedSource { target, key: seq });
        }
        let target = &self.cached[&cache_key].target;
        Some(SourceView {
            view: target.view.clone(),
            width,
            height,
            stretch: false,
        })
    }

    /// Lays out and draws a slide source at the layer box size; re-renders only on change and
    /// runs the slide transition on a revision change.
    fn slide_view(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        ctx: &FrameContext<'_>,
        source: &Source,
        layer: &CompositionLayer,
        borrowed: &mut Vec<Target>,
    ) -> Result<Option<SourceView>, RenderError> {
        let Source::Slide {
            id,
            revision,
            elements,
            safe_area,
            size,
            ..
        } = source
        else {
            return Ok(None);
        };
        let text = resolve_text(&ctx.screen.layout);
        let scene = Scene {
            schema_version: 1,
            revision: *revision,
            role: SceneRole::Preview,
            viewport: Viewport {
                width: size.width.max(1.0),
                height: size.height.max(1.0),
                scale: 1.0,
            },
            color_space: ctx.composition.color_space,
            background: None,
            layers: slide_elements_for_layout(
                elements,
                &layer.transform,
                ctx.composition.canvas,
                *size,
                &text,
                ctx.screen.layout.region,
            ),
            fonts: ctx.composition.fonts.clone(),
            assets: ctx.composition.assets.clone(),
            safe_area: *safe_area,
        };
        let (width, height) = box_pixels(layer, ctx.canvas_w, ctx.canvas_h);
        let key = hash_of((serde_json::to_string(&scene).unwrap_or_default(), width, height));
        let stale = self.slide_cache.get(id).is_none_or(|cached| cached.key != key);
        if stale {
            let target = create_target(&self.device, "lumen-slide-source", width, height, SLIDE_FORMAT);
            // The slide renderer writes its glyph atlas through the queue, so each slide is
            // drawn and submitted on its own before the next one reuses the atlas.
            self.slides.invalidate();
            let mut slide_encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("lumen-slide-source"),
                });
            self.slides.draw(&mut slide_encoder, &target.view, &scene, width, height)?;
            self.queue.submit([slide_encoder.finish()]);
            let layout = self.slides.preview_result().clone();
            let previous = match self.slide_cache.remove(id) {
                Some(old) if old.revision != *revision && self.transition.animates() => {
                    Some((old.target, ctx.now))
                }
                Some(old) => old.previous,
                None => None,
            };
            self.slide_cache.insert(
                id.clone(),
                SlideCache {
                    key,
                    revision: *revision,
                    target,
                    layout,
                    previous,
                },
            );
        }
        let transition = self.transition.clone();
        let Some(cached) = self.slide_cache.get_mut(id) else {
            return Ok(None);
        };
        let current = cached.target.clone();
        let progress = cached.previous.as_ref().map(|(_, started)| {
            ((ctx.now - started) * 1000.0 / transition.duration_ms.max(1) as f64).clamp(0.0, 1.0)
        });
        let from = match progress {
            Some(progress) if progress < 1.0 => cached.previous.as_ref().map(|(target, _)| target.clone()),
            Some(_) => {
                cached.previous = None;
                None
            }
            None => None,
        };
        let Some(from) = from else {
            return Ok(Some(SourceView {
                view: current.view,
                width: current.width,
                height: current.height,
                stretch: true,
            }));
        };
        let out = self.take(current.width, current.height);
        let mut uniform = header(0.0, ctx.now as f32, current.width, current.height, 0.0);
        uniform[2] = [
            easing_progress(&transition.easing, progress.unwrap_or(1.0)) as f32,
            transition_code(transition.kind),
            0.0,
            0.0,
        ];
        self.pass(
            encoder,
            "fs_slide_transition",
            &out.view,
            WORK_FORMAT,
            [Some(&from.view), Some(&current.view), None, None, None],
            &uniform,
        );
        let view = SourceView {
            view: out.view.clone(),
            width: out.width,
            height: out.height,
            stretch: true,
        };
        borrowed.push(out);
        Ok(Some(view))
    }

    /// Adds a slide's element bounds and text runs, mapped through the layer box and region.
    fn report_slide(&self, source_id: &str, layer: &CompositionLayer, ctx: &FrameContext<'_>, preview: &mut CompositionPreviewResult) {
        let Some(cached) = self.slide_cache.get(source_id) else {
            return;
        };
        let region = ctx.screen.layout.region;
        let transform = &layer.transform;
        let map = |x: f64, y: f64, w: f64, h: f64| {
            rect_in_region(
                region,
                transform.x + x * transform.w,
                transform.y + y * transform.h,
                w * transform.w,
                h * transform.h,
            )
        };
        for bounds in &cached.layout.bounds {
            let (x, y, width, height) = map(bounds.x, bounds.y, bounds.width, bounds.height);
            preview.bounds.push(CompositionBounds {
                layer_id: layer.id.clone(),
                source_id: Some(source_id.to_string()),
                element_id: Some(bounds.element_id.clone()),
                x,
                y,
                width,
                height,
            });
        }
        for run in &cached.layout.text_runs {
            let (x, y, width, height) = map(run.x, run.y, run.width, run.height);
            let caret_stops = run
                .caret_stops
                .iter()
                .map(|stop| map(*stop, 0.0, 0.0, 0.0).0)
                .collect();
            preview.text_runs.push(CompositionTextRun {
                layer_id: layer.id.clone(),
                source_id: source_id.to_string(),
                element_id: run.element_id.clone(),
                line: run.line,
                text: run.text.clone(),
                x,
                y,
                width,
                height,
                caret_stops,
            });
        }
    }

    /// Region crop, background, warp, edge blend, output masks, colour, test pattern, blackout.
    #[allow(clippy::too_many_arguments)]
    fn draw_screen(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        screen: &Screen,
        canvas: Option<&Target>,
        output: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) {
        let uniform = screen_uniform(screen, width, height);
        // Test patterns and blackout fill the whole output, unwarped.
        let unwarped = crate::composition::Mapping::default();
        let mapping = if canvas.is_some() { &screen.mapping } else { &unwarped };
        let vertices: Vec<[f32; 4]> = warp_grid(mapping, WARP_SEGMENTS)
            .into_iter()
            .map(|WarpVertex { position, uv }| [position[0], position[1], uv[0], uv[1]])
            .collect();
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("lumen-screen-warp"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let pipeline = self.screen_pipeline(format);
        let bind_group = self.bind_group(
            [canvas.map(|target| &target.view), None, None, None, None],
            bytemuck::cast_slice(uniform.as_slice()),
        );
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("lumen-screen-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: output,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.set_vertex_buffer(0, buffer.slice(..));
        pass.draw(0..vertices.len() as u32, 0..1);
    }
}

fn layer_bounds(layer: &CompositionLayer, source_id: Option<&str>, ctx: &FrameContext<'_>) -> CompositionBounds {
    let transform = &layer.transform;
    let bounds = crate::geometry::rotated_bounds(
        crate::Frame {
            x: transform.x,
            y: transform.y,
            w: transform.w,
            h: transform.h,
            rotation: transform.rotation,
        },
        ctx.canvas_w as f32,
        ctx.canvas_h as f32,
    );
    let (x, y, width, height) = rect_in_region(ctx.screen.layout.region, bounds.x, bounds.y, bounds.w, bounds.h);
    CompositionBounds {
        layer_id: layer.id.clone(),
        source_id: source_id.map(str::to_string),
        element_id: None,
        x,
        y,
        width,
        height,
    }
}

/// Screen-stage uniform; layout documented in `screen.wgsl`.
fn screen_uniform(screen: &Screen, width: u32, height: u32) -> ScreenUniform {
    let mut uniform = [[0.0f32; 4]; 64];
    let region = screen.layout.region;
    uniform[0] = [region.x as f32, region.y as f32, region.w as f32, region.h as f32];
    let background = screen
        .layout
        .background
        .as_deref()
        .and_then(linear_color)
        .unwrap_or([0.0, 0.0, 0.0, 1.0]);
    uniform[1] = [background[0], background[1], background[2], 1.0];
    if let Some(blend) = &screen.mapping.edge_blend {
        let sides = [blend.left, blend.right, blend.top, blend.bottom];
        for (index, side) in sides.iter().enumerate() {
            uniform[2][index] = side.width.max(0.0) as f32;
            uniform[3][index] = side.gamma as f32;
            uniform[4][index] = side.power as f32;
        }
    } else {
        uniform[3] = [2.2; 4];
        uniform[4] = [1.0; 4];
    }
    let color = &screen.mapping.color;
    uniform[5] = [color.brightness as f32, color.contrast as f32, color.gamma as f32, 0.0];
    uniform[6] = [color.red as f32, color.green as f32, color.blue as f32, 0.0];
    let pattern = match screen.test_pattern {
        None => 0.0,
        Some(crate::composition::TestPattern::Grid) => 1.0,
        Some(crate::composition::TestPattern::Bars) => 2.0,
        Some(crate::composition::TestPattern::Identify) => 3.0,
    };
    let blackout = screen.blackout || !screen.enabled;
    let masks: Vec<&Mask> = screen
        .mapping
        .masks
        .iter()
        .filter(|mask| !matches!(mask, Mask::Image { .. }))
        .take(MAX_OUTPUT_MASKS)
        .collect();
    let hue = (hash_of(&screen.id) % 360) as f32 / 360.0;
    uniform[7] = [pattern, f32::from(u8::from(blackout)), masks.len() as f32, hue];
    uniform[8] = [width as f32, height as f32, 0.0, 0.0];
    for (index, mask) in masks.into_iter().enumerate() {
        let base = 9 + index * 10;
        match mask {
            Mask::Rect {
                x,
                y,
                w,
                h,
                radius,
                feather,
                invert,
            } => {
                uniform[base] = [1.0, *feather as f32, f32::from(u8::from(*invert)), 0.0];
                uniform[base + 1] = [*x as f32, *y as f32, *w as f32, *h as f32];
                uniform[base + 2] = [*radius as f32, 0.0, 0.0, 0.0];
            }
            Mask::Polygon {
                points,
                feather,
                invert,
            } => {
                let count = points.len().min(MAX_OUTPUT_MASK_POINTS);
                uniform[base] = [2.0, *feather as f32, f32::from(u8::from(*invert)), count as f32];
                for (point_index, point) in points.iter().take(count).enumerate() {
                    let slot = &mut uniform[base + 3 + point_index / 2];
                    slot[(point_index % 2) * 2] = point[0] as f32;
                    slot[(point_index % 2) * 2 + 1] = point[1] as f32;
                }
            }
            Mask::Image { .. } => {}
        }
    }
    uniform
}

fn create_target(device: &wgpu::Device, label: &str, width: u32, height: u32, format: wgpu::TextureFormat) -> Target {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    Target {
        texture,
        view,
        width: width.max(1),
        height: height.max(1),
    }
}

fn begin_pass<'a>(
    encoder: &'a mut wgpu::CommandEncoder,
    target: &wgpu::TextureView,
    label: &str,
) -> wgpu::RenderPass<'a> {
    encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some(label),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view: target,
            depth_slice: None,
            resolve_target: None,
            ops: wgpu::Operations {
                load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                store: wgpu::StoreOp::Store,
            },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shaders_parse_and_validate() {
        for source in [SHADER, SCREEN_SHADER] {
            let module = wgpu::naga::front::wgsl::parse_str(source).expect("shader parses");
            let mut validator = wgpu::naga::valid::Validator::new(
                wgpu::naga::valid::ValidationFlags::all(),
                wgpu::naga::valid::Capabilities::empty(),
            );
            validator.validate(&module).expect("shader validates");
        }
    }

    #[test]
    fn transition_defaults_to_a_cut() {
        let transition: CompositionTransition = serde_json::from_str("{}").expect("transition");
        assert_eq!(transition, CompositionTransition::default());
        assert!(!transition.animates());
        let fade: CompositionTransition =
            serde_json::from_str(r#"{ "kind": "fade", "durationMs": 400, "easing": "easeInOut" }"#)
                .expect("fade");
        assert!(fade.animates());
    }

    #[test]
    fn screen_uniform_packs_mapping_and_state() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/full-composition.json")).expect("fixture");
        let screens: Vec<Screen> = serde_json::from_value(fixture["screens"].clone()).expect("screens");
        let left = screen_uniform(&screens[0], 1920, 1080);
        assert_eq!(left[0], [0.0, 0.0, 0.55, 1.0]);
        assert!((left[2][1] - 0.1).abs() < 1e-6);
        assert_eq!(left[4][1], 2.0);
        assert_eq!(left[7][0], 0.0);
        assert_eq!(left[7][2], 1.0);
        assert_eq!(left[9][0], 1.0);
        assert_eq!(left[10], [0.0, 0.9, 0.2, 0.1]);
        let ndi = screen_uniform(&screens[1], 640, 360);
        assert_eq!(ndi[7][0], 1.0);
        assert_eq!(ndi[7][1], 1.0);
        assert_eq!(ndi[8][..2], [640.0, 360.0]);
    }

    // --- GPU tests: ignored in CI; run with
    // `cargo test --release -p lumen-render compositor -- --ignored --nocapture`.

    use crate::{PreviewRenderer, VideoFrame};

    fn device() -> (wgpu::Device, wgpu::Queue) {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            apply_limit_buckets: false,
        }))
        .expect("adapter");
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("lumen-compositor-test"),
            required_features: crate::renderer::device_features(&adapter),
            required_limits: wgpu::Limits::default(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .expect("device")
    }

    /// Green screen with a magenta disc in the middle: the keyed video stand-in.
    fn green_screen_frame(width: u32, height: u32) -> VideoFrame {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let dx = x as f32 - width as f32 * 0.5;
                let dy = y as f32 - height as f32 * 0.5;
                if (dx * dx + dy * dy).sqrt() < height as f32 * 0.3 {
                    rgba.extend_from_slice(&[230, 40, 200, 255]);
                } else {
                    rgba.extend_from_slice(&[20, 220, 40, 255]);
                }
            }
        }
        VideoFrame::rgba(width, height, rgba)
    }

    /// The A2 exit scene: lyrics over a keyed video over a generator, with three effects.
    fn exit_composition() -> Composition {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 2, "revision": 1, "canvas": { "width": 1920, "height": 1080 },
            "sources": [
                { "kind": "shader", "id": "plasma", "shaderId": "plasma", "params": { "scale": 2, "speed": 1, "colorA": "#ff2d95", "colorB": "#2d6bff" } },
                { "kind": "video", "id": "clip", "asset": { "assetId": "clip", "hash": "h" } },
                { "kind": "slide", "id": "lyrics", "revision": 1,
                  "safeArea": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
                  "size": { "width": 1920, "height": 1080 },
                  "elements": [{
                      "kind": "text", "id": "line", "frame": { "x": 0.1, "y": 0.7, "w": 0.8, "h": 0.25 },
                      "runs": [{ "text": "Amazing grace, how sweet the sound" }],
                      "fontId": "sans", "fontSize": 72, "weight": 700, "color": "#ffffff",
                      "outline": { "color": "#000000", "width": 2 }
                  }] }
            ],
            "layers": [
                { "id": "bg", "name": "Generator", "sourceId": "plasma", "transform": {},
                  "effects": [{ "id": "kal", "kind": "kaleidoscope", "params": { "segments": 6 } }] },
                { "id": "video", "name": "Keyed video", "sourceId": "clip", "transform": {}, "fit": "cover",
                  "effects": [
                      { "id": "key", "kind": "key", "params": { "mode": "chroma", "keyColor": "#14dc28", "threshold": 0.4, "softness": 0.1 } },
                      { "id": "grade", "kind": "color", "params": { "saturation": 1.2, "contrast": 1.1 } }
                  ] },
                { "id": "lyrics", "name": "Lyrics", "sourceId": "lyrics", "transform": {}, "tags": ["lyrics"] }
            ],
            "master": { "opacity": 1, "effects": [] },
            "fonts": [{ "id": "sans", "family": "Helvetica", "path": "/missing/Helvetica.ttf", "hash": "f" }],
            "assets": [{ "id": "clip", "hash": "h", "kind": "video", "intrinsic": { "width": 640, "height": 360 } }]
        }))
        .expect("exit composition")
    }

    fn pixel(frame: &crate::CompositionFrame, x: u32, y: u32) -> [u8; 4] {
        let offset = ((y * frame.width + x) * 4) as usize;
        [frame.rgba[offset], frame.rgba[offset + 1], frame.rgba[offset + 2], frame.rgba[offset + 3]]
    }

    #[test]
    #[ignore]
    fn gpu_renders_the_exit_scene() {
        let composition = exit_composition();
        let mut renderer = PreviewRenderer::new().expect("renderer");
        renderer.update_video("clip", &green_screen_frame(640, 360)).expect("video");
        renderer.set_composition_clock(Some(1.0)).expect("clock");
        let frame = renderer
            .render_composition(&composition, None, 960, 540)
            .expect("render");
        let centre = pixel(&frame, 480, 270);
        // The disc survives the key: magenta-ish, not green.
        assert!(centre[0] > 150 && centre[1] < 120, "centre {centre:?}");
        // The green screen is keyed out: the generator shows, which is never this green.
        let corner = pixel(&frame, 40, 40);
        assert!(!(corner[1] > 180 && corner[0] < 60), "corner still green {corner:?}");
        assert!(!frame.layout.text_runs.is_empty(), "lyrics were laid out");
        assert!(frame.layout.text_runs[0].y > 0.6);
        assert_eq!(frame.layout.bounds.iter().filter(|b| b.element_id.is_none()).count(), 3);
    }

    fn solid_layers(layers: serde_json::Value) -> Composition {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 2, "revision": 1, "canvas": { "width": 64, "height": 64 },
            "sources": [
                { "kind": "solid", "id": "white", "color": "#ffffff" },
                { "kind": "solid", "id": "red", "color": "#ff0000" },
                { "kind": "solid", "id": "grey", "color": "#808080" },
                { "kind": "gradient", "id": "ramp", "gradient": "linear", "angle": 90,
                  "stops": [{ "at": 0, "color": "#000000" }, { "at": 1, "color": "#ffffff" }] }
            ],
            "layers": layers,
            "master": {}
        }))
        .expect("composition")
    }

    #[test]
    #[ignore]
    fn gpu_blends_masks_and_mattes() {
        let mut renderer = PreviewRenderer::new().expect("renderer");
        let mut render = |layers: serde_json::Value| {
            renderer
                .render_composition(&solid_layers(layers), None, 64, 64)
                .expect("render")
        };
        let multiply = render(serde_json::json!([
            { "id": "a", "sourceId": "white", "transform": {} },
            { "id": "b", "sourceId": "red", "transform": {}, "blend": "multiply" }
        ]));
        assert_eq!(pixel(&multiply, 32, 32), [255, 0, 0, 255]);
        let difference = render(serde_json::json!([
            { "id": "a", "sourceId": "white", "transform": {} },
            { "id": "b", "sourceId": "red", "transform": {}, "blend": "difference" }
        ]));
        assert_eq!(pixel(&difference, 32, 32), [0, 255, 255, 255]);
        let half = render(serde_json::json!([
            { "id": "a", "sourceId": "red", "transform": {}, "opacity": 0.5 }
        ]));
        // Linear-light 50% red over black, sRGB encoded.
        let red = pixel(&half, 32, 32)[0];
        assert!((185..=190).contains(&red), "half red {red}");
        let masked = render(serde_json::json!([
            { "id": "a", "sourceId": "white", "transform": {},
              "mask": { "kind": "rect", "x": 0.5, "y": 0, "w": 0.5, "h": 1 } }
        ]));
        assert_eq!(pixel(&masked, 8, 32)[0], 0);
        assert_eq!(pixel(&masked, 56, 32)[0], 255);
        let polygon = render(serde_json::json!([
            { "id": "a", "sourceId": "white", "transform": {},
              "mask": { "kind": "polygon", "points": [[0, 0], [1, 0], [0, 1]], "invert": true } }
        ]));
        assert_eq!(pixel(&polygon, 8, 8)[0], 0);
        assert_eq!(pixel(&polygon, 56, 56)[0], 255);
        // Alpha matte: the left half of the red layer survives, the right half shows white.
        let matte = render(serde_json::json!([
            { "id": "a", "sourceId": "white", "transform": {} },
            { "id": "b", "sourceId": "red", "transform": {} },
            { "id": "c", "sourceId": "white", "transform": { "x": 0, "y": 0, "w": 0.5, "h": 1 }, "blend": "alpha" }
        ]));
        assert_eq!(pixel(&matte, 8, 32), [255, 0, 0, 255]);
        assert_eq!(pixel(&matte, 56, 32), [255, 255, 255, 255]);
        // Transform: a half-size box rotated 90° about its centre stays inside the middle.
        let rotated = render(serde_json::json!([
            { "id": "a", "sourceId": "white", "transform": { "x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5, "rotation": 90 } }
        ]));
        assert_eq!(pixel(&rotated, 32, 32)[0], 255);
        assert_eq!(pixel(&rotated, 4, 4)[0], 0);
        // Gradient at 90°: dark on the left, light on the right.
        let ramp = render(serde_json::json!([{ "id": "a", "sourceId": "ramp", "transform": {} }]));
        assert!(pixel(&ramp, 4, 32)[0] < 60 && pixel(&ramp, 60, 32)[0] > 200);
        // Effects: luma key removes the dark half of the ramp.
        let keyed = render(serde_json::json!([
            { "id": "a", "sourceId": "white", "transform": {} },
            { "id": "b", "sourceId": "red", "transform": {}, "effects": [
                { "id": "fx", "kind": "transform", "params": { "scale": 0.5 } }
            ] }
        ]));
        assert_eq!(pixel(&keyed, 32, 32), [255, 0, 0, 255]);
        assert_eq!(pixel(&keyed, 2, 2), [255, 255, 255, 255]);
    }

    #[test]
    #[ignore]
    fn gpu_screen_stage_crops_maps_and_blacks_out() {
        let composition = solid_layers(serde_json::json!([
            { "id": "a", "sourceId": "ramp", "transform": {} }
        ]));
        let mut renderer = PreviewRenderer::new().expect("renderer");
        let mut screen = Screen::canvas(composition.canvas);
        screen.layout.region = crate::composition::Region { x: 0.5, y: 0.0, w: 0.5, h: 1.0 };
        let right = renderer.render_composition(&composition, Some(&screen), 64, 64).expect("render");
        assert!(pixel(&right, 2, 32)[0] > 150, "right half starts mid-ramp");
        screen.mapping.corner_pin = Some([
            crate::composition::Point { x: 0.25, y: 0.25 },
            crate::composition::Point { x: 0.75, y: 0.25 },
            crate::composition::Point { x: 0.75, y: 0.75 },
            crate::composition::Point { x: 0.25, y: 0.75 },
        ]);
        let pinned = renderer.render_composition(&composition, Some(&screen), 64, 64).expect("render");
        assert_eq!(pixel(&pinned, 4, 4), [0, 0, 0, 255]);
        assert!(pixel(&pinned, 32, 32)[0] > 100);
        screen.blackout = true;
        let black = renderer.render_composition(&composition, Some(&screen), 64, 64).expect("render");
        assert_eq!(pixel(&black, 32, 32), [0, 0, 0, 255]);
        screen.blackout = false;
        screen.test_pattern = Some(crate::composition::TestPattern::Bars);
        let bars = renderer.render_composition(&composition, Some(&screen), 64, 64).expect("render");
        assert!(pixel(&bars, 2, 10)[0] > 150);
    }

    /// A2 exit budget: lyrics over a keyed 1080p video over a plasma generator with three
    /// effects at 1080p. Prints GPU ms per frame without readback (the output path) and with.
    #[test]
    #[ignore]
    fn bench_exit_scene_1080p() {
        let composition = exit_composition();
        let mut composition_1080 = composition.clone();
        composition_1080.assets[0].intrinsic = crate::IntrinsicSize { width: 1920.0, height: 1080.0 };
        let (device, queue) = device();
        let mut compositor = Compositor::new(device.clone(), queue.clone());
        let frames: Vec<VideoFrame> = (0..2).map(|_| green_screen_frame(1920, 1080)).collect();
        let format = wgpu::TextureFormat::Bgra8UnormSrgb;
        let target = create_target(&device, "bench-output", 1920, 1080, format);
        let screen = Screen::canvas(composition.canvas);
        let rounds = 240;
        let mut upload = std::time::Duration::ZERO;
        let mut render = std::time::Duration::ZERO;
        for round in 0..rounds + 10 {
            let started = Instant::now();
            compositor.update_video("clip", &frames[round % 2]).expect("upload");
            let uploaded = started.elapsed();
            compositor.set_clock(Some(round as f64 / 60.0));
            let started = Instant::now();
            let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            compositor
                .render(&mut encoder, &composition_1080, &screen, &target.view, format, 1920, 1080)
                .expect("render");
            queue.submit([encoder.finish()]);
            device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
            // Warm-up rounds compile pipelines and render the slide once.
            if round >= 10 {
                upload += uploaded;
                render += started.elapsed();
            }
        }
        let mut preview = PreviewRenderer::new().expect("preview");
        preview.update_video("clip", &frames[0]).expect("video");
        let started = Instant::now();
        for round in 0..30 {
            preview.set_composition_clock(Some(round as f64 / 60.0)).expect("clock");
            preview.render_composition(&composition_1080, None, 1920, 1080).expect("preview");
        }
        let preview_ms = started.elapsed().as_secs_f64() * 1000.0 / 30.0;
        eprintln!(
            "A2 exit scene 1080p (lyrics over keyed 1080p RGBA video over plasma, 3 effects): \
             upload {:.2} ms, render + wait {:.2} ms/frame, preview with readback {:.2} ms/frame (60 fps budget 16.67 ms)",
            upload.as_secs_f64() * 1000.0 / rounds as f64,
            render.as_secs_f64() * 1000.0 / rounds as f64,
            preview_ms,
        );
    }

    /// Preview and output render the same pixels: the preview path (RGBA readback) against a
    /// separate compositor drawing into an output-like BGRA sRGB target on its own device.
    #[test]
    #[ignore]
    fn gpu_preview_matches_output() {
        let composition = exit_composition();
        let video = green_screen_frame(640, 360);
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/full-composition.json")).expect("fixture");
        let mut mapped: Screen = serde_json::from_value(fixture["screens"][0].clone()).expect("screen");
        mapped.layout.layers = crate::composition::LayerFilter::All;
        mapped.layout.text = None;
        for screen in [Screen::canvas(composition.canvas), mapped] {
            let mut preview = PreviewRenderer::new().expect("preview");
            preview.update_video("clip", &video).expect("video");
            preview.set_composition_clock(Some(2.0)).expect("clock");
            let expected = preview
                .render_composition(&composition, Some(&screen), 480, 270)
                .expect("preview");

            let (device, queue) = device();
            let mut output = Compositor::new(device.clone(), queue.clone());
            output.update_video("clip", &video).expect("video");
            output.set_clock(Some(2.0));
            let format = wgpu::TextureFormat::Bgra8UnormSrgb;
            let target = create_target(&device, "output", 480, 270, format);
            let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            output
                .render(&mut encoder, &composition, &screen, &target.view, format, 480, 270)
                .expect("output");
            let bgra = crate::renderer::read_back(&device, &queue, encoder, &target.texture, 480, 270).expect("readback");
            let mut worst = 0u8;
            for (rgba, bgra) in expected.rgba.chunks_exact(4).zip(bgra.chunks_exact(4)) {
                for (a, b) in [(rgba[0], bgra[2]), (rgba[1], bgra[1]), (rgba[2], bgra[0])] {
                    worst = worst.max(a.abs_diff(b));
                }
            }
            eprintln!("preview vs output ({}): worst channel difference {worst}", screen.id);
            assert!(worst <= 2, "preview and output differ by {worst}");
        }
    }

    #[test]
    fn blend_codes_match_the_shader() {
        assert_eq!(blend_code(BlendMode::Normal), 0.0);
        assert_eq!(blend_code(BlendMode::Difference), 5.0);
        assert_eq!(blend_code(BlendMode::Alpha), 6.0);
        assert_eq!(effect_entry(EffectKind::Kaleidoscope), "fs_kaleidoscope");
    }
}
