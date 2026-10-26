//! Native audience output windows.
//!
//! The audience surface is a Tauri window without a webview. wgpu rendering is added in the
//! Phase 0.5 spike; this crate owns monitor enumeration, placement and window lifecycle so the
//! rest of the app never depends on Tauri's unstable window API directly.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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

#[cfg(test)]
mod tests {
    use super::placement;

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
}
