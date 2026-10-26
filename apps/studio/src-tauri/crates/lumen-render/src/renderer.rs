//! wgpu surface renderer for the native audience output.
//!
//! The Phase 0.5 spike owns one instance, surface, device and queue and clears the surface with
//! the scene background color. Layers and text shaping are intentionally out of scope.

use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use serde::{Deserialize, Serialize};
use std::time::Instant;

use crate::{Layer, RenderError, Scene};

const CLEAR_PASS_LABEL: &str = "lumen-clear-pass";

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

/// Small RGBA color used by the clear pass and the CPU preview.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClearColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

impl Default for ClearColor {
    fn default() -> Self {
        Self::BLACK
    }
}

impl ClearColor {
    pub const BLACK: Self = Self {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    };

    pub fn from_rgba8(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self {
            r: f64::from(r) / 255.0,
            g: f64::from(g) / 255.0,
            b: f64::from(b) / 255.0,
            a: f64::from(a) / 255.0,
        }
    }

    /// Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and the named colors used by the spike.
    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim();
        if value.eq_ignore_ascii_case("black") {
            return Some(Self::BLACK);
        }
        if value.eq_ignore_ascii_case("white") {
            return Some(Self::from_rgba8(255, 255, 255, 255));
        }
        if value.eq_ignore_ascii_case("transparent") {
            return Some(Self::from_rgba8(0, 0, 0, 0));
        }

        let hex = value.strip_prefix('#').unwrap_or(value);
        let expand = |digit: u8| {
            let value = (digit as char).to_digit(16)?;
            Some((value * 17) as u8)
        };
        let pair = |text: &str| u8::from_str_radix(text, 16).ok();

        let (r, g, b, a) = match hex.len() {
            3 => (
                expand(hex.as_bytes()[0])?,
                expand(hex.as_bytes()[1])?,
                expand(hex.as_bytes()[2])?,
                255,
            ),
            4 => (
                expand(hex.as_bytes()[0])?,
                expand(hex.as_bytes()[1])?,
                expand(hex.as_bytes()[2])?,
                expand(hex.as_bytes()[3])?,
            ),
            6 => (
                pair(&hex[0..2])?,
                pair(&hex[2..4])?,
                pair(&hex[4..6])?,
                255,
            ),
            8 => (
                pair(&hex[0..2])?,
                pair(&hex[2..4])?,
                pair(&hex[4..6])?,
                pair(&hex[6..8])?,
            ),
            _ => return None,
        };

        Some(Self::from_rgba8(r, g, b, a))
    }

    pub fn to_rgba8(self) -> [u8; 4] {
        let to_byte = |channel: f64| (channel.clamp(0.0, 1.0) * 255.0).round() as u8;
        [
            to_byte(self.r),
            to_byte(self.g),
            to_byte(self.b),
            to_byte(self.a),
        ]
    }

    fn to_wgpu(self) -> wgpu::Color {
        wgpu::Color {
            r: self.r,
            g: self.g,
            b: self.b,
            a: self.a,
        }
    }
}

fn layer_color(layer: &Layer) -> Option<ClearColor> {
    match layer {
        Layer::Shape { fill, .. } => ClearColor::parse(fill),
        Layer::Text { color, .. } => ClearColor::parse(color),
        Layer::Image { .. } | Layer::Video { .. } => None,
    }
}

/// Uses the scene background layer color, falling back to opaque black.
pub fn scene_clear_color(scene: &Scene) -> ClearColor {
    scene
        .background
        .as_ref()
        .and_then(layer_color)
        .unwrap_or_default()
}

/// Hardcoded Phase 0.5 scene. No text or transitions.
pub fn spike_scene() -> Scene {
    Scene {
        schema_version: 1,
        revision: 1,
        role: crate::SceneRole::Audience,
        viewport: crate::Viewport {
            width: 1920.0,
            height: 1080.0,
            scale: 1.0,
        },
        background: Some(Layer::Shape {
            id: "spike-background".into(),
            frame: crate::Frame {
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0,
            },
            z: 0,
            opacity: 1.0,
            fill: "#101828".into(),
        }),
        layers: Vec::new(),
        fonts: Vec::new(),
        assets: Vec::new(),
        safe_area: crate::SafeArea {
            top: 0.05,
            right: 0.05,
            bottom: 0.05,
            left: 0.05,
        },
    }
}

/// An instance and a surface created on the main thread. wgpu requires main-thread surface
/// creation on macOS, while the device and frame loop live on the output render thread.
pub struct PendingSurface {
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
}

/// Creates the wgpu instance and surface. Call this from the main thread.
pub fn create_window_surface<W>(window: W) -> Result<PendingSurface, RenderError>
where
    W: HasWindowHandle + HasDisplayHandle + Send + Sync + 'static,
{
    let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
    descriptor.backends = wgpu::Backends::all();
    let instance = wgpu::Instance::new(descriptor);
    let surface = instance
        .create_surface(window)
        .map_err(|error| RenderError::Backend(format!("create surface: {error}")))?;
    Ok(PendingSurface { instance, surface })
}

/// Owns the wgpu surface and draws the clear pass.
pub struct SurfaceRenderer {
    _instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    clear: ClearColor,
    timing: FrameTiming,
}

impl SurfaceRenderer {
    /// Builds the adapter, device and configured surface. Call this on the render thread with a
    /// `PendingSurface` created on the main thread.
    pub fn new(
        pending: PendingSurface,
        width: u32,
        height: u32,
        scene: &Scene,
    ) -> Result<Self, RenderError> {
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
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .map_err(|error| RenderError::Backend(format!("request device: {error}")))?;

        let capabilities = surface.get_capabilities(&adapter);
        let format = capabilities
            .formats
            .iter()
            .copied()
            .find(wgpu::TextureFormat::is_srgb)
            .or_else(|| capabilities.formats.first().copied())
            .ok_or_else(|| RenderError::Backend("surface reports no formats".into()))?;
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

        Ok(Self {
            _instance: instance,
            surface,
            device,
            queue,
            config,
            clear: scene_clear_color(scene),
            timing: FrameTiming::new(),
        })
    }

    pub fn set_scene(&mut self, scene: &Scene) {
        self.clear = scene_clear_color(scene);
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

    /// Re-applies the surface configuration after `Lost` or `Outdated`.
    pub fn recreate_surface(&mut self) -> Result<(), RenderError> {
        self.surface.configure(&self.device, &self.config);
        Ok(())
    }

    pub fn stats(&self) -> RenderStats {
        self.timing.stats()
    }

    pub fn render_frame(&mut self) -> Result<(), RenderError> {
        let start = Instant::now();
        let texture = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) => texture,
            wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
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
                label: Some("lumen-clear"),
            });
        {
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(CLEAR_PASS_LABEL),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(self.clear.to_wgpu()),
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

        self.timing
            .record(start.elapsed().as_secs_f64() * 1_000.0);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn parses_hex_and_named_colors() {
        assert_eq!(
            ClearColor::parse("#ff8000"),
            Some(ClearColor::from_rgba8(255, 128, 0, 255))
        );
        assert_eq!(
            ClearColor::parse("#0f08"),
            Some(ClearColor::from_rgba8(0, 255, 0, 136))
        );
        assert_eq!(ClearColor::parse("white"), Some(ClearColor::from_rgba8(255, 255, 255, 255)));
        assert_eq!(ClearColor::parse("not-a-color"), None);
    }

    #[test]
    fn clear_color_falls_back_to_black() {
        let mut scene = spike_scene();
        scene.background = None;
        assert_eq!(scene_clear_color(&scene), ClearColor::BLACK);
        assert_eq!(scene_clear_color(&spike_scene()), ClearColor::parse("#101828").unwrap());
    }
}
