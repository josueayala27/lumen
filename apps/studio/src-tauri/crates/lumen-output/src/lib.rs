//! Native audience output windows.
//!
//! The audience surface is a Tauri window without a webview. `lumen-output` owns monitor
//! enumeration, placement, window lifecycle, the render thread and surface recovery. wgpu lives in
//! `lumen-render`; this crate only creates the main-thread surface and drives the frame loop.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, TryRecvError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle, ThreadId};
use std::time::{Duration, Instant};

use lumen_render::{
    PendingSurface, RenderError, RenderStats, Scene, SurfaceFactory, SurfaceRenderer,
    TransitionPlan,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FRAME_INTERVAL: Duration = Duration::from_micros(16_667);
const MONITOR_POLL_INTERVAL: Duration = Duration::from_secs(1);
const RENDERER_START_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub x: i32,
    pub y: i32,
    pub primary: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Placement {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Converts a physical monitor rect into the logical coordinates Tauri expects.
pub fn placement(x: i32, y: i32, width: u32, height: u32, scale_factor: f64) -> Placement {
    let scale = if scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    Placement {
        x: f64::from(x) / scale,
        y: f64::from(y) / scale,
        width: f64::from(width) / scale,
        height: f64::from(height) / scale,
    }
}

/// Monitor list signature comparison. Kept pure so hotplug handling is testable.
pub fn monitors_changed(previous: &[DisplayInfo], current: &[DisplayInfo]) -> bool {
    previous != current
}

/// Resolves a persisted display index, falling back to the primary display and then the first one.
pub fn resolve_display(displays: &[DisplayInfo], index: usize) -> Option<&DisplayInfo> {
    displays
        .get(index)
        .or_else(|| displays.iter().find(|display| display.primary))
        .or_else(|| displays.first())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputWindow {
    pub label: String,
    pub display_index: usize,
    pub width: u32,
    pub height: u32,
}

pub fn list_displays(app: &AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let primary = app.primary_monitor().map_err(|error| error.to_string())?;
    let primary_pos = primary.as_ref().map(|monitor| *monitor.position());
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| DisplayInfo {
            index,
            name: monitor
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Display {}", index + 1)),
            width: monitor.size().width,
            height: monitor.size().height,
            scale_factor: monitor.scale_factor(),
            x: monitor.position().x,
            y: monitor.position().y,
            primary: primary_pos.is_some_and(|position| position == *monitor.position()),
        })
        .collect())
}

/// Opens a borderless native window covering the selected monitor. No webview is attached.
pub fn open_audience_window(app: &AppHandle, display_index: usize) -> Result<OutputWindow, String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let monitor = monitors
        .get(display_index)
        .ok_or_else(|| format!("Display {display_index} is not connected"))?;
    let rect = placement(
        monitor.position().x,
        monitor.position().y,
        monitor.size().width,
        monitor.size().height,
        monitor.scale_factor(),
    );
    let label = format!("audience-{display_index}");

    if let Some(existing) = app.get_window(&label) {
        existing.show().map_err(|error| error.to_string())?;
        return Ok(OutputWindow {
            label,
            display_index,
            width: monitor.size().width,
            height: monitor.size().height,
        });
    }

    let window = tauri::window::WindowBuilder::new(app, label.clone())
        .title("Lumen Audience")
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .position(rect.x, rect.y)
        .inner_size(rect.width, rect.height)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    let _ = window.set_cursor_visible(false);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().ok();

    Ok(OutputWindow {
        label,
        display_index,
        width: monitor.size().width,
        height: monitor.size().height,
    })
}

enum OutputCommand {
    Scene(Box<Scene>),
    Transition(Box<TransitionPlan>),
    VideoFrame {
        asset_id: String,
        width: u32,
        height: u32,
        rgba: Vec<u8>,
    },
    Resize(u32, u32),
    Stop,
}

#[derive(Clone)]
struct RenderControl {
    commands: mpsc::Sender<OutputCommand>,
}

impl RenderControl {
    fn resize(&self, width: u32, height: u32) {
        let _ = self.commands.send(OutputCommand::Resize(width, height));
    }

    fn stop(&self) {
        let _ = self.commands.send(OutputCommand::Stop);
    }
}

struct RenderThread {
    commands: mpsc::Sender<OutputCommand>,
    stats: Arc<Mutex<RenderStats>>,
    join: Option<JoinHandle<()>>,
}

impl RenderThread {
    fn control(&self) -> RenderControl {
        RenderControl {
            commands: self.commands.clone(),
        }
    }

    fn apply_scene(&self, scene: Scene) {
        let _ = self.commands.send(OutputCommand::Scene(Box::new(scene)));
    }

    fn apply_transition(&self, plan: TransitionPlan) {
        let _ = self
            .commands
            .send(OutputCommand::Transition(Box::new(plan)));
    }

    fn video_frame(&self, asset_id: String, width: u32, height: u32, rgba: Vec<u8>) {
        let _ = self.commands.send(OutputCommand::VideoFrame {
            asset_id,
            width,
            height,
            rgba,
        });
    }

    fn resize(&self, width: u32, height: u32) {
        let _ = self.commands.send(OutputCommand::Resize(width, height));
    }

    fn stats(&self) -> RenderStats {
        *self
            .stats
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Drop for RenderThread {
    fn drop(&mut self) {
        let _ = self.commands.send(OutputCommand::Stop);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Recreates the wgpu surface on the Tauri main thread after `Lost` or `Outdated`.
fn recreate_surface_on_main(
    app: &AppHandle,
    factory: &SurfaceFactory,
) -> Result<PendingSurface, String> {
    let (sender, receiver) = mpsc::channel();
    let factory = factory.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(factory.create_surface());
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(RENDERER_START_TIMEOUT)
        .map_err(|error| format!("main thread did not recreate the surface: {error}"))?
        .map_err(|error| error.to_string())
}

/// Spawns the per-window render thread and waits for its device to be ready.
fn spawn_renderer(
    app: AppHandle,
    factory: SurfaceFactory,
    pending: PendingSurface,
    scene: Scene,
    width: u32,
    height: u32,
) -> Result<RenderThread, String> {
    let (commands, receiver) = mpsc::channel();
    let stats = Arc::new(Mutex::new(RenderStats::default()));
    let thread_stats = Arc::clone(&stats);
    let (ready_sender, ready_receiver) = mpsc::channel();

    let join = thread::Builder::new()
        .name("lumen-output-render".into())
        .spawn(move || {
            let mut renderer = match SurfaceRenderer::new(pending, width, height, &scene) {
                Ok(renderer) => {
                    let _ = ready_sender.send(Ok(()));
                    renderer
                }
                Err(error) => {
                    let _ = ready_sender.send(Err(error.to_string()));
                    return;
                }
            };

            loop {
                match receiver.try_recv() {
                    Ok(OutputCommand::Scene(scene)) => {
                        renderer.set_scene(&scene);
                        continue;
                    }
                    Ok(OutputCommand::Transition(plan)) => {
                        if let Err(error) = renderer.start_transition(&plan) {
                            eprintln!("lumen-output: transition failed: {error}");
                        }
                        continue;
                    }
                    Ok(OutputCommand::VideoFrame {
                        asset_id,
                        width,
                        height,
                        rgba,
                    }) => {
                        if let Err(error) =
                            renderer.update_video_frame(&asset_id, width, height, &rgba)
                        {
                            eprintln!("lumen-output: video frame failed: {error}");
                        }
                        continue;
                    }
                    Ok(OutputCommand::Resize(width, height)) => {
                        renderer.resize(width, height);
                        continue;
                    }
                    Ok(OutputCommand::Stop) | Err(TryRecvError::Disconnected) => return,
                    Err(TryRecvError::Empty) => {}
                }

                let started = Instant::now();
                match renderer.render_frame() {
                    Ok(()) => {
                        let snapshot = renderer.stats();
                        *thread_stats
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner()) = snapshot;
                    }
                    Err(RenderError::SurfaceLost | RenderError::SurfaceOutdated) => {
                        thread::sleep(Duration::from_millis(100));
                        match recreate_surface_on_main(&app, &factory) {
                            Ok(pending) => {
                                if let Err(error) = renderer.replace_surface(pending) {
                                    eprintln!("lumen-output: surface recreation failed: {error}");
                                    return;
                                }
                            }
                            Err(error) => {
                                eprintln!("lumen-output: surface recovery failed: {error}");
                            }
                        }
                    }
                    Err(RenderError::SurfaceTimeout | RenderError::SurfaceOccluded) => {}
                    Err(error) => {
                        eprintln!("lumen-output: render loop stopped: {error}");
                        return;
                    }
                }

                let elapsed = started.elapsed();
                if elapsed < FRAME_INTERVAL {
                    thread::sleep(FRAME_INTERVAL.saturating_sub(elapsed));
                }
            }
        })
        .map_err(|error| error.to_string())?;

    match ready_receiver.recv_timeout(RENDERER_START_TIMEOUT) {
        Ok(Ok(())) => Ok(RenderThread {
            commands,
            stats,
            join: Some(join),
        }),
        Ok(Err(message)) => {
            let _ = join.join();
            Err(message)
        }
        Err(error) => Err(format!("render thread did not start: {error}")),
    }
}

struct ManagedOutput {
    display_index: usize,
    width: u32,
    height: u32,
    window: tauri::Window,
    renderer: RenderThread,
}

struct OutputManagerInner {
    app: AppHandle,
    outputs: Mutex<HashMap<String, ManagedOutput>>,
    polling: AtomicBool,
    main_thread: ThreadId,
}

/// Owns every live audience window and its render thread.
#[derive(Clone)]
pub struct OutputManager {
    inner: Arc<OutputManagerInner>,
}

impl OutputManager {
    /// Must be constructed on the Tauri main thread, normally from `setup`.
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Arc::new(OutputManagerInner {
                app,
                outputs: Mutex::new(HashMap::new()),
                polling: AtomicBool::new(false),
                main_thread: thread::current().id(),
            }),
        }
    }

    fn outputs(&self) -> MutexGuard<'_, HashMap<String, ManagedOutput>> {
        self.inner
            .outputs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Opens a window and starts its render thread. Surface creation is marshalled to the main
    /// thread because wgpu requires it on macOS. A hardcoded spike scene is applied immediately.
    pub fn open(&self, display_index: usize) -> Result<OutputWindow, String> {
        if thread::current().id() == self.inner.main_thread {
            return self.open_on_main_thread(display_index);
        }

        let manager = self.clone();
        let (sender, receiver) = mpsc::channel();
        self.inner
            .app
            .run_on_main_thread(move || {
                let _ = sender.send(manager.open_on_main_thread(display_index));
            })
            .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .map_err(|error| format!("main thread did not answer: {error}"))?
    }

    fn open_on_main_thread(&self, display_index: usize) -> Result<OutputWindow, String> {
        let label = format!("audience-{display_index}");
        if let Some(existing) = self.outputs().get(&label) {
            existing.window.show().map_err(|error| error.to_string())?;
            return Ok(OutputWindow {
                label,
                display_index: existing.display_index,
                width: existing.width,
                height: existing.height,
            });
        }

        let output = open_audience_window(&self.inner.app, display_index)?;
        let window = self
            .inner
            .app
            .get_window(&output.label)
            .ok_or_else(|| "audience window disappeared".to_string())?;

        let factory = SurfaceFactory::new(window.clone());
        let pending = match factory.create_surface() {
            Ok(pending) => pending,
            Err(error) => {
                let _ = window.close();
                return Err(error.to_string());
            }
        };
        let renderer = match spawn_renderer(
            self.inner.app.clone(),
            factory,
            pending,
            lumen_render::spike_scene(),
            output.width,
            output.height,
        ) {
            Ok(renderer) => renderer,
            Err(error) => {
                let _ = window.close();
                return Err(error);
            }
        };

        let control = renderer.control();
        window.on_window_event(move |event| match event {
            tauri::WindowEvent::Resized(size) => control.resize(size.width, size.height),
            tauri::WindowEvent::ScaleFactorChanged { new_inner_size, .. } => {
                control.resize(new_inner_size.width, new_inner_size.height);
            }
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                control.stop();
            }
            _ => {}
        });

        self.outputs().insert(
            output.label.clone(),
            ManagedOutput {
                display_index,
                width: output.width,
                height: output.height,
                window,
                renderer,
            },
        );

        Ok(output)
    }

    pub fn close(&self, label: &str) -> Result<(), String> {
        let output = self
            .outputs()
            .remove(label)
            .ok_or_else(|| format!("no output named {label}"))?;
        let ManagedOutput {
            window, renderer, ..
        } = output;
        drop(renderer);
        window.close().map_err(|error| error.to_string())
    }

    pub fn apply_scene(&self, label: Option<&str>, scene: Scene) -> Result<(), String> {
        let outputs = self.outputs();
        match label {
            Some(label) => {
                let output = outputs
                    .get(label)
                    .ok_or_else(|| format!("no output named {label}"))?;
                output.renderer.apply_scene(scene);
            }
            None => {
                if outputs.is_empty() {
                    return Err("no audience output is open".into());
                }
                for output in outputs.values() {
                    output.renderer.apply_scene(scene.clone());
                }
            }
        }
        Ok(())
    }

    pub fn apply_transition(
        &self,
        label: Option<&str>,
        plan: TransitionPlan,
    ) -> Result<(), String> {
        let outputs = self.outputs();
        match label {
            Some(label) => {
                let output = outputs
                    .get(label)
                    .ok_or_else(|| format!("no output named {label}"))?;
                output.renderer.apply_transition(plan);
            }
            None => {
                if outputs.is_empty() {
                    return Err("no audience output is open".into());
                }
                for output in outputs.values() {
                    output.renderer.apply_transition(plan.clone());
                }
            }
        }
        Ok(())
    }

    pub fn update_video_frame(
        &self,
        label: Option<&str>,
        asset_id: String,
        width: u32,
        height: u32,
        rgba: Vec<u8>,
    ) -> Result<(), String> {
        let outputs = self.outputs();
        match label {
            Some(label) => {
                let output = outputs
                    .get(label)
                    .ok_or_else(|| format!("no output named {label}"))?;
                output.renderer.video_frame(asset_id, width, height, rgba);
            }
            None => {
                if outputs.is_empty() {
                    return Err("no audience output is open".into());
                }
                for output in outputs.values() {
                    output
                        .renderer
                        .video_frame(asset_id.clone(), width, height, rgba.clone());
                }
            }
        }
        Ok(())
    }

    pub fn stats(&self, label: Option<&str>) -> Result<RenderStats, String> {
        let outputs = self.outputs();
        match label {
            Some(label) => outputs
                .get(label)
                .map(|output| output.renderer.stats())
                .ok_or_else(|| format!("no output named {label}")),
            None => outputs
                .values()
                .next()
                .map(|output| output.renderer.stats())
                .ok_or_else(|| "no audience output is open".into()),
        }
    }

    /// Polls monitors every second. Tauri has no documented monitor hotplug event.
    pub fn start_monitor_poll(&self) {
        if self.inner.polling.swap(true, Ordering::SeqCst) {
            return;
        }
        let inner = Arc::clone(&self.inner);
        let _ = thread::Builder::new()
            .name("lumen-monitor-poll".into())
            .spawn(move || {
                let mut previous = list_displays(&inner.app).unwrap_or_default();
                loop {
                    thread::sleep(MONITOR_POLL_INTERVAL);
                    let Ok(current) = list_displays(&inner.app) else {
                        continue;
                    };
                    if monitors_changed(&previous, &current) {
                        previous = current.clone();
                        inner.reconcile(&current);
                    }
                }
            });
    }
}

impl OutputManagerInner {
    fn reconcile(&self, displays: &[DisplayInfo]) {
        let mut outputs = self
            .outputs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for output in outputs.values_mut() {
            let Some(display) = resolve_display(displays, output.display_index) else {
                continue;
            };
            let rect = placement(
                display.x,
                display.y,
                display.width,
                display.height,
                display.scale_factor,
            );
            output.display_index = display.index;
            output.width = display.width;
            output.height = display.height;
            output.renderer.resize(display.width, display.height);
            let _ = output
                .window
                .set_position(tauri::LogicalPosition::new(rect.x, rect.y));
            let _ = output
                .window
                .set_size(tauri::LogicalSize::new(rect.width, rect.height));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(index: usize, primary: bool) -> DisplayInfo {
        DisplayInfo {
            index,
            name: format!("Display {index}"),
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            x: 0,
            y: 0,
            primary,
        }
    }

    #[test]
    fn converts_retina_rect_to_logical_points() {
        let rect = placement(1920, 0, 2560, 1440, 2.0);
        assert_eq!(rect.x, 960.0);
        assert_eq!(rect.width, 1280.0);
        assert_eq!(rect.height, 720.0);
    }

    #[test]
    fn tolerates_a_zero_scale_factor() {
        let rect = placement(0, 0, 1920, 1080, 0.0);
        assert_eq!(rect.width, 1920.0);
    }

    #[test]
    fn detects_monitor_changes() {
        let current = vec![display(0, true)];
        assert!(!monitors_changed(&current, &current));
        assert!(monitors_changed(
            &current,
            &[display(0, true), display(1, false)]
        ));
    }

    #[test]
    fn falls_back_to_primary_then_first_display() {
        let displays = vec![display(0, false), display(1, true)];
        assert_eq!(
            resolve_display(&displays, 9).map(|item| item.index),
            Some(1)
        );
        assert_eq!(
            resolve_display(&displays, 0).map(|item| item.index),
            Some(0)
        );
        assert!(resolve_display(&[], 0).is_none());
    }
}
