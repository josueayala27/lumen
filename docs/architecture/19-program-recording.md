# 19 — Program recording

Program recording writes what a screen shows to a movie file: a ProRes master for the archive, an H.264 file to post the same night, or a vertical clip for social media. A recording is a sink on a screen, like a virtual output target. It renders through the same pipeline and never slows the live outputs.

- Screens and layouts: `10-screens-and-mapping.md`. Frame clock, GPU colour conversion and target threads: `13-virtual-outputs.md`. Decode, `VideoFrame` fan-out and the ffmpeg lookup: `05-desktop-output.md`. Commands and state events: `12-command-bus.md`. Disk free check before a show: preflight, doc 16. Recording of live inputs: `18-live-inputs.md`.
- v1 is local only. Recordings are files on a local or attached drive. Lumen does not upload them.

## Rules

1. **Live output first.** A slow encoder or disk never stalls or slows an output. The recording drops frames, counts them, marks them and warns the operator.
2. **A recording follows a screen.** It records the screen's layout and screen state (layer filter, region, text preset, background, blackout, live modes) at the preset's size and rate. It does not record mapping by default (§ What is recorded).
3. **A crash keeps what was recorded.** Files are written in fragments, so a crash or power loss loses at most the last 2 seconds.
4. **Never fill the disk.** Lumen stops a recording cleanly before the drive runs out, and keeps a reserve so the library and the OS keep working.
5. **Recording is a command.** Start, stop and markers go through the command bus, so the UI, Companion, OSC, MIDI and cues all record the same way.

## What is recorded

```
RecordingTarget = { screenId } | { canvas: true }
```

- **Any screen:** a display, a virtual target (NDI, Syphon, Spout, virtual camera, DeckLink) or a `virtual` preview screen. The screen does not need an open output. A disabled screen records black.
- **The canvas:** the whole composition before any screen, at canvas size.
- **Several at once:** each recording is independent. Recording the same screen twice with two presets (ProRes archive and H.264 social) is allowed; the same screen with the same preset twice is rejected as `busy`.
- **Mapping:** recordings tap the screen stage before warp, edge blend, output masks and mapping colour, because an archive should look like the program, not like a warped projector feed. A preset option `mapping: true` records the mapped output instead, for documenting a projection setup.
- **Later:** ISO recording of individual live inputs (doc 18) straight from their frames, without compositing. See Open questions.

## Model

```
RecordingPreset {
  id, name
  codec: 'prores422' | 'prores422hq' | 'prores4444' | 'h264' | 'hevc'
  container: 'mov' | 'mp4'                 ProRes needs mov; H.264 and HEVC take either
  size: { width, height } | null           null: the screen's size (canvas size for the canvas)
  frameRate: FrameRate | null              null: 30 for H.264/HEVC, the show's timecode rate for ProRes
  bitrateMbps: number | null               H.264 and HEVC only
  alpha: boolean                           prores4444 only; needs a transparent layout background
  mapping: boolean                         default false
  timecode: 'timeOfDay' | 'show' | 'zero'
  markCues: boolean                        add a marker on every cue and slide change
}

Recording {
  id, target: RecordingTarget, presetId
  path
  state: 'starting' | 'recording' | 'stopping' | 'done' | 'failed'
  startedAt, startTimecode
  frames, dropped, bytes
  markers: { atFrame, timecode, label, source }[]
  error: string | null
}
```

`FrameRate` is the type from doc 13. Presets live in app settings, not in the show. The show stores a default preset per screen, used by **Record all**.

### Built-in presets

| Preset | Codec | Size, rate | Data rate | Use |
|---|---|---|---|---|
| Archive ProRes 422 | ProRes 422, `.mov` | screen size, show rate | about 147 Mb/s at 1080p29.97, 294 Mb/s at 1080p59.94 | Masters for editing |
| Archive ProRes 422 HQ | ProRes 422 HQ, `.mov` | screen size, show rate | about 220 / 440 Mb/s | Masters for heavy grading |
| Overlay ProRes 4444 | ProRes 4444 with alpha, `.mov` | screen size, show rate | about 330 / 660 Mb/s | Lyrics or graphics to key in an edit |
| Web H.264 | H.264 High, `.mp4` | 1920×1080, 30 | 12 Mb/s | Upload the same night |
| Social vertical | H.264 High, `.mp4` | 1080×1920, 30 | 10 Mb/s | Reels and Shorts, from a vertical screen |
| Archive HEVC 4K | HEVC Main 10, `.mp4` | 3840×2160, 30 | 40 Mb/s | Small 4K archive |

ProRes 422 HQ at 1080p59.94 writes about 200 GB per hour. The Recordings panel shows the hours left on the drive before the operator starts.

**Social vertical** needs a vertical screen. The Screens workspace's **Vertical (social)** preset adds a `virtual` screen at 1080×1920 with a 9:16 `layout.region` of the canvas and the `lowerThird` text preset. The recording follows that screen. A 9:16 slice of a 1920×1080 canvas is only 608 px wide, so the preset warns unless the canvas is at least 2160 px tall, or the layout uses its own layers (see Open questions).

## Pipeline

A recording runs like a virtual target from doc 13: its own thread, its own wgpu device and its own **frame clock** at the preset's `frameRate`.

```
frame clock tick ─▶ screen stage (layout, state; mapping if set) ─▶ convert pass ─▶ encoder queue ─▶ encoder ─▶ muxer ─▶ disk
                     shared VideoFrame / InputFrame, no copies       NV12 / x422 / BGRA   bounded     VT / MF / ffmpeg   fragmented
```

- **Clock:** the recording does not follow a monitor's refresh, so a 60 Hz projector and a 29.97 fps archive record correctly at the same time. Each tick renders the screen with the newest video and input frames.
- **Sharing a render:** when the recorded screen is a virtual target with the same size and rate, the recording attaches to that target's clock and reuses its rendered texture. Nothing renders twice.
- **Conversion:** one GPU pass from premultiplied linear `Rgba16Float` to the encoder's input, added to `convert.wgsl` (doc 13): NV12 BT.709 limited range for H.264 and HEVC (P010 for HEVC Main 10), 10-bit 4:2:2 (`x422`) for ProRes 422 and HQ, and BGRA with straight alpha for ProRes 4444.
- **Zero copy on macOS:** the convert pass renders into an IOSurface-backed texture taken from the `VTCompressionSession` pixel buffer pool. The `CVPixelBuffer` goes to `VTCompressionSessionEncodeFrame` without a readback.
- **Windows:** the convert pass renders into a D3D11 shared texture. A Media Foundation encoder MFT with a DXGI device manager takes it as an `IMFDXGIBuffer` sample, so hardware encoders (NVENC, Quick Sync, AMF) read it on the GPU.
- **Timestamps:** every frame gets the presentation time of its clock tick. A dropped tick leaves a gap, and the previous frame lasts two ticks in the file. The file stays in sync with wall time and timecode.

### Encoders

| Platform | ProRes | H.264, HEVC |
|---|---|---|
| macOS | VideoToolbox. Hardware on chips with a ProRes engine (M1 Pro, Max and Ultra and later), software encode in VideoToolbox elsewhere. | VideoToolbox hardware encode, `kVTCompressionPropertyKey_RealTime` on. |
| Windows | No OS encoder. ffmpeg fallback only (Open questions). | Media Foundation encoder MFT, hardware first. HEVC needs a hardware encoder; the preset is hidden without one. |
| Fallback | ffmpeg process | ffmpeg process |

The **ffmpeg fallback** uses the same lookup as decoding (doc 05). The convert pass reads frames back through the readback ring from doc 13 and pipes raw NV12 or BGRA to `ffmpeg` with a hardware encoder where one exists (`h264_videotoolbox`, `hevc_videotoolbox`, `h264_mf`), else `libx264` or `prores_ks`. It costs a readback and more CPU. Lumen uses it only when the native encoder is missing, and shows that in the Recordings panel.

### Containers and crash safety

- **macOS:** `AVAssetWriter` muxes the encoded samples in passthrough mode with `movieFragmentInterval` set to 2 s, for both `.mov` and `.mp4`. A file interrupted by a crash or power loss plays up to the last fragment.
- **Windows:** the Media Foundation sink writer with the fragmented MP4 container (`MFTranscodeContainerType_FMPEG4`). The ffmpeg fallback writes fragmented MP4 (`-movflags +frag_keyframe+empty_moov`) or fragmented QuickTime for ProRes.
- **Keyframes:** H.264 and HEVC use a keyframe every 2 s, so every fragment starts with one. ProRes frames are all intra frames.
- **State sidecar:** each recording writes `<file>.lumenrec.json` with its state, preset, start timecode, markers and dropped frames, updated every 2 s and on stop. On the next launch, sidecars still in `recording` state list as **interrupted** in the Recordings panel. The file is already playable; **Finalize** rewrites the index into a plain movie for tools that dislike fragmented files.

### Timecode

- `.mov` files get a QuickTime timecode track (`tmcd`) that starts at the first frame. `timeOfDay` uses the machine clock. `show` uses the show's timecode: the LTC or MTC the timeline follows (doc 08), else the timeline position. `zero` starts at 00:00:00:00.
- Drop-frame timecode is used at 29.97 and 59.94.
- MP4 has no standard timecode track. The start timecode goes into the file metadata and the sidecar.
- When `show` timecode jumps (a locate, a new LTC source), the track keeps counting from the start and the jump is added as a marker. Editors expect a continuous timecode track.

### Markers

`record.marker { label }` adds a marker to every active recording at the current frame. `markCues` adds one on each cue and slide change, labelled with the on-air item and slide.

- **In the file:** a chapter track in `.mov` and `.mp4` (QuickTime Player and many editors show chapters).
- **Sidecar:** the `.lumenrec.json` sidecar, plus `<file>.markers.edl` (CMX 3600 with marker comments) for editors that import markers from an EDL, such as DaVinci Resolve.
- Dropped frames are also listed in the sidecar, as frame ranges.

## Never stall the show

Rule 1 in practice:

- The render thread hands frames to an encoder queue of **8 frames**. When the queue is full, the frame is dropped: the tick leaves a gap, `dropped` counts it, and the sidecar records it. The render thread never waits.
- The muxer writes on its own thread with a buffer of at most 2 s of data. When the disk falls further behind, the encoder queue fills and frames drop the same way.
- Warnings in the Recordings panel and the shell status bar: any dropped frame in the last 10 s (amber), more than 1% dropped (red, "disk or encoder too slow").
- An encoder or writer error stops that recording only, marks it `failed`, keeps the file written so far, and tells the operator. Outputs and other recordings carry on.
- While any recording runs, Lumen holds the same power assertion it holds while live (doc 05), so the Mac does not sleep.

## Disk space

- **Where:** `~/Movies/Lumen Recordings/` on macOS and `Videos\Lumen Recordings\` on Windows by default, configurable per preset (an external SSD is the usual choice).
- **Names:** `<show> - <screen> - <YYYY-MM-DD HH-mm-ss>.<ext>`, made safe for every file system. A collision adds ` (2)`. The canvas uses `Canvas` as the screen name.
- **Before start:** `record.start` checks that the drive has room for 10 minutes at the preset's data rate plus the reserve, else it is rejected. Preflight (doc 16) runs the same check for every screen with a default preset and shows the hours left.
- **While recording:** the writer checks free space every 2 s (`statvfs`, `GetDiskFreeSpaceExW`). Below 15 minutes left at the current rate, all active recordings on that drive warn. At the reserve (5 GB or 2% of the volume, whichever is larger), Lumen stops them cleanly and finalizes the files.
- **Same drive as the media library:** recording ProRes to the drive that also feeds Hap playback (720 MB/s for 8 layers, doc 05) can starve playback. The Recordings panel warns when both use one volume.

## Commands

Added to `packages/schema/src/command.ts` (doc 12), group **Recording**:

| Command | Effect |
|---|---|
| `record.start { screenId \| 'canvas', preset }` | Start a recording of a screen or the canvas with a preset id. Rejected with `unknown-target` for an unknown screen or preset, `busy` for the same screen and preset already recording, `invalid` with a message for too little disk space or a preset that the platform can't encode. |
| `record.stop { recordingId? , screenId? }` | Stop one recording, or every recording of a screen. |
| `record.stopAll` | Stop every recording. |
| `record.marker { label }` | Add a marker to every active recording. |

- `StateEvent` gains `recordings: { id, target, preset, state, elapsedMs, bytes, dropped }[]`, published at most once a second.
- `system.panic` does not stop recordings: a panic is exactly what an archive should show.
- Companion gets record and stop actions per screen, a marker action, and a recording feedback (doc 12, § Companion).
- Over the local API (doc 14), `record.*` needs a `control` token.

## UI

- **Show, Screens panel:** each screen card has a record button with a preset menu. A recording screen gets a red border and the elapsed time. **Record all** starts every screen that has a default preset.
- **Recordings panel** (a drawer in Show, like the Control log): one row per active recording with screen, preset, elapsed time, file size, hours left on the drive, dropped frames, a marker button and stop. Below, the recent and interrupted recordings with **Reveal in Finder** (Explorer on Windows) and **Finalize**.
- **Settings > Recording:** presets, default folders, the reserve, and the fallback encoder status.
- **Screens workspace:** the Vertical (social) screen preset and the default recording preset per screen.

## Performance budget

On Apple Silicon (M1 Pro) with 1080p60 outputs, each recording must add at most:

| Recording | GPU per frame | CPU | Disk |
|---|---|---|---|
| H.264 or HEVC 1080p30, VideoToolbox, shared render | ≤ 0.3 ms (convert pass); encode runs on the media engine | ≤ 3% of a core | 1.5 MB/s |
| ProRes 422 HQ 1080p59.94, ProRes engine, shared render | ≤ 0.3 ms | ≤ 5% of a core | 55 MB/s |
| Any preset rendering its own screen stage | + the screen's render cost (2.4 ms for the A2 exit scene) | | |
| ffmpeg fallback 1080p30 | ≤ 1 ms (convert and readback) | 1–2 cores with `libx264` | as preset |

All recordings together must stay under 15% of the GPU frame time at 60 Hz (2.5 ms). The A2 budget (8 Hap layers, 16.7 ms) must still hold with two display outputs, two NDI outputs, one ProRes 422 HQ recording and one H.264 recording. A recording that cannot keep up drops its own frames (§ Never stall the show); it never takes frames from an output.

## Audio

There is no audio until the audio engine (Wave F). Files have a video track, a timecode track and a chapter track only. With Wave F, recordings mux the program audio mix (or a chosen bus) as a PCM track in `.mov` and AAC in `.mp4`, and can add LTC as an audio channel. NDI and capture audio arrive in the same wave.

## Files

| Area | Location |
|---|---|
| Preset, recording and target schemas | `packages/schema/src/recording.ts` |
| Recording commands and state | `packages/schema/src/command.ts`, `packages/core/src/commandBus.ts` |
| File naming, preset checks, disk estimates, marker and EDL output | `packages/core/src/recording.ts` |
| Recording sink, frame clock, encoder queue, disk monitor, sidecar | `apps/studio/src-tauri/crates/lumen-output/src/targets/record.rs` (reuses `clock.rs` and `readback.rs` from doc 13) |
| Encoders and muxers: VideoToolbox and `AVAssetWriter`, Media Foundation, ffmpeg | `apps/studio/src-tauri/crates/lumen-media/src/encode/{mod.rs,videotoolbox.rs,mediafoundation.rs,ffmpeg.rs}` |
| NV12, P010, `x422` and straight BGRA outputs of the convert pass | `apps/studio/src-tauri/crates/lumen-render/src/convert.wgsl` |
| Tauri wiring: `record_start`, `record_stop`, `record_finalize`, `record:status` events | `apps/studio/src-tauri/src/record.rs` |
| UI | `apps/studio/app/show/ScreensPanel.vue`, `apps/studio/app/show/RecordingsPanel.vue`, `apps/studio/app/settings/RecordingPanel.vue` |

## Tests

- **Core (Vitest):** preset validation (ProRes needs `.mov`, alpha needs ProRes 4444, HEVC hidden without an encoder), file naming and collisions, disk estimates and thresholds, marker and EDL output, and every `record.*` command including rejections.
- **Rust unit tests:** frame clock ticks and timestamps with gaps, the drop policy with a fake slow encoder (queue full drops, the render call never blocks), drop-frame timecode maths at 29.97 and 59.94, sidecar round trips, disk reserve and stop logic with a fake free-space source, and NV12/`x422` packing maths against reference values.
- **Ignored tests (need a GPU or the OS encoders):** 10 s of a synthetic composition through each native encoder and container, checked with `ffprobe` for codec, size, frame count, timecode and chapters; a child process killed mid-recording, after which the file plays up to its last fragment; a throttled writer, with the output loop's frame times unchanged.
- **Manual:** a 2-hour ProRes 422 HQ recording beside a full show on four outputs; filling a small USB drive until Lumen stops cleanly; importing a recording with markers into DaVinci Resolve and Final Cut Pro; a vertical social clip posted from a phone.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| 19.1 Recording sink | Schema, commands, sink with frame clock, encoder queue and drop policy, sidecar, ffmpeg fallback | `record.start` records a virtual screen to H.264 through ffmpeg while outputs keep their frame times |
| 19.2 VideoToolbox | Zero-copy convert pass into the encoder pool, `AVAssetWriter` with fragments, ProRes and H.264/HEVC presets | A ProRes 422 HQ and an H.264 recording of two screens run together within the budget |
| 19.3 Safety | Disk monitor and reserve, interrupted recordings, Finalize, same-drive warning, preflight check | A killed app leaves a playable file; a full drive stops the recording cleanly |
| 19.4 Timecode and markers | `tmcd` track, chapters, EDL, `markCues` | Markers from Companion land on the right frames in Resolve |
| 19.5 UI and presets | Record buttons, Recordings panel, Settings, Vertical (social) screen preset | An operator records the program and a vertical clip from the Show workspace |
| 19.6 Windows | Media Foundation encoder and sink writer | An H.264 recording on Windows plays after a forced kill |

19.1–19.5 cover macOS and fit the v1 local release if the roadmap takes them. 19.6 follows the Windows build.

## Open questions

- **ProRes on Windows.** Windows has no licensed ProRes encoder. ffmpeg's `prores_ks` is not an Apple-licensed encoder. Options: offer it marked as such, offer DNxHR instead, or offer no intermediate codec on Windows.
- **Vertical layouts.** A vertical screen cut from a landscape canvas is soft. A per-screen layer set with its own canvas size would be sharper. This is the same question as portrait streams in doc 13.
- **ISO recordings.** Recording each live input (doc 18) as its own file, in sync with the program, needs a shared start time and timecode across recordings. Design it after 18.2.
- **Constant frame rate.** Dropped frames become longer frames in the file. Some editors prefer a duplicated frame instead. Decide after testing imports in Resolve, Premiere and Final Cut.
- **Recording on render nodes.** With several machines (E3), each node could record its own screens. Out of scope here.
