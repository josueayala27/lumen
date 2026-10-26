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

`lumen-media` owns playback. Audio is the master clock; video seeks to it within 40 ms.

Two decode paths, chosen per file by `hap_track` in `src/media.rs`:

- **Hap** (`Hap1`, `Hap5`, `HapY`, `HapM`, `HapA`, `Hap7` in QuickTime): `mov.rs` reads the sample table and `hap.rs` undoes the Snappy or chunked second stage on a plain thread. Frames stay block compressed (BC1/BC3/BC4/BC7) and upload to the GPU as-is when the device has `TEXTURE_COMPRESSION_BC`; Hap Q's Scaled YCoCg converts in `scene.wgsl` (mode 3) and Hap DXT1 renders opaque (mode 4). Without BC support, and always for Hap Q Alpha, `lumen-render/src/bc.rs` decodes on the CPU. Every Hap frame is an intra frame, so the thread shows the sample at the clip position: frame-accurate, no drift. Up to 16 Hap decoders.
- **Everything else**: an ffmpeg process with `-hwaccel auto` (VideoToolbox, D3D11) piping RGBA. Up to 4 decoders.

Frames reach the preview and every output as one reference-counted `VideoFrame`; fan-out never copies pixels. The GPU path is covered by an ignored test (`cargo test -p lumen-render -- --ignored`), since CI has no GPU.

## Stage display

The stage display is a webview window. Current/next images come from Rust; notes, clock, timers and controls are Vue. A native stage renderer is optional later.
