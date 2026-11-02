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

Frames reach the preview and every output as one reference-counted `VideoFrame`; fan-out never copies pixels.

`VideoPlaybackManager` tracks demand per caller: `output` (`apply_scene`, `apply_transition`), `preview` (`preview_render`) and `preload` (`preload_scene`, sent by `useShowOutput` with the next rundown cue). A video decodes while any caller wants it, so the editor preview never stops a video on the audience output. Preloaded videos start paused on their first frame and play from it when an output scene takes them.

Each decoder follows a `VideoTransport` (`lumen-media/src/transport.rs`): play, pause, seek and rate on a monotonic clock, set through `video_transport`. The timeline runner (`useShowTimeline`) seeks on every resync and play/pause change and re-anchors running clips once a second; seeks within 40 ms of the current position only re-anchor. Hap follows the transport frame by frame. ffmpeg restarts at the new position on a real change and ignores rate.

Budget (synthetic Hap Q 1080p, Apple Silicon, release): decode about 1,700 fps per layer on 8 threads; 8 layers upload and composite in 4.7 ms per frame including preview read-back. Disk throughput is the real limit: 8 × 1080p60 Hap Q needs about 720 MB/s. Benchmarks are ignored tests: `cargo test --release -p lumen-media bench -- --ignored --nocapture` and the same for `lumen-render`. The GPU path is covered by an ignored test (`cargo test -p lumen-render -- --ignored`), since CI has no GPU.

## Stage display

The stage display is a webview window. Current/next images come from Rust; notes, clock, timers and controls are Vue. A native stage renderer is optional later.
