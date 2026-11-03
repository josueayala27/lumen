# 13 — Virtual outputs

A virtual output is a screen that sends its picture to other software instead of to a monitor: OBS, vMix, Resolume, a video switcher, Zoom or Teams. ProPresenter does this with NDI and Syphon outputs. Lumen does it the same way: a screen's target can be a network stream, a shared GPU texture, a virtual camera or an SDI card, and each target renders through the same pipeline as a physical display.

- Screen model: `10-screens-and-mapping.md`. Render pipeline: `02-render-contract.md`. Window outputs: `05-desktop-output.md`.
- Roadmap: new milestone **B4 Virtual outputs** (§ Delivery). It takes the NDI outputs from B1 and Syphon/Spout, alpha key and SDI from Wave G.

## Targets

| Target | Platform | Reaches | Transport | Alpha |
|---|---|---|---|---|
| `ndi` | macOS, Windows | OBS (DistroAV plugin), vMix, Wirecast, TriCaster, NDI Monitor, other machines on the LAN | Network, NDI SDK | Yes (UYVA / BGRA) |
| `syphon` | macOS | OBS (Syphon Client source), Resolume, MadMapper, Millumin, VDMX, TouchDesigner on the same Mac | GPU texture sharing (IOSurface), zero copy | Yes |
| `spout` | Windows | OBS (Spout2 plugin), Resolume, TouchDesigner, vMix on the same PC | GPU texture sharing (D3D11 shared handle), zero copy | Yes |
| `virtualCamera` | macOS, Windows | Any app with a camera picker: OBS, Zoom, Teams, Meet, browsers | Camera extension (CoreMediaIO on macOS, Media Foundation virtual camera on Windows 11) | No (cameras are opaque) |
| `decklink` | macOS, Windows | SDI and HDMI hardware: switchers, recorders, LED processors | Blackmagic DeckLink SDK | Fill + key on cards that support it |
| `virtual` | all | Lumen only | None: a preview screen for planning and tests (exists today) | n/a |

A show can mix targets freely. For example: two projectors as displays, an LED wall over DeckLink, a lyrics-only NDI feed with alpha for the stream, and a virtual camera for a Zoom guest.

## Screen model changes

`ScreenTarget` in `packages/schema/src/screen.ts` gains the new kinds, each with its settings:

```
ScreenTarget =
  | { kind: 'display', ref: ScreenRef }
  | { kind: 'virtual' }
  | { kind: 'ndi',           name, groups: string[], alpha: boolean, frameRate: FrameRate }
  | { kind: 'syphon',        name, alpha: boolean, frameRate: FrameRate }
  | { kind: 'spout',         name, alpha: boolean, frameRate: FrameRate }
  | { kind: 'virtualCamera', frameRate: FrameRate }
  | { kind: 'decklink',      device: string, mode: string, keying: 'off' | 'external' | 'internal' }

FrameRate = 23.976 | 24 | 25 | 29.97 | 30 | 50 | 59.94 | 60
```

- `name` is the source name other apps see. The default is the screen name. NDI shows it as `LUMEN-<HOST> (<name>)`, Syphon as `Lumen – <name>`, Spout as `Lumen <name>`. Names must be unique per target kind; the Screens inspector rejects duplicates.
- `size` is set by the operator for every virtual target (display targets follow their monitor). Presets: 1920×1080, 1280×720, 3840×2160, 1080×1920 vertical.
- `alpha: true` sends transparency. It only makes sense with a transparent layout background, so the inspector sets `layout.background` to transparent and warns if a layer covers the whole canvas.
- Everything else (layout, layer filter, text preset, mapping, blackout, test pattern, live modes) works exactly as for displays.

## Pipeline

Virtual targets reuse the compositor's per-screen stage (doc 10, § Pipeline per screen). Only the last step changes: instead of presenting to a window surface, the frame goes to the target.

```
compositor ─▶ screen stage (layout, mapping, modes) ─▶ target
                                                      ├─ display  : present to surface (today)
                                                      ├─ syphon   : publish IOSurface texture
                                                      ├─ spout    : publish shared D3D11 texture
                                                      ├─ ndi      : GPU convert → async readback → NDI send
                                                      ├─ vcam     : IOSurface / shared texture → camera extension
                                                      └─ decklink : GPU convert → readback → scheduled playback
```

### Clock

A display output follows its monitor's refresh. A virtual target has no monitor, so each one runs its own **frame clock** thread at `frameRate`, on a monotonic clock with drift correction (doc 05's `VideoTransport` clock). The clock asks the compositor for a frame at each tick. If a frame is late it sends the previous one again rather than skipping a tick, because receivers such as OBS and NDI expect a steady rate. DeckLink is clocked by the card's scheduled playback instead.

### Formats

- **Colour:** the compositor works in linear `Rgba16Float`. Each target converts in one GPU pass: BGRA8 sRGB for Syphon, Spout and the virtual camera; UYVY (or UYVA with alpha) in Rec. 709 for NDI and DeckLink. Doing the conversion on the GPU halves the bytes read back and keeps the CPU free.
- **Alpha:** premultiplied inside Lumen. NDI and Syphon receivers expect straight alpha, so the conversion pass un-premultiplies.
- **Readback:** NDI and DeckLink read frames back through a ring of three staging buffers mapped asynchronously, so the render thread never waits on the GPU. Syphon, Spout and the virtual camera share GPU textures and skip readback entirely.

### Threads

Each virtual target gets its own thread and its own wgpu device, like display outputs (doc 05, § Render thread). NDI sending runs on a separate sender thread with `NDIlib_send_send_video_async_v2`, so a slow network never blocks rendering. Decoded video frames are shared across all targets, as they are across displays.

## Target details

### NDI

- **SDK:** NDI SDK (the standard SDK is enough for sending). It is loaded at runtime from the installed NDI Runtime (`libndi.dylib` / `Processing.NDI.Lib.x64.dll`), so Lumen starts without it and offers a link to install it. See § Licensing.
- **Sending:** one NDI sender per screen. `groups` limits who can see it. Lumen shows the receiver count (`NDIlib_send_get_no_connections`) on the screen card and pauses rendering when nobody is connected, at 1 fps for the thumbnail only.
- **Tally:** NDI reports program and preview tally from switchers. Lumen shows it on the screen card (red for program, green for preview), and the command bus can react to it later (doc 12).
- **Audio:** none in B4. Audio over NDI comes with the audio engine (Wave F).
- **Receiving** NDI as a source (camera feeds, another Lumen) is the `ndi` source kind in doc 02. It is not part of B4.

### Syphon (macOS)

- Syphon's Metal server (`SyphonMetalServer`) publishes an IOSurface-backed texture. wgpu renders into an IOSurface-backed Metal texture through `wgpu-hal` interop, so frames cost no copies.
- Syphon is BSD-licensed and is linked as a framework.
- The Syphon server lives as long as the screen is enabled. Disabling or deleting the screen removes the source from receivers.

### Spout (Windows)

- Spout 2 shares a D3D11 texture by handle. wgpu renders into a D3D11-shareable texture through `wgpu-hal` DX12/D3D11 interop. Spout is BSD-licensed.

### Virtual camera

- **macOS:** a CoreMediaIO **camera extension** (system extension) bundled in `Lumen.app/Contents/Library/SystemExtensions`. The app sends frames to the extension's sink stream as IOSurfaces. The extension appears as the camera "Lumen". It needs the System Extension entitlement, a signed and notarized app, and one approval by the user in System Settings. It does not work from an unsigned dev build.
- **Windows 11:** a Media Foundation virtual camera (`MFCreateVirtualCamera`) with a frame source that receives shared textures. Windows 10 is not supported.
- One virtual camera per machine. Assigning it to a second screen moves it.
- Cameras don't carry alpha, so `alpha` is not offered.

### DeckLink

- Blackmagic Desktop Video SDK. `mode` is a DeckLink display mode (for example `1080p59.94`). `keying: 'external'` sends fill and key on two connectors; `'internal'` keys over the card's input.
- Ships after NDI, Syphon and the virtual camera (§ Delivery).

## UI

- **Screens workspace:** the target picker lists Displays, then NDI, Syphon (macOS), Spout (Windows), Virtual camera, DeckLink (when a card is present) and Virtual (preview only). The inspector shows each target's settings: name, size preset, frame rate, alpha, NDI groups, DeckLink mode and keying.
- **Status:** each screen card shows the target state: sending, waiting for receivers (NDI), connected receivers, tally, dropped frames, or an error such as "NDI Runtime not installed" with a fix-it link.
- **Show workspace:** virtual screens appear with displays in the Screens panel, with the same On, Blackout and preset controls. **Open outputs** starts every enabled target.
- **Presets** in the Add screen menu:
  - *Stream lyrics (NDI, alpha):* lower-third lyrics with a transparent background, for OBS overlays.
  - *Stream program (NDI):* the full program.
  - *Video call (virtual camera):* full program, 1280×720, 30 fps.
  - *Local mixing (Syphon/Spout):* full program at canvas size.

## Using it with OBS

| Goal | In Lumen | In OBS |
|---|---|---|
| Lyrics over the camera | Screen preset *Stream lyrics (NDI, alpha)* | Add source **NDI Source** (DistroAV plugin), pick `LUMEN-<HOST> (Stream lyrics)`. Place it above the camera. |
| Full program to the stream | Screen preset *Stream program (NDI)*, or Syphon/Spout on the same machine | **NDI Source**, or **Syphon Client** (macOS) / **Spout2 Capture** (Windows). |
| Same machine, lowest latency | Syphon (macOS) or Spout (Windows) | **Syphon Client** / **Spout2 Capture**. Zero copy, no network. |
| Without plugins | Virtual camera | **Video Capture Device** → "Lumen". |

The same recipes work for vMix, Wirecast and Resolume, which support NDI and Syphon/Spout natively.

## Licensing

- **NDI:** the NDI SDK licence allows free use and requires an NDI attribution, using the NDI trademark guidelines (the name, a link to ndi.video, and the logo in the About box and docs). Lumen does not bundle the runtime. It asks the user to install the free NDI Runtime, which keeps the redistribution terms simple. Review the current SDK licence before release.
- **Syphon, Spout:** BSD-style licences. Keep the notices in the app's licence list.
- **DeckLink:** the Blackmagic SDK licence allows distribution of apps built on it. Users install Desktop Video drivers.
- **Virtual camera:** no third-party licence. It needs Apple's System Extension entitlement and notarization, and Windows code signing.

## Performance budget

On Apple Silicon (M1 Pro) with 1080p60 output, each target must add at most:

| Target | GPU per frame | CPU | Latency added |
|---|---|---|---|
| Syphon / Spout | ≤ 0.3 ms (conversion pass) | ~0 | ≤ 1 frame |
| Virtual camera | ≤ 0.3 ms | ≤ 2% of a core | ≤ 2 frames |
| NDI 1080p60 | ≤ 1 ms (UYVY conversion and readback) | ≤ 15% of a core (NDI encode) | ≤ 2 frames + network |
| DeckLink | ≤ 1 ms | ≤ 5% of a core | card-defined, ≤ 3 frames |

The A2 budget (8 Hap layers, 16.7 ms) must still hold with two display outputs plus two NDI outputs running.

## Files

| Area | Location |
|---|---|
| Target schemas | `packages/schema/src/screen.ts` |
| Frame clock, target trait, readback ring, colour conversion | `apps/studio/src-tauri/crates/lumen-output/src/targets/{mod.rs,clock.rs,readback.rs}` and a conversion shader in `lumen-render` (`convert.wgsl`) |
| NDI, Syphon, Spout, DeckLink | `lumen-output/src/targets/{ndi.rs,syphon.rs,spout.rs,decklink.rs}` |
| Virtual camera | `lumen-output/src/targets/vcam.rs` plus the macOS extension target `apps/studio/src-tauri/extensions/camera/` (Swift) and the Windows frame source |
| Tauri wiring | `apps/studio/src-tauri/src/lib.rs` (`apply_composition` already takes screens; targets open and close with them) |
| UI | `apps/studio/app/screens/` (target picker, inspector, presets, status) |

`lumen-output` stays the owner of everything that leaves the app, as CLAUDE.md requires for monitor and window code.

## Tests

- **Rust unit tests:** frame clock timing and drift, readback ring order, the UYVY/UYVA packing maths against reference values, target name rules, and NDI and Syphon availability detection with fake loaders.
- **Ignored GPU tests:** the conversion pass against known pixels (BGRA and UYVY, with and without alpha); one frame through each target into an in-process receiver: the NDI SDK's receiver, a Syphon client, a Spout receiver.
- **TypeScript:** schema validation for every target, unique names, presets, and alpha forcing a transparent background.
- **Manual:** OBS on the same Mac with Syphon and NDI; OBS on a second machine over NDI; Zoom with the virtual camera; a DeckLink card into a monitor. The virtual display tool (`tools/virtual-display`) stays the way to test display targets on one screen.

## Delivery

| Step | Scope | Exit |
|---|---|---|
| B4.1 Target framework | Target trait, frame clock, conversion pass, readback ring, schema kinds, Screens picker | A screen renders headless at a fixed rate with stats |
| B4.2 Syphon | macOS Syphon server, zero copy | OBS's Syphon Client shows Lumen's program with alpha |
| B4.3 NDI | Runtime loading, sender, receiver count, tally, alpha | OBS on a second machine shows lyrics with alpha over a camera at 1080p60 |
| B4.4 Spout | Windows Spout 2 | OBS on Windows shows the program through Spout2 Capture |
| B4.5 Virtual camera | macOS camera extension, Windows 11 virtual camera | Zoom picks "Lumen" as a camera and shows the program |
| B4.6 DeckLink | Playback, fill and key | A DeckLink card sends fill and key to a switcher |

B4.1–B4.3 can start before D1 finishes. B4.5 needs signed builds, which arrive with Wave G release work.

## Open questions

- **Rendering when nobody watches.** Pausing an NDI target without receivers saves power, but its first frame then arrives late. The proposal is 1 fps while unwatched, with full rate from the first connection.
- **One composition or per-target canvas sizes.** A vertical 1080×1920 stream needs its own region and layout. That already works through `layout.region`; check that preset text layouts look right in portrait.
- **NDI HX.** Compressed NDI|HX needs the NDI Advanced SDK and a licence. It is out of scope for B4.
