# 05 — Desktop output

Audience output is a Tauri window with no webview. `lumen-output` owns monitor enumeration, placement and window lifecycle.

## Window lifecycle

- Create windows on the main thread with `run_on_main_thread`; never from a synchronous command.
- `WindowBuilder` requires Tauri's `unstable` feature. Keep it inside `lumen-output`.
- Audience windows are borderless, undecorated, resizable(false), cursor-hidden, taskbar-hidden and always-on-top where supported.
- macOS: use a borderless monitor-sized cover, not native fullscreen, so Spaces do not move the window. `always_on_top` is only `NSFloatingWindowLevel` (3), which the menu bar (24) and Dock (20) draw over, so `lumen-output` raises the `NSWindow` to `NSScreenSaverWindowLevel` (1000) and sets its collection behavior to `CanJoinAllSpaces | Stationary | IgnoresCycle | FullScreenAuxiliary` (`OUTPUT_WINDOW_LEVEL`, `OUTPUT_COLLECTION_BEHAVIOR`). Nothing app-wide changes: no presentation options, so the operator display keeps its menu bar and Dock.
- Windows: set position and size from the monitor rect at its scale factor.
- Persist the monitor assignment by stable display name plus position; re-resolve after hotplug.
- Poll monitors every second. Tauri has no documented monitor add/remove event.

## Testing outputs without a second display

On a Mac with one screen, `pnpm display:virtual` creates a virtual display that macOS, tao and `list_displays` treat as a real monitor (`--count 2` for two, `--hidpi` for Retina, `--mirror` for a preview window, `--list` to print the active displays). Ctrl+C removes it, and the poll reports the change within a second. The tool lives in `tools/virtual-display/`, outside the studio workspace. It uses the private `CGVirtualDisplay` SPI, so it is a dev tool only and never part of the app. Lumen lists the display as `Monitor #19542` (tao uses the model number, which is the tool's product id). See `tools/virtual-display/README.md`.

## Render thread

Each output owns a thread with a `wgpu` device, surface, compositor and command channel. It renders black until `apply_composition` sends its first composition. The loop (`run_output_loop`) drains every pending command before each frame, applies compositions in order, uploads only the newest frame of each video and then always draws, so a stream of video frames never starves the frame or builds a backlog of uploads. `SurfaceRenderer` and `OffscreenOutput` share one frame path (`OutputCore` in `renderer.rs`); the offscreen one draws into a BGRA sRGB texture for tests. The main thread handles resize, close and monitor changes. On `SurfaceError::Lost` or `Outdated`, recreate the surface after sleep, lock, DPI change or disconnect. Drop the surface before the window.

## Power and teardown

Hold a power assertion while live (`SetThreadExecutionState` on Windows, a power assertion on macOS) and prevent display sleep. Defer auto-updates during live. Close windows in reverse creation order.

## Media

`lumen-media` owns playback. Audio is the master clock; video seeks to it within 40 ms.

Two decode paths, chosen per file by `hap_track` in `src/media.rs`:

- **Hap** (`Hap1`, `Hap5`, `HapY`, `HapM`, `HapA`, `Hap7` in QuickTime): `mov.rs` reads the sample table and `hap.rs` undoes the Snappy or chunked second stage on a plain thread. Frames stay block compressed (BC1/BC3/BC4/BC7) and upload to the GPU as-is when the device has `TEXTURE_COMPRESSION_BC`; Hap Q's Scaled YCoCg converts in `compositor.wgsl` (mode 3) and Hap DXT1 renders opaque (mode 4). Without BC support, and always for Hap Q Alpha, `lumen-render/src/bc.rs` decodes on the CPU. Every Hap frame is an intra frame, so the thread shows the sample at the clip position: frame-accurate, no drift. Up to 16 Hap decoders.
- **Everything else**: an ffmpeg process with `-hwaccel auto` (VideoToolbox, D3D11) piping RGBA. Up to 4 decoders.

The decoder is `LUMEN_FFMPEG`, else `ffmpeg` on `PATH`, else the first one in `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin` or `/usr/bin`. An app opened from Finder or the Dock gets launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), which has no Homebrew ffmpeg; without the fallback no ffmpeg video decoded at all and outputs showed their layout background instead. A missing decoder is looked up again on the next video, so no restart is needed after installing it.

Frames reach every output, then the preview, as one reference-counted `VideoFrame`; fan-out never copies pixels. Outputs go first because the preview lock is held while a preview renders. `OutputManager` keeps the newest frame of every video the program composition uses (`LatestFrames`) and replays it into an output when it opens: a paused, held or preloaded video sends no further frames, and a new output would otherwise stay on its background.

`VideoPlaybackManager` tracks demand per caller: one per native output (`output:<label>`, set by `apply_composition` for the outputs that call drove and released by `close_output`), `preview` (`preview_render_composition`) and `preload` (`preload_composition`, sent by `useShowOutput` with the next rundown cue's composition). Each caller wants the video sources on the enabled layers its screens draw. Per-output demand means a call with only some screens (a transition group, a test pattern push from the Screens workspace) never stops another output's videos. A video decodes while any caller wants it, so the editor preview never stops a video on the audience output. Preloaded videos start paused on their first frame and play from it when an output composition takes them.

Each decoder follows a `VideoTransport` (`lumen-media/src/transport.rs`): play, pause, seek and rate on a monotonic clock, set through `video_transport`. The timeline runner (`useShowTimeline`) seeks on every resync and play/pause change and re-anchors running clips once a second; seeks within 40 ms of the current position only re-anchor. Hap follows the transport frame by frame. ffmpeg restarts at the new position on a real change and ignores rate.

Budget (synthetic Hap Q 1080p, Apple Silicon, release): decode about 1,700 fps per layer on 8 threads; 8 layers upload and composite through the compositor in 9.3 ms per frame including preview read-back (2.8 ms upload, 6.6 ms composite and read-back). Disk throughput is the real limit: 8 × 1080p60 Hap Q needs about 720 MB/s. Benchmarks are ignored tests: `cargo test --release -p lumen-media bench -- --ignored --nocapture` and the same for `lumen-render`. The GPU path is covered by ignored tests, since CI has no GPU: `cargo test --release -p lumen-render -- --ignored`, and `cargo test --release -p lumen-output -- --ignored` runs the real output loop on its own device into an offscreen BGRA sRGB target and compares it with the preview (set `LUMEN_TEST_VIDEO=/path/clip.mov` to stream real footage through ffmpeg).

Video posters: import decodes one frame (1 s in, or the middle of a shorter clip) with ffmpeg into `media/posters/<file>.png`; `media_thumbnail` serves it to the media grid and the clip picker.

## Stage display

The stage display is a webview window. Current/next images come from the compositor (`preview_render_composition`); `layout.stage` of the stage screen picks the parts; notes, clock, timers and controls are Vue. A native stage renderer is optional later.
