# 05 — Desktop output

Audience output is a Tauri window with no webview. `lumen-output` owns monitor enumeration, placement and window lifecycle.

## Window lifecycle

- Create windows on the main thread with `run_on_main_thread`; never from a synchronous command.
- `WindowBuilder` requires Tauri's `unstable` feature. Keep it inside `lumen-output`.
- Audience windows are borderless, undecorated, resizable(false), cursor-hidden, taskbar-hidden and always-on-top where supported.
- macOS: use a borderless monitor-sized cover, not native fullscreen, so Spaces do not move the window.
- Windows: set position and size from the monitor rect at its scale factor.
- Persist the monitor assignment by stable display name plus position; re-resolve after hotplug.
- Poll monitors every second. Tauri has no documented monitor add/remove event.

## Render thread

Each output owns a thread with a `wgpu` device, surface and command channel. The main thread handles resize, close and monitor changes. On `SurfaceError::Lost` or `Outdated`, recreate the surface after sleep, lock, DPI change or disconnect. Drop the surface before the window.

## Power and teardown

Hold a power assertion while live (`SetThreadExecutionState` on Windows, a power assertion on macOS) and prevent display sleep. Defer auto-updates during live. Close windows in reverse creation order.

## Media

`lumen-media` owns playback. Audio is the master clock; video seeks to it within 40 ms. Prefer platform decoders for H.264/AAC and use an LGPL ffmpeg sidecar for other codecs. Cap concurrent decoders at two and preload the next cue.

## Stage display

The stage display is a webview window. Current/next images come from Rust; notes, clock, timers and controls are Vue. A native stage renderer is optional later.
