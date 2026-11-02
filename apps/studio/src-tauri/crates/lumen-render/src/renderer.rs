//! wgpu surface renderer, offscreen preview renderer and the slide renderer.
//!
//! Both the audience window ([`SurfaceRenderer`]) and the preview ([`PreviewRenderer`]) draw
//! compositions through the [`Compositor`]. The compositor draws `slide` sources with
//! [`SlideRenderer`], which also holds the image and video textures it samples.

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Instant;

use bytemuck::{Pod, Zeroable};
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use serde::{Deserialize, Serialize};

use crate::asset::{AssetLoader, AssetSource};
use crate::blur::{blur_rgba, box_radius_for_sigma};
use crate::color::ClearColor;
use crate::composition::{Composition, Screen};
use crate::compositor::{CompositionPreviewResult, CompositionTransition, Compositor};
use crate::composition::{AssetKind, AssetState, CompositionAsset, SlideElement};
use crate::geometry::{fit_uv, rotate_point, rotate_vector, FrameRect, UvRect};
use crate::slide::{SlideLayout, SlidePage};
use crate::text::{AtlasData, DecorationDraw, GlyphDraw, TextEngine};
use crate::video::{bc_len, VideoFrame, VideoPixels};
use crate::RenderError;

const CLEAR_PASS_LABEL: &str = "lumen-clear-pass";
const SLIDE_SHADER: &str = include_str!("slide.wgsl");

/// Per-frame timing exposed to the studio.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderStats {
    pub frame: u64,
    pub last_frame_ms: f64,
    pub average_frame_ms: f64,
}

/// Pure frame timing accumulator. Kept free of wgpu so it is testable without a GPU.
#[derive(Debug, Clone, Default)]
pub struct FrameTiming {
    frame: u64,
    last_frame_ms: f64,
    total_ms: f64,
}

impl FrameTiming {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&mut self, elapsed_ms: f64) {
        if !elapsed_ms.is_finite() || elapsed_ms < 0.0 {
            return;
        }
        self.frame += 1;
        self.last_frame_ms = elapsed_ms;
        self.total_ms += elapsed_ms;
    }

    pub fn frame(&self) -> u64 {
        self.frame
    }

    pub fn stats(&self) -> RenderStats {
        RenderStats {
            frame: self.frame,
            last_frame_ms: self.last_frame_ms,
            average_frame_ms: if self.frame == 0 {
                0.0
            } else {
                self.total_ms / self.frame as f64
            },
        }
    }
}

/// What the render loop should do with an acquired surface state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurfaceAction {
    Draw,
    Reconfigure,
    SkipFrame,
    Fatal,
}

/// Pure surface-state classifier, testable without a GPU.
pub fn surface_action(state: &wgpu::CurrentSurfaceTexture) -> SurfaceAction {
    match state {
        wgpu::CurrentSurfaceTexture::Success(_) | wgpu::CurrentSurfaceTexture::Suboptimal(_) => {
            SurfaceAction::Draw
        }
        wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
            SurfaceAction::Reconfigure
        }
        wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
            SurfaceAction::SkipFrame
        }
        wgpu::CurrentSurfaceTexture::Validation => SurfaceAction::Fatal,
    }
}

/// A window that can back a wgpu surface. Kept type-erased so a surface can be recreated on the
/// main thread after `Lost` or `Outdated` without owning the window type here.
pub trait SurfaceWindow: HasWindowHandle + HasDisplayHandle + Send + Sync + 'static {}

impl<T> SurfaceWindow for T where T: HasWindowHandle + HasDisplayHandle + Send + Sync + 'static {}

/// Main-thread surface factory. Cloning it is cheap; `create_surface` must still be called from the
/// main thread because macOS requires it.
#[derive(Clone)]
pub struct SurfaceFactory {
    instance: wgpu::Instance,
    window: Arc<dyn SurfaceWindow>,
}

impl SurfaceFactory {
    pub fn new<W>(window: W) -> Self
    where
        W: HasWindowHandle + HasDisplayHandle + Send + Sync + 'static,
    {
        let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
        descriptor.backends = wgpu::Backends::all();
        Self {
            instance: wgpu::Instance::new(descriptor),
            window: Arc::new(window),
        }
    }

    /// Creates a new surface for the same window. Safe to call repeatedly after a surface is lost.
    pub fn create_surface(&self) -> Result<PendingSurface, RenderError> {
        let surface = self
            .instance
            .create_surface(Arc::clone(&self.window))
            .map_err(|error| RenderError::Backend(format!("create surface: {error}")))?;
        Ok(PendingSurface {
            instance: self.instance.clone(),
            surface,
        })
    }
}

/// An instance and a surface created on the main thread.
pub struct PendingSurface {
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
}

/// Creates the wgpu instance and surface. Call this from the main thread.
pub fn create_window_surface<W>(window: W) -> Result<PendingSurface, RenderError>
where
    W: HasWindowHandle + HasDisplayHandle + Send + Sync + 'static,
{
    SurfaceFactory::new(window).create_surface()
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct Vertex {
    position: [f32; 2],
    uv: [f32; 2],
    color: [f32; 4],
    stroke_color: [f32; 4],
    local: [f32; 2],
    size: [f32; 2],
    params: [f32; 4],
}

impl Vertex {
    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
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
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x4,
                    offset: 16,
                    shader_location: 2,
                },
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x4,
                    offset: 32,
                    shader_location: 3,
                },
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x2,
                    offset: 48,
                    shader_location: 4,
                },
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x2,
                    offset: 56,
                    shader_location: 5,
                },
                wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x4,
                    offset: 64,
                    shader_location: 6,
                },
            ],
        }
    }
}

struct QuadSpec {
    rect: FrameRect,
    uv: UvRect,
    color: [f32; 4],
    stroke_color: [f32; 4],
    radius: f32,
    stroke_width: f32,
    mode: f32,
    rotation: f32,
    center: (f32, f32),
}

fn push_quad(vertices: &mut Vec<Vertex>, spec: QuadSpec, width: f32, height: f32) {
    let rect = spec.rect;
    let corners = [
        (rect.x, rect.y, spec.uv.u0, spec.uv.v0),
        (rect.x + rect.w, rect.y, spec.uv.u1, spec.uv.v0),
        (rect.x + rect.w, rect.y + rect.h, spec.uv.u1, spec.uv.v1),
        (rect.x, rect.y + rect.h, spec.uv.u0, spec.uv.v1),
    ];
    let locals = [(0.0, 0.0), (rect.w, 0.0), (rect.w, rect.h), (0.0, rect.h)];
    let params = [
        spec.radius.max(0.0),
        spec.stroke_width.max(0.0),
        if spec.uv.discard_outside { 1.0 } else { 0.0 },
        spec.mode,
    ];
    let mut positions = [(0.0, 0.0); 4];
    for (index, (x, y, _, _)) in corners.iter().enumerate() {
        let (x, y) = rotate_point(*x, *y, spec.center.0, spec.center.1, spec.rotation);
        positions[index] = (x / width * 2.0 - 1.0, 1.0 - y / height * 2.0);
    }
    for index in [0usize, 1, 2, 0, 2, 3] {
        let (_, _, u, v) = corners[index];
        let (local_x, local_y) = locals[index];
        let (x, y) = positions[index];
        vertices.push(Vertex {
            position: [x, y],
            uv: [u, v],
            color: spec.color,
            stroke_color: spec.stroke_color,
            local: [local_x, local_y],
            size: [rect.w, rect.h],
            params,
        });
    }
}

fn push_glyph_quad(
    vertices: &mut Vec<Vertex>,
    glyph: &GlyphDraw,
    uv: [f32; 4],
    color: [f32; 4],
    offset: (f32, f32),
    width: f32,
    height: f32,
) {
    push_quad(
        vertices,
        QuadSpec {
            rect: FrameRect {
                x: glyph.rect.x + offset.0,
                y: glyph.rect.y + offset.1,
                ..glyph.rect
            },
            uv: UvRect {
                u0: uv[0],
                v0: uv[1],
                u1: uv[2],
                v1: uv[3],
                discard_outside: false,
            },
            color,
            stroke_color: [0.0; 4],
            radius: 0.0,
            stroke_width: 0.0,
            mode: 2.0,
            rotation: glyph.rotation,
            center: glyph.center,
        },
        width,
        height,
    );
}

/// Draws a glyph quad expanded by the atlas blur padding so the blurred shadow is not clipped.
#[allow(clippy::too_many_arguments)]
fn push_shadow_glyph_quad(
    vertices: &mut Vec<Vertex>,
    glyph: &GlyphDraw,
    uv: [f32; 4],
    color: [f32; 4],
    offset: (f32, f32),
    padding: f32,
    width: f32,
    height: f32,
) {
    let mut expanded = *glyph;
    expanded.rect.x -= padding;
    expanded.rect.y -= padding;
    expanded.rect.w += padding * 2.0;
    expanded.rect.h += padding * 2.0;
    push_glyph_quad(vertices, &expanded, uv, color, offset, width, height);
}

/// Draws one underline rect with the shared white texture.
fn push_decoration_quad(
    vertices: &mut Vec<Vertex>,
    decoration: &DecorationDraw,
    width: f32,
    height: f32,
) {
    push_quad(
        vertices,
        QuadSpec {
            rect: decoration.rect,
            uv: UvRect {
                u0: 0.0,
                v0: 0.0,
                u1: 1.0,
                v1: 1.0,
                discard_outside: false,
            },
            color: decoration.color,
            stroke_color: [0.0; 4],
            radius: 0.0,
            stroke_width: 0.0,
            mode: 2.0,
            rotation: decoration.rotation,
            center: decoration.center,
        },
        width,
        height,
    );
}

pub(crate) struct GpuTexture {
    pub(crate) texture: wgpu::Texture,
    pub(crate) view: wgpu::TextureView,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// Shader modes in `slide.wgsl` (`params.w`).
pub(crate) const MODE_TEXTURE: f32 = 1.0;
pub(crate) const MODE_YCOCG: f32 = 3.0;
pub(crate) const MODE_OPAQUE: f32 = 4.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VideoUpload {
    Rgba,
    Compressed(wgpu::TextureFormat),
}

/// A video asset's current frame on the GPU.
pub(crate) struct VideoTexture {
    pub(crate) gpu: GpuTexture,
    upload: VideoUpload,
    /// Real frame size; block-compressed textures are padded to multiples of four.
    pub(crate) frame_width: u32,
    pub(crate) frame_height: u32,
    pub(crate) mode: f32,
}

impl VideoTexture {
    /// UV scale that hides block padding.
    pub(crate) fn uv_scale(&self) -> (f32, f32) {
        (
            self.frame_width as f32 / self.gpu.width.max(1) as f32,
            self.frame_height as f32 / self.gpu.height.max(1) as f32,
        )
    }
}

/// Creates an empty texture for a block-compressed format, padded to whole blocks.
fn compressed_texture(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    width: u32,
    height: u32,
) -> GpuTexture {
    let width = width.max(1).div_ceil(4) * 4;
    let height = height.max(1).div_ceil(4) * 4;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("lumen-video-bc"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    GpuTexture {
        texture,
        view,
        width,
        height,
    }
}

/// Requests BC texture support when the adapter has it; Hap frames then upload without CPU work.
pub(crate) fn device_features(adapter: &wgpu::Adapter) -> wgpu::Features {
    adapter.features() & wgpu::Features::TEXTURE_COMPRESSION_BC
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TextureKey {
    White,
    Atlas,
    ShadowAtlas(u32),
    Image(String),
    Video(String),
}

struct DrawCall {
    vertices: Vec<Vertex>,
    texture: TextureKey,
}

fn upload_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    width: u32,
    height: u32,
    rgba: &[u8],
    srgb: bool,
) -> GpuTexture {
    let width = width.max(1);
    let height = height.max(1);
    let format = if srgb {
        wgpu::TextureFormat::Rgba8UnormSrgb
    } else {
        wgpu::TextureFormat::Rgba8Unorm
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    GpuTexture {
        texture,
        view,
        width,
        height,
    }
}

/// Draws `slide` sources (text atlas, shapes, images) for the compositor and holds the image and
/// video textures the compositor samples. Draws clear to transparent and convert sRGB contract
/// colours to linear light.
pub(crate) struct SlideRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    white: GpuTexture,
    atlas: GpuTexture,
    atlas_uvs: HashMap<cosmic_text::CacheKey, [f32; 4]>,
    shadow_uvs: HashMap<cosmic_text::CacheKey, [f32; 4]>,
    atlas_blur_padding: u32,
    shadow_atlases: HashMap<u32, GpuTexture>,
    pub(crate) images: HashMap<String, GpuTexture>,
    pub(crate) videos: HashMap<String, VideoTexture>,
    pub(crate) bc_supported: bool,
    text: TextEngine,
    glyphs: Vec<GlyphDraw>,
    decorations: Vec<DecorationDraw>,
    layout: SlideLayout,
    assets: AssetLoader,
    prepared: Option<(u64, u32, u32)>,
}

impl SlideRenderer {
    pub(crate) fn new(
        device: wgpu::Device,
        queue: wgpu::Queue,
        format: wgpu::TextureFormat,
    ) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("lumen-slide-bind-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("lumen-slide-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("lumen-slide-shader"),
            source: wgpu::ShaderSource::Wgsl(SLIDE_SHADER.into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("lumen-slide-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[Some(Vertex::layout())],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::SrcAlpha,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("lumen-slide-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let bc_supported = device
            .features()
            .contains(wgpu::Features::TEXTURE_COMPRESSION_BC);
        let white = upload_texture(&device, &queue, "lumen-white", 1, 1, &[255; 4], false);
        let atlas = upload_texture(&device, &queue, "lumen-atlas", 1, 1, &[0; 4], false);
        Self {
            device,
            queue,
            pipeline,
            bind_group_layout,
            sampler,
            white,
            atlas,
            atlas_uvs: HashMap::new(),
            shadow_uvs: HashMap::new(),
            atlas_blur_padding: 0,
            shadow_atlases: HashMap::new(),
            images: HashMap::new(),
            videos: HashMap::new(),
            bc_supported,
            text: TextEngine::new(),
            glyphs: Vec::new(),
            decorations: Vec::new(),
            layout: SlideLayout::default(),
            assets: AssetLoader::new(),
            prepared: None,
        }
    }

    /// Forgets the prepared layout so the next draw shapes its slide again.
    pub(crate) fn invalidate(&mut self) {
        self.prepared = None;
    }

    pub(crate) fn layout(&self) -> &SlideLayout {
        &self.layout
    }

    fn update_video_frame(
        &mut self,
        asset_id: &str,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), RenderError> {
        let expected = width as usize * height as usize * 4;
        if expected == 0 || rgba.len() < expected {
            return Err(RenderError::Backend(format!(
                "video frame for {asset_id} has {} bytes, expected {expected}",
                rgba.len()
            )));
        }
        self.write_rgba_video(asset_id, width, height, &rgba[..expected], MODE_TEXTURE);
        Ok(())
    }

    /// Uploads one decoded frame. Block-compressed frames go to the GPU as-is when
    /// the device supports BC textures and are decoded on the CPU otherwise.
    pub(crate) fn update_video(
        &mut self,
        asset_id: &str,
        frame: &VideoFrame,
    ) -> Result<(), RenderError> {
        let (width, height) = (frame.width, frame.height);
        if width == 0 || height == 0 {
            return Err(RenderError::Backend(format!(
                "video frame for {asset_id} is empty"
            )));
        }
        let short = |bytes: usize, expected: usize| {
            RenderError::Backend(format!(
                "video frame for {asset_id} has {bytes} bytes, expected {expected}"
            ))
        };
        let check = |data: &[u8], block_bytes: usize| -> Result<(), RenderError> {
            let expected = bc_len(width, height, block_bytes);
            if data.len() < expected {
                return Err(short(data.len(), expected));
            }
            Ok(())
        };
        match &frame.pixels {
            VideoPixels::Rgba(rgba) => self.update_video_frame(asset_id, width, height, rgba),
            VideoPixels::Bc1(data) => {
                check(data, 8)?;
                if self.bc_supported {
                    self.write_compressed_video(
                        asset_id,
                        wgpu::TextureFormat::Bc1RgbaUnormSrgb,
                        width,
                        height,
                        data,
                        8,
                        MODE_OPAQUE,
                    );
                } else {
                    self.write_rgba_video(
                        asset_id,
                        width,
                        height,
                        &crate::bc::decode_bc1(width, height, data),
                        MODE_TEXTURE,
                    );
                }
                Ok(())
            }
            VideoPixels::Bc3(data) => {
                check(data, 16)?;
                if self.bc_supported {
                    self.write_compressed_video(
                        asset_id,
                        wgpu::TextureFormat::Bc3RgbaUnormSrgb,
                        width,
                        height,
                        data,
                        16,
                        MODE_TEXTURE,
                    );
                } else {
                    self.write_rgba_video(
                        asset_id,
                        width,
                        height,
                        &crate::bc::decode_bc3(width, height, data),
                        MODE_TEXTURE,
                    );
                }
                Ok(())
            }
            VideoPixels::Bc3YCoCg(data) => {
                check(data, 16)?;
                if self.bc_supported {
                    // YCoCg values are not colours: sample them linearly and convert in the shader.
                    self.write_compressed_video(
                        asset_id,
                        wgpu::TextureFormat::Bc3RgbaUnorm,
                        width,
                        height,
                        data,
                        16,
                        MODE_YCOCG,
                    );
                } else {
                    self.write_rgba_video(
                        asset_id,
                        width,
                        height,
                        &crate::bc::decode_ycocg(width, height, data, None),
                        MODE_TEXTURE,
                    );
                }
                Ok(())
            }
            VideoPixels::Bc3YCoCgAlpha { color, alpha } => {
                check(color, 16)?;
                check(alpha, 8)?;
                let rgba = crate::bc::decode_ycocg(width, height, color, Some(alpha));
                self.write_rgba_video(asset_id, width, height, &rgba, MODE_TEXTURE);
                Ok(())
            }
            VideoPixels::Bc4(data) => {
                check(data, 8)?;
                self.write_rgba_video(
                    asset_id,
                    width,
                    height,
                    &crate::bc::decode_bc4(width, height, data),
                    MODE_TEXTURE,
                );
                Ok(())
            }
            VideoPixels::Bc7(data) => {
                check(data, 16)?;
                if !self.bc_supported {
                    return Err(RenderError::Backend(
                        "Hap R (BC7) needs a GPU with BC texture support".to_string(),
                    ));
                }
                self.write_compressed_video(
                    asset_id,
                    wgpu::TextureFormat::Bc7RgbaUnormSrgb,
                    width,
                    height,
                    data,
                    16,
                    MODE_TEXTURE,
                );
                Ok(())
            }
        }
    }

    fn write_rgba_video(
        &mut self,
        asset_id: &str,
        width: u32,
        height: u32,
        rgba: &[u8],
        mode: f32,
    ) {
        let reuse = self.videos.get(asset_id).is_some_and(|video| {
            video.upload == VideoUpload::Rgba
                && video.gpu.width == width
                && video.gpu.height == height
        });
        if !reuse {
            let gpu = upload_texture(
                &self.device,
                &self.queue,
                "lumen-video-frame",
                width,
                height,
                rgba,
                true,
            );
            self.videos.insert(
                asset_id.to_string(),
                VideoTexture {
                    gpu,
                    upload: VideoUpload::Rgba,
                    frame_width: width,
                    frame_height: height,
                    mode,
                },
            );
            return;
        }
        if let Some(video) = self.videos.get_mut(asset_id) {
            video.mode = mode;
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &video.gpu.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(width * 4),
                    rows_per_image: Some(height),
                },
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn write_compressed_video(
        &mut self,
        asset_id: &str,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
        data: &[u8],
        block_bytes: u32,
        mode: f32,
    ) {
        let upload = VideoUpload::Compressed(format);
        let reuse = self.videos.get(asset_id).is_some_and(|video| {
            video.upload == upload && video.frame_width == width && video.frame_height == height
        });
        if !reuse {
            let gpu = compressed_texture(&self.device, format, width, height);
            self.videos.insert(
                asset_id.to_string(),
                VideoTexture {
                    gpu,
                    upload,
                    frame_width: width,
                    frame_height: height,
                    mode,
                },
            );
        }
        let Some(video) = self.videos.get_mut(asset_id) else {
            return;
        };
        video.mode = mode;
        let blocks_x = video.gpu.width / 4;
        let blocks_y = video.gpu.height / 4;
        let expected = (blocks_x * blocks_y * block_bytes) as usize;
        // Frames sized to the real dimensions already cover every padded block.
        let bytes = &data[..expected.min(data.len())];
        if bytes.len() < expected {
            return;
        }
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &video.gpu.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(blocks_x * block_bytes),
                rows_per_image: Some(blocks_y),
            },
            wgpu::Extent3d {
                width: video.gpu.width,
                height: video.gpu.height,
                depth_or_array_layers: 1,
            },
        );
    }

    fn prepare(&mut self, slide: &SlidePage, width: u32, height: u32) -> Result<(), RenderError> {
        let key = (slide.revision, width, height);
        if self.prepared == Some(key) {
            return Ok(());
        }
        self.load_image_assets(&slide.assets);
        let layout = self.text.layout(slide, width, height);
        let scale = width as f32 / slide.size.width.max(1.0) as f32;
        let radii = shadow_radii(&slide.elements, scale);
        let max_radius = radii.iter().copied().max().unwrap_or(0);
        let padding = if max_radius == 0 {
            1
        } else {
            max_radius * 3 + 1
        };
        let atlas = self.text.build_atlas(&layout.glyphs, padding);
        self.upload_atlas(&atlas);
        self.atlas_uvs = atlas.uvs.clone();
        self.shadow_uvs = atlas.shadow_uvs.clone();
        self.atlas_blur_padding = atlas.blur_padding;
        self.shadow_atlases.clear();
        for radius in radii {
            let blurred = blur_rgba(&atlas.pixels, atlas.width, atlas.height, radius);
            if blurred.is_empty() {
                continue;
            }
            self.shadow_atlases.insert(
                radius,
                upload_texture(
                    &self.device,
                    &self.queue,
                    "lumen-shadow-atlas",
                    atlas.width,
                    atlas.height,
                    &blurred,
                    false,
                ),
            );
        }
        self.glyphs = layout.glyphs;
        self.decorations = layout.decorations;
        self.layout = SlideLayout {
            bounds: layout.bounds,
            text_runs: layout.text_runs,
        };
        self.prepared = Some(key);
        Ok(())
    }

    fn upload_atlas(&mut self, atlas: &AtlasData) {
        if self.atlas.width != atlas.width || self.atlas.height != atlas.height {
            self.atlas = upload_texture(
                &self.device,
                &self.queue,
                "lumen-atlas",
                atlas.width,
                atlas.height,
                &atlas.pixels,
                false,
            );
            return;
        }
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.atlas.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &atlas.pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(atlas.width * 4),
                rows_per_image: Some(atlas.height),
            },
            wgpu::Extent3d {
                width: atlas.width,
                height: atlas.height,
                depth_or_array_layers: 1,
            },
        );
    }

    pub(crate) fn load_image_assets(&mut self, assets: &[CompositionAsset]) {
        for asset in assets {
            if asset.kind != AssetKind::Image || asset.state == AssetState::Missing {
                continue;
            }
            let key = asset_key(&asset.id, &asset.hash);
            if self.images.contains_key(&key) {
                continue;
            }
            let Some(raw) = asset.local_path.as_deref().or(asset.url.as_deref()) else {
                continue;
            };
            let Some(source) = AssetSource::parse(raw) else {
                continue;
            };
            let Some(bytes) = self.assets.load(&source, &asset.hash) else {
                continue;
            };
            let Ok(image) = image::load_from_memory(&bytes) else {
                continue;
            };
            let rgba = image.to_rgba8();
            let (width, height) = rgba.dimensions();
            self.images.insert(
                key,
                upload_texture(
                    &self.device,
                    &self.queue,
                    "lumen-image",
                    width,
                    height,
                    rgba.as_raw(),
                    true,
                ),
            );
        }
    }

    pub(crate) fn draw(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        slide: &SlidePage,
        width: u32,
        height: u32,
    ) -> Result<(), RenderError> {
        self.prepare(slide, width, height)?;
        let mut calls = self.build_draw_calls(slide, width, height);
        for call in &mut calls {
            for vertex in &mut call.vertices {
                linearize(&mut vertex.color);
                linearize(&mut vertex.stroke_color);
            }
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(CLEAR_PASS_LABEL),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(ClearColor::TRANSPARENT.to_wgpu()),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            for call in calls {
                if call.vertices.is_empty() {
                    continue;
                }
                let Some(texture_view) = self.texture_view(&call.texture) else {
                    continue;
                };
                let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("lumen-slide-bind-group"),
                    layout: &self.bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(texture_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                });
                let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("lumen-slide-vertices"),
                    size: std::mem::size_of_val(call.vertices.as_slice()) as wgpu::BufferAddress,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                self.queue
                    .write_buffer(&buffer, 0, bytemuck::cast_slice(&call.vertices));
                pass.set_bind_group(0, &bind_group, &[]);
                pass.set_vertex_buffer(0, buffer.slice(..));
                pass.draw(0..call.vertices.len() as u32, 0..1);
            }
        }
        Ok(())
    }

    fn texture_view(&self, key: &TextureKey) -> Option<&wgpu::TextureView> {
        match key {
            TextureKey::White => Some(&self.white.view),
            TextureKey::Atlas => Some(&self.atlas.view),
            TextureKey::ShadowAtlas(radius) => {
                self.shadow_atlases.get(radius).map(|texture| &texture.view)
            }
            TextureKey::Image(key) => self.images.get(key).map(|texture| &texture.view),
            TextureKey::Video(key) => self.videos.get(key).map(|video| &video.gpu.view),
        }
    }

    fn build_draw_calls(&self, slide: &SlidePage, width: u32, height: u32) -> Vec<DrawCall> {
        let mut calls = Vec::new();
        // Text layout numbers glyphs by element index, so the index survives the z sort.
        for (index, element) in draw_order(&slide.elements) {
            self.push_layer_call(&mut calls, slide, element, index, width, height);
        }
        calls
    }

    fn push_layer_call(
        &self,
        calls: &mut Vec<DrawCall>,
        slide: &SlidePage,
        layer: &SlideElement,
        layer_index: usize,
        width: u32,
        height: u32,
    ) {
        if layer.opacity() <= 0.0 {
            return;
        }
        let width_f = width as f32;
        let height_f = height as f32;
        let scale = width_f / slide.size.width.max(1.0) as f32;
        let frame = FrameRect::from_frame(layer.frame(), width_f, height_f);
        let opacity = layer.opacity().clamp(0.0, 1.0);
        let center = frame.center();
        let rotation = layer.frame().rotation as f32;
        match layer {
            SlideElement::Shape {
                fill,
                stroke,
                stroke_width,
                radius,
                ..
            } => {
                let fill = ClearColor::parse(fill).map(|color| color.with_alpha(opacity));
                let stroke = stroke
                    .as_deref()
                    .and_then(ClearColor::parse)
                    .map(|color| color.with_alpha(opacity))
                    .unwrap_or(ClearColor::TRANSPARENT);
                let Some(fill) = fill else {
                    return;
                };
                let mut vertices = Vec::new();
                push_quad(
                    &mut vertices,
                    QuadSpec {
                        rect: frame,
                        uv: UvRect {
                            u0: 0.0,
                            v0: 0.0,
                            u1: 1.0,
                            v1: 1.0,
                            discard_outside: false,
                        },
                        color: fill.to_array(),
                        stroke_color: stroke.to_array(),
                        radius: (radius * f64::from(scale)) as f32,
                        stroke_width: (stroke_width * f64::from(scale)) as f32,
                        mode: 0.0,
                        rotation,
                        center,
                    },
                    width_f,
                    height_f,
                );
                calls.push(DrawCall {
                    vertices,
                    texture: TextureKey::White,
                });
            }
            SlideElement::Image {
                source,
                fit,
                radius,
                ..
            } => {
                let Some(asset) = slide
                    .assets
                    .iter()
                    .find(|asset| asset.id == source.asset_id)
                else {
                    return;
                };
                let key = asset_key(&asset.id, &asset.hash);
                if !self.images.contains_key(&key) {
                    return;
                }
                let mut vertices = Vec::new();
                push_quad(
                    &mut vertices,
                    QuadSpec {
                        rect: frame,
                        uv: fit_uv(
                            *fit,
                            frame.w,
                            frame.h,
                            asset.intrinsic.width as f32,
                            asset.intrinsic.height as f32,
                        ),
                        color: [1.0, 1.0, 1.0, opacity as f32],
                        stroke_color: [0.0; 4],
                        radius: (radius * f64::from(scale)) as f32,
                        stroke_width: 0.0,
                        mode: 1.0,
                        rotation,
                        center,
                    },
                    width_f,
                    height_f,
                );
                calls.push(DrawCall {
                    vertices,
                    texture: TextureKey::Image(key),
                });
            }
            SlideElement::Text {
                shadow, outline, ..
            } => {
                let glyphs: Vec<&GlyphDraw> = self
                    .glyphs
                    .iter()
                    .filter(|glyph| glyph.layer_index as usize == layer_index)
                    .collect();
                let mut vertices = Vec::new();
                if let Some(shadow) = shadow {
                    let color = ClearColor::parse_or_black(&shadow.color).with_alpha(opacity);
                    let offset = rotate_vector(
                        (shadow.offset_x * f64::from(scale)) as f32,
                        (shadow.offset_y * f64::from(scale)) as f32,
                        rotation,
                    );
                    let radius = box_radius_for_sigma(shadow.blur * f64::from(scale));
                    let blurred = radius > 0 && self.shadow_atlases.contains_key(&radius);
                    let padding = self.atlas_blur_padding as f32;
                    let mut shadow_vertices = Vec::new();
                    for glyph in &glyphs {
                        let uv = if blurred {
                            self.shadow_uvs.get(&glyph.cache_key).copied()
                        } else {
                            self.atlas_uvs.get(&glyph.cache_key).copied()
                        };
                        let Some(uv) = uv else {
                            continue;
                        };
                        if blurred {
                            push_shadow_glyph_quad(
                                &mut shadow_vertices,
                                glyph,
                                uv,
                                color.to_array(),
                                offset,
                                padding,
                                width_f,
                                height_f,
                            );
                        } else {
                            push_glyph_quad(
                                &mut shadow_vertices,
                                glyph,
                                uv,
                                color.to_array(),
                                offset,
                                width_f,
                                height_f,
                            );
                        }
                    }
                    calls.push(DrawCall {
                        vertices: shadow_vertices,
                        texture: if blurred {
                            TextureKey::ShadowAtlas(radius)
                        } else {
                            TextureKey::Atlas
                        },
                    });
                }
                let mut decoration_vertices = Vec::new();
                for decoration in self
                    .decorations
                    .iter()
                    .filter(|decoration| decoration.layer_index as usize == layer_index)
                {
                    push_decoration_quad(&mut decoration_vertices, decoration, width_f, height_f);
                }
                if !decoration_vertices.is_empty() {
                    calls.push(DrawCall {
                        vertices: decoration_vertices,
                        texture: TextureKey::White,
                    });
                }
                if let Some(outline) = outline {
                    let color = ClearColor::parse_or_black(&outline.color).with_alpha(opacity);
                    let width = (outline.width * f64::from(scale)) as f32;
                    let directions = [
                        (1.0, 0.0),
                        (0.707, 0.707),
                        (0.0, 1.0),
                        (-0.707, 0.707),
                        (-1.0, 0.0),
                        (-0.707, -0.707),
                        (0.0, -1.0),
                        (0.707, -0.707),
                    ];
                    for glyph in &glyphs {
                        let Some(uv) = self.atlas_uvs.get(&glyph.cache_key).copied() else {
                            continue;
                        };
                        for (dx, dy) in directions {
                            let offset = rotate_vector(dx * width, dy * width, rotation);
                            push_glyph_quad(
                                &mut vertices,
                                glyph,
                                uv,
                                color.to_array(),
                                offset,
                                width_f,
                                height_f,
                            );
                        }
                    }
                }
                for glyph in glyphs {
                    let Some(uv) = self.atlas_uvs.get(&glyph.cache_key).copied() else {
                        continue;
                    };
                    push_glyph_quad(
                        &mut vertices,
                        glyph,
                        uv,
                        glyph.color,
                        (0.0, 0.0),
                        width_f,
                        height_f,
                    );
                }
                calls.push(DrawCall {
                    vertices,
                    texture: TextureKey::Atlas,
                });
            }
        }
    }
}

pub(crate) fn asset_key(id: &str, hash: &str) -> String {
    format!("{id}:{hash}")
}

/// sRGB-encoded vertex colour to linear light, alpha unchanged.
fn linearize(color: &mut [f32; 4]) {
    for channel in color.iter_mut().take(3) {
        *channel = crate::effects::srgb_to_linear(f64::from(*channel)) as f32;
    }
}

/// Elements with their index, bottom to top by `z`; equal `z` keeps element order.
fn draw_order(elements: &[SlideElement]) -> Vec<(usize, &SlideElement)> {
    let mut ordered: Vec<(usize, &SlideElement)> = elements.iter().enumerate().collect();
    ordered.sort_by_key(|(_, element)| element.z());
    ordered
}

/// Unique non-zero box radii required by blurred shadows on these elements.
fn shadow_radii(elements: &[SlideElement], scale: f32) -> Vec<u32> {
    let mut radii = Vec::new();
    for layer in elements {
        if let SlideElement::Text {
            shadow: Some(shadow),
            ..
        } = layer
        {
            let radius = box_radius_for_sigma(shadow.blur * f64::from(scale));
            if radius > 0 && !radii.contains(&radius) {
                radii.push(radius);
            }
        }
    }
    radii
}

/// Owns the wgpu surface of one audience output and draws its composition through one screen.
pub struct SurfaceRenderer {
    _instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    timing: FrameTiming,
    /// The composition and screen on air; black until the first one arrives.
    composition: Option<(Box<Composition>, Box<Screen>)>,
    compositor: Compositor,
}

impl SurfaceRenderer {
    /// Builds the adapter, device and configured surface. Call this on the render thread with a
    /// `PendingSurface` created on the main thread. The output is black until
    /// [`Self::set_composition`].
    pub fn new(pending: PendingSurface, width: u32, height: u32) -> Result<Self, RenderError> {
        let PendingSurface { instance, surface } = pending;
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: Some(&surface),
            apply_limit_buckets: false,
        }))
        .map_err(|error| RenderError::Backend(format!("request adapter: {error}")))?;

        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("lumen-output"),
            required_features: device_features(&adapter),
            required_limits: wgpu::Limits::default(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .map_err(|error| RenderError::Backend(format!("request device: {error}")))?;

        let capabilities = surface.get_capabilities(&adapter);
        let format = pick_format(&capabilities)?;
        let present_mode = capabilities
            .present_modes
            .first()
            .copied()
            .unwrap_or(wgpu::PresentMode::Fifo);
        let alpha_mode = capabilities
            .alpha_modes
            .first()
            .copied()
            .unwrap_or(wgpu::CompositeAlphaMode::Auto);

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            width: width.max(1),
            height: height.max(1),
            present_mode,
            desired_maximum_frame_latency: 2,
            alpha_mode,
            view_formats: Vec::new(),
        };
        surface.configure(&device, &config);
        let compositor = Compositor::new(device.clone(), queue.clone());

        Ok(Self {
            _instance: instance,
            surface,
            adapter,
            device,
            queue,
            config,
            timing: FrameTiming::new(),
            composition: None,
            compositor,
        })
    }

    /// Shows a composition through one screen. Layer source changes and slide revisions use
    /// `transition`.
    pub fn set_composition(
        &mut self,
        composition: &Composition,
        screen: &Screen,
        transition: CompositionTransition,
    ) -> Result<(), RenderError> {
        self.compositor.set_transition(transition);
        self.composition = Some((Box::new(composition.clone()), Box::new(screen.clone())));
        Ok(())
    }

    /// Replaces the surface after `Lost` or `Outdated`. The new surface must be created on the
    /// main thread by [`SurfaceFactory::create_surface`].
    pub fn replace_surface(&mut self, pending: PendingSurface) -> Result<(), RenderError> {
        let PendingSurface { surface, .. } = pending;
        let capabilities = surface.get_capabilities(&self.adapter);
        self.config.format = pick_format(&capabilities)?;
        self.surface = surface;
        self.surface.configure(&self.device, &self.config);
        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        let width = width.max(1);
        let height = height.max(1);
        if self.config.width == width && self.config.height == height {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
    }

    /// Uploads an RGBA frame for a video asset.
    pub fn update_video_frame(
        &mut self,
        asset_id: &str,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), RenderError> {
        self.update_video(asset_id, &VideoFrame::rgba(width, height, rgba.to_vec()))
    }

    /// Uploads a decoded frame, block compressed or RGBA.
    pub fn update_video(&mut self, asset_id: &str, frame: &VideoFrame) -> Result<(), RenderError> {
        self.compositor.update_video(asset_id, frame)
    }

    pub fn stats(&self) -> RenderStats {
        self.timing.stats()
    }

    pub fn render_frame(&mut self) -> Result<(), RenderError> {
        let start = Instant::now();
        let (texture, suboptimal) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) => (texture, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(texture) => (texture, true),
            wgpu::CurrentSurfaceTexture::Timeout => return Err(RenderError::SurfaceTimeout),
            wgpu::CurrentSurfaceTexture::Occluded => return Err(RenderError::SurfaceOccluded),
            wgpu::CurrentSurfaceTexture::Outdated => return Err(RenderError::SurfaceOutdated),
            wgpu::CurrentSurfaceTexture::Lost => return Err(RenderError::SurfaceLost),
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err(RenderError::Backend("surface validation error".into()));
            }
        };

        let view = texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("lumen-output-frame"),
            });

        if let Some((composition, screen)) = self.composition.as_ref() {
            self.compositor.render(
                &mut encoder,
                composition,
                screen,
                &view,
                self.config.format,
                self.config.width,
                self.config.height,
            )?;
        } else {
            encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(CLEAR_PASS_LABEL),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
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
        }

        self.queue.submit([encoder.finish()]);
        self.queue.present(texture);
        if suboptimal {
            self.surface.configure(&self.device, &self.config);
        }

        self.timing.record(start.elapsed().as_secs_f64() * 1_000.0);
        Ok(())
    }
}

fn pick_format(
    capabilities: &wgpu::SurfaceCapabilities,
) -> Result<wgpu::TextureFormat, RenderError> {
    capabilities
        .formats
        .iter()
        .copied()
        .find(wgpu::TextureFormat::is_srgb)
        .or_else(|| capabilities.formats.first().copied())
        .ok_or_else(|| RenderError::Backend("surface reports no formats".into()))
}

/// A rendered composition frame: raw RGBA plus the editor layout from the same pass.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionFrame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub layout: CompositionPreviewResult,
}

/// Offscreen renderer used by `preview_render_composition`.
pub struct PreviewRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    /// Created on the first composition preview.
    compositor: Option<Compositor>,
    composition_surface: Option<(u32, u32, wgpu::Texture, wgpu::TextureView)>,
    /// Latest frame per video asset, replayed into a compositor created later. Frames are
    /// reference counted, so this holds no copies.
    latest_frames: HashMap<String, VideoFrame>,
}

impl PreviewRenderer {
    pub fn new() -> Result<Self, RenderError> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            apply_limit_buckets: false,
        }))
        .map_err(|error| RenderError::Backend(format!("request preview adapter: {error}")))?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("lumen-preview"),
            required_features: device_features(&adapter),
            required_limits: wgpu::Limits::default(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .map_err(|error| RenderError::Backend(format!("request preview device: {error}")))?;
        Ok(Self {
            device,
            queue,
            compositor: None,
            composition_surface: None,
            latest_frames: HashMap::new(),
        })
    }

    /// The composition renderer on this device, created on first use.
    fn compositor(&mut self) -> Result<&mut Compositor, RenderError> {
        if self.compositor.is_none() {
            let mut compositor = Compositor::new(self.device.clone(), self.queue.clone());
            for (asset_id, frame) in &self.latest_frames {
                compositor.update_video(asset_id, frame)?;
            }
            self.compositor = Some(compositor);
        }
        self.compositor
            .as_mut()
            .ok_or_else(|| RenderError::Backend("compositor missing".into()))
    }

    /// Fixes the generator and transition clock in seconds; `None` follows wall time.
    pub fn set_composition_clock(&mut self, seconds: Option<f64>) -> Result<(), RenderError> {
        self.compositor()?.set_clock(seconds);
        Ok(())
    }

    /// Renders a composition offscreen: the bare canvas, or one screen with its layout and
    /// mapping. Returns RGBA bytes and the editor layout keyed by layer, source and element.
    pub fn render_composition(
        &mut self,
        composition: &Composition,
        screen: Option<&Screen>,
        width: u32,
        height: u32,
    ) -> Result<CompositionFrame, RenderError> {
        if width == 0 || height == 0 {
            return Ok(CompositionFrame {
                width,
                height,
                rgba: Vec::new(),
                layout: CompositionPreviewResult {
                    revision: composition.revision,
                    ..CompositionPreviewResult::default()
                },
            });
        }
        let format = wgpu::TextureFormat::Rgba8UnormSrgb;
        let needs_surface = self
            .composition_surface
            .as_ref()
            .is_none_or(|(w, h, _, _)| *w != width || *h != height);
        if needs_surface {
            let texture = preview_target(
                &self.device,
                "lumen-composition-preview",
                width,
                height,
                format,
            );
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            self.composition_surface = Some((width, height, texture, view));
        }
        let canvas_screen;
        let screen = match screen {
            Some(screen) => screen,
            None => {
                canvas_screen = Screen::canvas(composition.canvas);
                &canvas_screen
            }
        };
        let (texture, view) = match self.composition_surface.as_ref() {
            Some((_, _, texture, view)) => (texture.clone(), view.clone()),
            None => return Err(RenderError::Backend("composition target missing".into())),
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("lumen-composition-preview"),
            });
        let layout = self.compositor()?.render(
            &mut encoder,
            composition,
            screen,
            &view,
            format,
            width,
            height,
        )?;
        let rgba = read_back(&self.device, &self.queue, encoder, &texture, width, height)?;
        Ok(CompositionFrame {
            width,
            height,
            rgba,
            layout,
        })
    }

    /// Uploads an RGBA frame for a video asset.
    pub fn update_video_frame(
        &mut self,
        asset_id: &str,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), RenderError> {
        self.update_video(asset_id, &VideoFrame::rgba(width, height, rgba.to_vec()))
    }

    /// Uploads a decoded frame, block compressed or RGBA.
    pub fn update_video(&mut self, asset_id: &str, frame: &VideoFrame) -> Result<(), RenderError> {
        self.latest_frames
            .insert(asset_id.to_string(), frame.clone());
        match self.compositor.as_mut() {
            Some(compositor) => compositor.update_video(asset_id, frame),
            None => Ok(()),
        }
    }

    /// Whether this device uploads Hap frames as BC textures.
    pub fn bc_supported(&mut self) -> Result<bool, RenderError> {
        Ok(self.compositor()?.bc_supported())
    }
}

/// An offscreen render target that can be read back.
fn preview_target(
    device: &wgpu::Device,
    label: &str,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

/// Copies an RGBA8 texture to the CPU after the commands in `encoder`, row-major and unpadded.
pub(crate) fn read_back(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    mut encoder: wgpu::CommandEncoder,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, RenderError> {
    let padded_bytes_per_row = (width * 4).div_ceil(256) * 256;
    let buffer_size = u64::from(padded_bytes_per_row) * u64::from(height);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("lumen-preview-readback"),
        size: buffer_size,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit([encoder.finish()]);

    let (sender, receiver) = mpsc::channel();
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .map_err(|error| RenderError::Backend(format!("preview poll: {error}")))?;
    receiver
        .recv()
        .map_err(|error| RenderError::Backend(format!("preview map channel: {error}")))?
        .map_err(|error| RenderError::Backend(format!("preview map: {error}")))?;

    let mapped = buffer
        .slice(..)
        .get_mapped_range()
        .map_err(|error| RenderError::Backend(format!("preview map range: {error}")))?;
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    let row_bytes = width as usize * 4;
    for row in 0..height as usize {
        let start = row * padded_bytes_per_row as usize;
        rgba.extend_from_slice(&mapped[start..start + row_bytes]);
    }
    drop(mapped);
    buffer.unmap();
    Ok(rgba)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// GPU cost of the A1 budget: 8 Hap Q 1080p layers uploaded and composited per
    /// frame. The preview path also reads the frame back to the CPU, so this is an
    /// upper bound for an output window. Run with
    /// `cargo test --release -p lumen-render bench -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench_eight_hap_q_layers_1080p() {
        let layers: Vec<serde_json::Value> = (0..8)
            .map(|index| {
                serde_json::json!({
                    "kind": "video",
                    "id": format!("layer-{index}"),
                    "frame": { "x": (index % 4) as f64 * 0.25, "y": (index / 4) as f64 * 0.5, "w": 0.25, "h": 0.5, "rotation": 0 },
                    "opacity": 0.9,
                    "source": { "assetId": format!("clip-{index}"), "hash": "h" },
                    "fit": "cover"
                })
            })
            .collect();
        let assets: Vec<serde_json::Value> = (0..8)
            .map(|index| serde_json::json!({ "id": format!("clip-{index}"), "hash": "h", "kind": "video", "intrinsic": { "width": 1920, "height": 1080 } }))
            .collect();
        let scene: Scene = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1, "revision": 1, "role": "preview",
            "viewport": { "width": 1920, "height": 1080 },
            "layers": layers, "fonts": [], "assets": assets,
            "safeArea": { "top": 0, "right": 0, "bottom": 0, "left": 0 }
        }))
        .expect("scene");
        let mut renderer = PreviewRenderer::new().expect("preview renderer");
        let size = crate::video::bc_len(1920, 1080, 16);
        let frames: Vec<Arc<[u8]>> = (0..4u8)
            .map(|seed| {
                Arc::from(
                    (0..size)
                        .map(|index| (index as u8).wrapping_mul(31).wrapping_add(seed))
                        .collect::<Vec<u8>>(),
                )
            })
            .collect();
        let rounds = 120;
        let mut upload = std::time::Duration::ZERO;
        let mut render = std::time::Duration::ZERO;
        for round in 0..rounds {
            let started = std::time::Instant::now();
            for layer in 0..8 {
                let pixels =
                    VideoPixels::Bc3YCoCg(Arc::clone(&frames[(round + layer) % frames.len()]));
                renderer
                    .update_video(
                        &format!("clip-{layer}"),
                        &VideoFrame {
                            width: 1920,
                            height: 1080,
                            pixels,
                        },
                    )
                    .expect("upload");
            }
            upload += started.elapsed();
            let started = std::time::Instant::now();
            renderer.render(&scene, 1920, 1080).expect("render");
            render += started.elapsed();
        }
        eprintln!(
            "8 × hap q 1080p on GPU (BC: {}): upload {:.2} ms/frame, composite + readback {:.2} ms/frame, total {:.2} ms (60 fps budget 16.67 ms)",
            renderer.scene_renderer.bc_supported,
            upload.as_secs_f64() * 1000.0 / rounds as f64,
            render.as_secs_f64() * 1000.0 / rounds as f64,
            (upload + render).as_secs_f64() * 1000.0 / rounds as f64,
        );
    }

    /// Renders block-compressed video frames on the real GPU. Ignored in CI (no GPU);
    /// run with `cargo test -p lumen-render -- --ignored`.
    #[test]
    #[ignore]
    fn gpu_renders_block_compressed_video() {
        let scene: Scene = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "revision": 1,
            "role": "preview",
            "viewport": { "width": 64, "height": 64 },
            "layers": [{
                "kind": "video",
                "id": "clip-layer",
                "frame": { "x": 0, "y": 0, "w": 1, "h": 1, "rotation": 0 },
                "source": { "assetId": "clip", "hash": "h" },
                "fit": "stretch"
            }],
            "fonts": [],
            "assets": [{ "id": "clip", "hash": "h", "kind": "video", "intrinsic": { "width": 6, "height": 6 } }],
            "safeArea": { "top": 0, "right": 0, "bottom": 0, "left": 0 }
        }))
        .expect("scene");
        let mut renderer = PreviewRenderer::new().expect("preview renderer");
        eprintln!(
            "BC textures on this GPU: {}",
            renderer.scene_renderer.bc_supported
        );
        let centre = |frame: &PreviewFrame| {
            let offset = ((frame.height / 2) * frame.width + frame.width / 2) as usize * 4;
            [
                frame.rgba[offset],
                frame.rgba[offset + 1],
                frame.rgba[offset + 2],
            ]
        };

        // 6×6 pads to 2×2 blocks. Solid red DXT1 in three-colour mode would be
        // transparent on index 3; Hap DXT1 must stay opaque.
        let red = [0x00, 0xF8, 0x00, 0xF8, 0, 0, 0, 0].repeat(4);
        renderer
            .update_video(
                "clip",
                &VideoFrame {
                    width: 6,
                    height: 6,
                    pixels: VideoPixels::Bc1(Arc::from(red)),
                },
            )
            .expect("bc1 frame");
        let frame = renderer.render(&scene, 64, 64).expect("render bc1");
        assert_eq!(centre(&frame), [255, 0, 0]);

        // Scaled YCoCg grey: Co = Cg ≈ 0.5 (565 0x8400), scale 0, Y = 200.
        let mut block = vec![200u8, 200, 0, 0, 0, 0, 0, 0];
        block.extend_from_slice(&[0x00, 0x84, 0x00, 0x84, 0, 0, 0, 0]);
        renderer
            .update_video(
                "clip",
                &VideoFrame {
                    width: 6,
                    height: 6,
                    pixels: VideoPixels::Bc3YCoCg(Arc::from(block.repeat(4))),
                },
            )
            .expect("ycocg frame");
        let frame = renderer.render(&scene, 64, 64).expect("render ycocg");
        let [r, g, b] = centre(&frame);
        for channel in [r, g, b] {
            assert!(
                channel.abs_diff(200) <= 10,
                "ycocg grey came out as {r},{g},{b}"
            );
        }
    }

    #[test]
    fn frame_timing_tracks_last_and_average() {
        let mut timing = FrameTiming::new();
        assert_eq!(timing.stats(), RenderStats::default());
        timing.record(10.0);
        timing.record(20.0);
        let stats = timing.stats();
        assert_eq!(stats.frame, 2);
        assert_eq!(stats.last_frame_ms, 20.0);
        assert_eq!(stats.average_frame_ms, 15.0);
    }

    #[test]
    fn frame_timing_ignores_invalid_samples() {
        let mut timing = FrameTiming::new();
        timing.record(-1.0);
        timing.record(f64::NAN);
        assert_eq!(timing.frame(), 0);
    }

    #[test]
    fn classifies_surface_states() {
        assert_eq!(
            surface_action(&wgpu::CurrentSurfaceTexture::Lost),
            SurfaceAction::Reconfigure
        );
        assert_eq!(
            surface_action(&wgpu::CurrentSurfaceTexture::Outdated),
            SurfaceAction::Reconfigure
        );
        assert_eq!(
            surface_action(&wgpu::CurrentSurfaceTexture::Timeout),
            SurfaceAction::SkipFrame
        );
        assert_eq!(
            surface_action(&wgpu::CurrentSurfaceTexture::Occluded),
            SurfaceAction::SkipFrame
        );
        assert_eq!(
            surface_action(&wgpu::CurrentSurfaceTexture::Validation),
            SurfaceAction::Fatal
        );
    }

    #[test]
    fn clear_color_falls_back_to_black() {
        let mut scene = spike_scene();
        scene.background = None;
        assert_eq!(scene_clear_color(&scene), ClearColor::BLACK);
        assert_eq!(
            scene_clear_color(&spike_scene()),
            ClearColor::parse("#101828").unwrap()
        );
    }

    #[test]
    fn shaders_parse_and_validate() {
        for source in [SCENE_SHADER, TRANSITION_SHADER] {
            let module = wgpu::naga::front::wgsl::parse_str(source).expect("shader parses");
            let mut validator = wgpu::naga::valid::Validator::new(
                wgpu::naga::valid::ValidationFlags::all(),
                wgpu::naga::valid::Capabilities::empty(),
            );
            validator.validate(&module).expect("shader validates");
        }
    }

    #[test]
    fn transition_codes_are_stable() {
        assert_eq!(transition_code(TransitionKind::Cut), 0);
        assert_eq!(transition_code(TransitionKind::Fade), 1);
        assert_eq!(transition_code(TransitionKind::Dissolve), 2);
        assert_eq!(transition_code(TransitionKind::Slide), 3);
        assert_eq!(transition_code(TransitionKind::Zoom), 4);
    }

    #[test]
    fn shadow_radii_are_unique_and_scale_aware() {
        let text = |id: &str, blur: f64| Layer::Text {
            id: id.into(),
            frame: crate::Frame {
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0,
                rotation: 0.0,
            },
            z: 0,
            opacity: 1.0,
            runs: vec![crate::TextRun {
                text: "hello".into(),
                ..crate::TextRun::default()
            }],
            font_id: "inter".into(),
            font_size: 32.0,
            weight: 400,
            color: "#ffffff".into(),
            align: crate::TextAlign::Left,
            v_align: crate::TextVAlign::Top,
            line_height: 1.2,
            letter_spacing: 0.0,
            fit: crate::TextFit::Wrap,
            padding: 0.0,
            max_lines: None,
            shadow: Some(crate::TextShadow {
                color: "#000000".into(),
                blur,
                offset_x: 0.0,
                offset_y: 0.0,
            }),
            outline: None,
        };
        let scene = Scene {
            layers: vec![text("a", 4.0), text("b", 4.0), text("c", 0.0)],
            ..spike_scene()
        };
        let radii = shadow_radii(&scene, 1.0);
        assert_eq!(radii.len(), 1);
        assert!(radii[0] > 0);
        let scaled = shadow_radii(&scene, 2.0);
        assert!(scaled[0] > radii[0]);
    }

    #[test]
    fn draw_order_is_stable_within_a_z() {
        let scene = Scene {
            layers: vec![
                Layer::Shape {
                    id: "back".into(),
                    frame: crate::Frame {
                        x: 0.0,
                        y: 0.0,
                        w: 1.0,
                        h: 1.0,
                        rotation: 0.0,
                    },
                    z: 5,
                    opacity: 1.0,
                    fill: "#000000".into(),
                    stroke: None,
                    stroke_width: 0.0,
                    radius: 0.0,
                },
                Layer::Shape {
                    id: "front".into(),
                    frame: crate::Frame {
                        x: 0.0,
                        y: 0.0,
                        w: 1.0,
                        h: 1.0,
                        rotation: 0.0,
                    },
                    z: 1,
                    opacity: 1.0,
                    fill: "#ffffff".into(),
                    stroke: None,
                    stroke_width: 0.0,
                    radius: 0.0,
                },
            ],
            ..spike_scene()
        };
        let mut ordered: Vec<&Layer> = scene.layers.iter().collect();
        ordered.sort_by_key(|layer| layer.z());
        assert_eq!(ordered[0].id(), "front");
        assert_eq!(ordered[1].id(), "back");
    }
}
