# 18 — Live inputs

A live input is a source whose pixels arrive in real time from outside Lumen: a camera, a capture card, an NDI stream, a Syphon or Spout sender, or a captured display or window. Inputs are ordinary sources in the composition. A layer shows them with the same transform, effects, masks and blend as a video, and every screen picks them up through its layout.

- Sources and layers: `02-render-contract.md` (the reserved `ndi` and `camera` kinds). Screens and layouts: `10-screens-and-mapping.md`. Decode paths, frame fan-out and hotplug of monitors: `05-desktop-output.md`. NDI runtime loading, Syphon, Spout and DeckLink licensing: `13-virtual-outputs.md`. Commands: `12-command-bus.md`.
- Roadmap: Wave E3 lists "NDI in as a source". This doc covers every input kind and splits the work into steps (§ Delivery). Audio from inputs waits for the audio engine (Wave F).

## Rules

1. **An input is a source.** Nothing else in the render contract changes. Layouts, mapping, effects and transitions treat an input like any other source.
2. **Inputs never clock the output.** Each output takes the newest input frame at render time. A slow, stopped or unplugged input never delays a frame.
3. **Capture only on demand.** A device is opened only while an enabled layer that an output, the preview or a preload shows uses it. Nothing is captured in the background.
4. **Never switch devices silently.** A missing device shows as missing. Lumen never picks another camera or sender in its place.
5. **Zero copy where the OS allows it.** Camera, capture, Syphon and Spout frames stay on the GPU. Only NDI and DeckLink frames arrive in CPU memory and are uploaded once.
6. **Ask for permission when the operator adds an input, never at launch.** Preflight (doc 16) reports any missing permission before a show goes live.
7. **Frames stay in memory.** Lumen writes input pixels to disk only through an explicit recording (doc 19).

## Kinds

| Kind | macOS | Windows | Covers | Frames arrive as |
|---|---|---|---|---|
| `camera` | AVFoundation (`AVCaptureSession`, `AVCaptureVideoDataOutput`) | Media Foundation (`IMFSourceReader` with a D3D11 device manager) | Built-in and USB webcams, UVC HDMI/SDI capture dongles, Continuity Camera | GPU: IOSurface-backed `CVPixelBuffer` / D3D11 texture |
| `camera` with `backend: 'decklink'` | Desktop Video SDK (`IDeckLinkInput`) | Desktop Video SDK | Blackmagic DeckLink and UltraStudio inputs | CPU: `2vuy` or `v210` |
| `ndi` | NDI SDK receive | NDI SDK receive | Cameras, switchers, OBS, another Lumen on the LAN | CPU: UYVY or UYVA |
| `syphon` | `SyphonMetalClient` | n/a | Resolume, MadMapper, TouchDesigner, OBS on the same Mac | GPU: IOSurface-backed `MTLTexture` |
| `spout` | n/a | Spout 2 receiver | Resolume, TouchDesigner, OBS on the same PC | GPU: D3D11 shared texture |
| `capture` | ScreenCaptureKit (`SCStream`) | Windows Graphics Capture (`Direct3D11CaptureFramePool`) | A display or one window: a browser, Keynote, PowerPoint, a remote guest call | GPU: IOSurface / D3D11 texture |

Capture dongles that present as UVC devices (most USB HDMI capture sticks) are plain `camera` inputs. Only Blackmagic cards need the DeckLink backend.

## Source schema

`packages/schema/src/composition.ts` replaces the reserved `ndi` and `camera` sources with full ones and adds three kinds. Every input source shares one set of fields:

```
InputBase = {
  id, name
  crop: { top, right, bottom, left }        normalized; removes overscan and capture-card borders
  color: { matrix: 'auto' | 'bt709' | 'bt601', range: 'auto' | 'limited' | 'full' }
  alpha: 'ignore' | 'straight' | 'premultiplied'      only for ndi, syphon, spout
  noSignal: { mode: 'hold' | 'black' | 'slate', slate: AssetRef | null }
  frameBlend: boolean                        default false; § Frame rates
}

Source |=
  | InputBase & { kind: 'camera',  deviceId, model, backend: 'system' | 'decklink', format: InputFormat | null }
  | InputBase & { kind: 'ndi',     name, bandwidth: 'highest' | 'lowest' }
  | InputBase & { kind: 'syphon',  server: { app, name } }
  | InputBase & { kind: 'spout',   sender }
  | InputBase & { kind: 'capture', target: { kind: 'display', displayId: ScreenRef }
                                         | { kind: 'window', app, title },
                  cursor: boolean, excludeLumen: boolean }

InputFormat { width, height, frameRate, pixelFormat: 'auto' | 'nv12' | 'uyvy' }
```

- `format: null` lets Lumen pick: the largest size up to the canvas height, then the highest frame rate up to 60, then NV12. DeckLink ignores `format` and uses format detection.
- `bandwidth: 'lowest'` asks NDI for the sender's preview proxy stream. Use it for thumbnails and multiview layers.
- `server` matches Syphon servers by app name and server name, because Syphon UUIDs change every launch.
- `displayId` is the stable `ScreenRef` from doc 05 (name plus position), not the OS display number.
- `excludeLumen` (default `true`) removes Lumen's own windows from a display capture on macOS, so a captured display that also shows an output does not feed back. Windows Graphics Capture cannot exclude windows; the inspector warns instead.
- Existing documents with `ndi { name }` or `camera { deviceId }` load with the defaults above. The schema version does not change, since no stored show uses these kinds yet.

The Rust mirror in `lumen-render/src/composition.rs` gains the same fields. The compositor stops skipping these kinds.

## Devices and hotplug

Inputs are found and tracked the way doc 05 tracks monitors.

```
InputDevice {
  kind: 'camera' | 'decklink' | 'ndi' | 'syphon' | 'spout' | 'display' | 'window'
  id                       OS unique id, NDI full name, Syphon app + name, Spout sender, window id
  name, model
  formats: InputFormat[]   cameras and DeckLink only
}
InputStatus = 'live' | 'noSignal' | 'missing' | 'denied' | 'error'
```

- **Discovery:** `AVCaptureDevice.DiscoverySession` (macOS) and `MFEnumDeviceSources` (Windows) for cameras; DeckLink device iterator; `NDIlib_find` for NDI; `SyphonServerDirectory` for Syphon; the Spout sender list; `SCShareableContent` and `EnumWindows` for displays and windows.
- **Hotplug:** cameras use the OS notifications (`AVCaptureDeviceWasConnected` and `WasDisconnected`; `CM_Register_Notification` on `KSCATEGORY_VIDEO_CAMERA`). Every other kind is polled once a second, like monitors. The studio receives `input:devices` on each change.
- **Resolution:** match `deviceId` exactly. If that fails, match `name` plus `model` when exactly one device fits (some UVC devices change id when moved to another USB port). Otherwise the source is `missing` and follows its `noSignal` mode (rule 4). A device that returns resolves again within a second.
- **Windows:** a window id does not survive an app restart, so a window capture stores `app` (bundle id or executable) and `title`. It resolves to the window of that app with that title, else the app's frontmost window if there is only one, else `missing`.

## Pipeline

```
device ─▶ capture thread ─▶ InputFrame (ref-counted) ─▶ latest-frame mailbox per input
                                                               │
              each output, preview and recording, at render time: take newest
                                                               ▼
                        import to own wgpu device ─▶ YUV → linear RGB pass ─▶ compositor source texture
```

- **Threads:** each open input has its own capture thread in `lumen-media`. NDI uses `NDIlib_framesync`, which already returns the newest frame on demand and handles time-base differences.
- **Fan-out:** an `InputFrame` is reference counted like `VideoFrame` (doc 05) and reaches every output, the preview and recordings without copying pixels. It holds the `CVPixelBuffer`, IOSurface or D3D11 texture until every consumer has released it.
- **Import:** each output owns its own wgpu device (doc 05). On macOS an IOSurface can back a Metal texture on every device, so each output wraps the same surface (`newTextureWithDescriptor:iosurface:plane:`, then `wgpu-hal` `texture_from_raw` and `create_texture_from_hal`). On Windows the capture texture is copied once on the GPU into a texture with a shared NT handle, and each output opens that handle on its DX12 device through `wgpu-hal`. When import fails (for example, two GPUs), the frame is read back once and uploaded per output.
- **Back-pressure:** each input keeps at most 3 frames alive. On macOS `alwaysDiscardsLateVideoFrames` is on; on every platform a full input drops its oldest frame. A slow consumer makes frames drop, never the render loop wait.
- **Late latch:** the output loop takes input frames as late as possible, after draining commands and just before it records the frame's GPU work. This is what keeps latency inside the budget.

### Formats and colour

- **Pixel formats:** NV12 (`420v` video range, `420f` full range) imports as two planes, `R8Unorm` and `Rg8Unorm`. UYVY (`2vuy`) imports as `Rgba8Unorm` at half width. `v210` (10-bit DeckLink) unpacks in the shader from an `R32Uint` view. BGRA (Syphon, Spout, capture) imports directly.
- **Conversion:** one WGSL pass (`input.wgsl`) applies the crop, converts YCbCr to RGB, expands limited range (16–235 luma, 16–240 chroma) to full, linearizes sRGB / BT.709 transfer to linear light, and premultiplies alpha. The result is the compositor's working format: premultiplied linear `Rgba16Float` (doc 02, § Implementation).
- **Matrix and range:** `auto` reads the frame's tags (`kCVImageBufferYCbCrMatrixKey`, the Media Foundation `MF_MT_YUV_MATRIX` and `MF_MT_VIDEO_NOMINAL_RANGE`, NDI and DeckLink frame flags). Untagged frames use BT.709 at 720 lines and above, BT.601 below, and limited range for YUV. The source inspector can force either value for devices that tag wrongly.
- **Alpha:** NDI (UYVA), Syphon and Spout can carry alpha. `alpha: 'ignore'` (the default for NDI) draws the input opaque; `straight` premultiplies on import; `premultiplied` takes the values as they are.
- **HDR and Rec. 2020** inputs are out of scope. They convert as BT.709 with a warning.

### Frame rates

There is no clock master (rule 2). Each output renders at its own rate and shows the newest input frame it has.

- A 30 fps camera on a 60 Hz output shows each frame twice. A 59.94 input on a 60 Hz output repeats one frame about every 17 seconds. A 25 fps input on 60 Hz shows a 2-3 cadence.
- `frameBlend: true` mixes the two newest frames by their timestamps. It smooths cadence for slow content such as a slideshow from a capture card, and it adds one input frame of latency. It is off by default and the inspector warns against it for camera close-ups (IMAG).
- Genlock and frame-locking outputs to an input are out of scope.

### No signal

An input with no frame for 250 ms, or with status `missing`, `denied` or `error`, follows `noSignal.mode`:

| Mode | Shows | Use |
|---|---|---|
| `hold` (default) | The last frame. Black if there was none. | IMAG and cameras: a short dropout is invisible. |
| `black` | Transparent, so the layers below show. | Overlays and picture-in-picture. |
| `slate` | `noSignal.slate`, an image asset chosen by the operator. | A logo or holding card on a stream. |

The operator always sees the state: the source shows a red "No signal" badge in Compose and Show, and preflight lists it. Lumen never draws a "No signal" text card on an audience output by itself. HDCP-protected HDMI and DRM-protected windows deliver black frames; the inspector says so when a capture card reports HDCP.

## Permissions and privacy

| Platform | Input | What is needed |
|---|---|---|
| macOS | Cameras, capture dongles, Continuity Camera | `NSCameraUsageDescription` in `Info.plist`; the hardened runtime entitlement `com.apple.security.device.camera`; the system prompt from `AVCaptureDevice.requestAccess` the first time a camera source is added. |
| macOS | Display and window capture | Screen Recording permission (`CGPreflightScreenCaptureAccess`, `CGRequestScreenCaptureAccess`). There is no usage string. macOS can require a relaunch after the grant, and recent versions ask the user to confirm again from time to time. |
| macOS | DeckLink, NDI, Syphon | No OS permission. NDI needs the Local Network permission (`NSLocalNetworkUsageDescription`, already needed by doc 14). |
| Windows | Cameras | Settings > Privacy > Camera > "Let desktop apps access your camera". Lumen detects a blocked camera and links to the setting. |
| Windows | Display and window capture | No prompt. Windows draws a yellow border around captured content; Windows 11 allows a borderless request (`GraphicsCaptureAccess.RequestAccessAsync`). |
| both | Microphone | Not requested. Audio waits for Wave F. |

- A denied permission sets the status to `denied`. The inspector shows a fix-it button that opens the right System Settings or Windows Settings page.
- **Indicator:** macOS shows its own camera and screen recording indicators. Lumen adds a **Capturing** indicator in the shell status bar while any input is open. It lists each open input and who uses it (output, preview, preload), and has a **Stop all inputs** action that closes every device. Their layers then follow their no-signal mode.
- Inputs used only by the preview close when the preview stops showing them, after a 5 s grace period. The grace period stops cameras from reopening on quick cue changes, since opening a camera takes 0.5–1 s.

## Studio

- **Compose:** the source list's Add menu gains **Live input** with Cameras and capture, NDI, Syphon (macOS), Spout (Windows) and Screen or window. Each lists the discovered devices with a live thumbnail. The source inspector shows the device picker, format, crop, colour override, alpha, no-signal mode, frame blending, and live stats: status, input fps, dropped frames, and added latency.
- **Show:** a clip grid cell can hold an input source, like a video. Launching it sets the layer's source, with the layer's transition. The cell shows a live thumbnail (at most 4 fps through `preview_render_composition`) and a status dot.
- **Preload:** the next cue's inputs open under the `preload` demand (doc 05), so a camera is already running when the cue goes on air.
- **State:** `StateEvent` (doc 12) gains `inputs: { sourceId, status, fps }[]` for remotes and Companion feedback. No new commands are needed in the first steps: inputs switch through `clip.launch` and layer commands. `input.reopen { sourceId }` restarts a device that is in `error`.

### Picture-in-picture

Picture-in-picture needs nothing new. An input on a layer above the program uses the layer `transform` for position and size, a `rect` mask with `radius` and `feather` for rounded corners, and the `crop` field to trim the frame. Compose adds a **Picture in picture** layer preset: a layer at x 0.66, y 0.62, w 0.3, h 0.3 with a rounded rect mask and a fade transition.

### IMAG

Image magnification shows a camera close-up on side screens with lyrics over it:

1. Add a `camera` source (a UVC HDMI dongle from the camera operator's feed, or NDI from a switcher) on a layer tagged `imag`.
2. The side screens' layout uses `layers: { mode: 'only', tags: ['imag', 'lyrics'] }` with `text.preset: 'lowerThird'`. The centre screen keeps the full program with full-screen lyrics.
3. The lyrics layer sits above the camera layer, so lyrics read as a lower third over the close-up.

The Screens workspace adds an **IMAG side screen** layout preset with these settings. IMAG is where latency shows most, because the audience sees the person and the screen together. Hence the 2-frame target below.

## Latency

Lumen's added latency is measured from frame arrival (the capture callback's host time) to present on the output. Camera sensor, scaler and display latency come on top and are outside Lumen's control.

| Input | Target at 60 Hz |
|---|---|
| `camera`, `capture` dongle, Syphon, Spout | ≤ 2 output frames (33 ms) |
| DeckLink | ≤ 2 output frames |
| NDI | ≤ 2 output frames after receive; network and NDI decode add about 1 frame |
| Display and window capture | ≤ 3 output frames (ScreenCaptureKit and Graphics Capture add their own frame) |

Settings > Inputs has a **Measure latency** tool for a show setup: an output flashes white, a camera pointed at it sees the flash, and Lumen reports the round trip from flash to detection. That number includes the camera and the display.

## Performance budget

On Apple Silicon (M1 Pro) with 1080p60 output, each input must add at most:

| Input | GPU per frame | CPU | Memory |
|---|---|---|---|
| Camera or UVC capture, 1080p60 NV12, zero copy | ≤ 0.3 ms (conversion pass) | ≤ 3% of a core | 3 frames |
| DeckLink 1080p60 `v210` | ≤ 0.5 ms (upload and unpack) | ≤ 5% of a core | 3 frames |
| NDI 1080p60 | ≤ 0.5 ms (upload and conversion) | ≤ 20% of a core (NDI decode) | 3 frames |
| Syphon / Spout | ≤ 0.2 ms | ~0 | shared texture |
| Display capture 4K at 30 fps | ≤ 0.5 ms | ≤ 5% of a core | 3 frames |

The A2 exit scene (doc 07) must still render at 60 fps on two display outputs with four inputs added: two cameras, one NDI and one display capture.

## Licensing

- **NDI:** receiving uses the same standard NDI SDK and runtime loading as sending (doc 13): the runtime is installed by the user, not bundled, and the NDI attribution rules apply. The runtime loader moves to `lumen-media` so receive and send share it.
- **DeckLink:** the Blackmagic Desktop Video SDK licence allows distribution. Users install Desktop Video drivers. Lumen loads the DeckLink API at runtime and hides the backend when it is absent.
- **Syphon, Spout:** BSD-style licences, as in doc 13.
- **AVFoundation, ScreenCaptureKit, Media Foundation, Windows Graphics Capture:** system frameworks, no third-party licence.

## Files

| Area | Location |
|---|---|
| Input source schemas, `InputFormat` | `packages/schema/src/composition.ts` |
| `InputDevice`, `InputStatus`, device events | `packages/schema/src/input.ts` |
| Device resolution rules, format choice, IMAG and PiP presets | `packages/core/src/input.ts` |
| Capture threads, device discovery and hotplug, mailbox, NDI runtime loader | `apps/studio/src-tauri/crates/lumen-media/src/input/{mod.rs,camera_avf.rs,camera_mf.rs,decklink.rs,ndi.rs,syphon.rs,spout.rs,capture_sck.rs,capture_wgc.rs}` |
| `InputFrame`, GPU import, YUV conversion | `apps/studio/src-tauri/crates/lumen-render/src/input.rs`, `input.wgsl` |
| Late latch in the output loop, input fan-out to outputs | `apps/studio/src-tauri/crates/lumen-output/src/lib.rs` |
| Demand per caller, `list_inputs`, permissions, `input:devices` and `input:status` events | `apps/studio/src-tauri/src/inputs.rs` (next to `VideoPlaybackManager` in `media.rs`) |
| Usage strings and entitlements | `apps/studio/src-tauri/Info.plist`, `apps/studio/src-tauri/Entitlements.plist` |
| Compose and Show UI, Capturing indicator, latency tool | `apps/studio/app/compose/` (`SourceList.vue`, `SourceInspector.vue`), `apps/studio/app/show/ClipGrid.vue`, `apps/studio/app/shell/`, `apps/studio/app/settings/InputsPanel.vue` |

## Tests

- **Rust unit tests:** device resolution (exact id, name plus model, ambiguous, missing), format choice, YCbCr matrix and range maths against reference values (BT.709 and BT.601, limited and full), `v210` unpacking, crop maths, the mailbox (newest wins, at most 3 frames alive), no-signal timing, frame-blend weights, and NDI and DeckLink availability with fake loaders.
- **Ignored GPU tests:** the conversion pass on known NV12, UYVY and `v210` frames; IOSurface import on two devices from one surface; one synthetic input on two offscreen outputs, compared with the preview.
- **TypeScript:** schema defaults for old `ndi` and `camera` sources, presets, and the layout used by the IMAG preset.
- **Synthetic input:** a `test` backend (dev builds only) produces a moving pattern with timestamps at any size and rate. CI uses it with fake devices; there are no camera or device tests in CI.
- **Manual:** a UVC HDMI dongle and a webcam on macOS, Continuity Camera, NDI from OBS and from NDI Test Patterns, Syphon from Resolume, a Keynote window capture, Spout and a webcam on Windows, a DeckLink card, unplugging each one live, and the latency tool against the 2-frame target.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| 18.1 Input framework | Schema kinds, `InputManager` with demand, mailbox, conversion pass, status, no signal, synthetic input | A synthetic 1080p59.94 input renders on two outputs with stats; stopping it holds the last frame |
| 18.2 Cameras on macOS | AVFoundation, UVC dongles, hotplug, permission, zero-copy import, IMAG preset | A UVC HDMI dongle drives IMAG side screens with a lyrics lower third at ≤ 2 frames added latency |
| 18.3 NDI receive | Discovery, framesync, bandwidth, alpha | OBS's NDI output appears in Lumen; unplugging the network holds the last frame and recovers on reconnect |
| 18.4 Syphon and screen capture on macOS | Syphon client, ScreenCaptureKit display and window capture, Capturing indicator | Resolume over Syphon and a Keynote window composite with lyrics on two outputs |
| 18.5 Windows | Media Foundation cameras, Spout receiver, Windows Graphics Capture | A webcam, a Spout sender and a window capture show on a Windows output |
| 18.6 DeckLink input | Desktop Video SDK input, format detection | An SDI camera into a DeckLink card shows in Lumen and follows a format change |

18.1–18.4 cover macOS and fit the v1 local release if the roadmap takes them. 18.6 needs hardware and follows the DeckLink output step (B4.6).

## Open questions

- **v1 scope.** Cameras, NDI and Syphon on macOS (18.1–18.4) are the likely v1 set. The roadmap decides.
- **Screen capture prompts.** Recent macOS asks again from time to time for persistent screen recording. The system picker (`SCContentSharingPicker`) avoids the persistent grant, but it needs the operator each time. Decide which to use before 18.4.
- **Latency compensation.** IMAG audio comes from the PA, earlier than the picture. Delaying audio belongs to Wave F; Lumen cannot make the picture earlier.
- **NDI across subnets.** NDI discovery uses mDNS. An NDI Discovery Server setting would reach other subnets. Add it when a venue needs it.
- **Inputs on render nodes.** With several machines (E3), an input plugged into one machine may need to reach another, probably over NDI. Out of scope here.
