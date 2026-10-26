# 07 — Roadmap

Supersedes the worship presenter roadmap (Waves 0–4) and the events/broadcast roadmap. Organised as waves of shippable milestones.

## Product target

Lumen is a live visuals system: one app that projects media, lyrics, slides and graphics on any number of screens, maps every screen, gives each screen its own layout, runs live visual layers and effects, and stays in sync with lighting, timecode and music.

Reference products, combined:

| Area | Reference | Lumen takes |
|---|---|---|
| Lyrics, slides, stage display | ProPresenter | Content, arrangements, confidence monitors |
| Live layers, effects, clip launching | Resolume Arena | Compositor, clip grid, BPM, audio-reactive |
| Timeline, mapping, multi-screen | Millumin, Watchout | Timeline, warping, edge blend, per-screen layouts |
| Cue-based show running | QLab | GO cue list, OSC/MIDI, network cues |
| Lighting sync | Media-server fixture modes | DMX/Art-Net/sACN in and out, timecode |

Markets: concerts and tours, worship, events and conferences, theatre, installations. No market owns the core; market-specific integrations are packs.

## Core model

- **Sources** produce pixels: video, image, slide/lyrics, text template, shader generator, NDI, camera.
- **Layers** stack sources with opacity, transform, blend mode, effects chain and mask.
- **Composition** is the layer stack rendered on a virtual canvas.
- **Screens** are physical or network outputs. Each screen has a **layout**: which layers it shows, its slice of the canvas, its own safe area and text style (for example lyrics large on side screens, small on the LED wall, notes on stage).
- **Mapping** happens per screen after the layout: corner pin, mesh warp, edge blend, masks, colour.
- **Control** goes through one command bus: UI, cue list, timeline, MIDI, OSC, DMX, timecode, HTTP and remotes.
- **Clocks**: internal, timecode (LTC/MTC), BPM (tap, MIDI clock, Ableton Link) and audio master.

The audience path stays native (invariant 1) and runs with no network (invariant 2).

## Done

- **Foundation:** monorepo, design system, Tauri shell, CI, local SQLite library, native `wgpu` output window with surface recovery.
- **Presenter core:** scene renderer (text, shape, image, video background), editor (layers, undo/redo, snapping, autosave), themes, playlists with live state and crash resume, stage window, media import/probe/relink, ffmpeg video playback. Manual desktop acceptance still open.
- **Songs:** lyric split into slides, song editor.
- **Timeline (T1–T6):** `ShowTimeline` model, playback engine, live runner (internal clock or LTC/MTC), marker and clip cues, keyframes on the output scene, media and audio clips, timeline editor with undo/redo, copy/paste, playback, JSON import/export.
- **Show control:** MIDI input bindings, MTC and LTC decode.

## Wave A — Visual engine

Everything later depends on this wave.

Status: Hap decode (all variants except HDR) with direct BC upload, CPU fallback, frame-accurate playback, 16 Hap decoders, shared frames across outputs and `-hwaccel auto` for ffmpeg are done. Open: native VideoToolbox/Media Foundation decode with zero-copy textures, NotchLC, ProRes, a seek/transport API on the show clock, decoder preload, and the 8-layer budget measurement on real media.

### A1 Video engine

- Hardware decode: VideoToolbox (macOS), D3D11/Media Foundation (Windows); frames stay on the GPU.
- GPU-friendly codecs: HAP/HAP Q/HAP Alpha first, NotchLC later; ProRes on macOS.
- Frame-accurate seek, loop, in/out points, speed, reverse; decoder pool with preload.
- Budget: 8 layers of 1080p60 or 4 layers of 4K30 on a mid-range GPU.

Exit: eight HAP layers loop at 1080p60 without dropped frames; seeking to a frame lands on that frame.

### A2 Compositor and scene contract v2

- Scene contract v2 (`02-render-contract.md`): layers reference sources; blend modes (add, screen, multiply, overlay, difference, alpha); per-layer masks.
- Effects chain per layer and per composition as WGSL shaders with typed parameters: colour, blur, keying, transform, kaleidoscope, feedback.
- Generators: shader sources with parameters, solid, gradient, noise.
- Text and lyrics render as a source like any other.

Exit: lyrics over a keyed video over a generator, with three effects, render at 60 fps; preview and output match.

## Wave B — Screens, layouts and mapping

### B1 Screen manager

- Any number of screens: displays, NDI outputs, virtual screens; stable display identity.
- Canvas size independent of screens; a screen shows a slice of the canvas or its own layout.
- Test patterns, identify, per-screen enable and blackout.

Exit: three displays and one NDI output each show a different slice or layout of one composition.

### B2 Per-screen layouts

- Layout = layer visibility + text style override + safe area + background per screen.
- Lyrics layouts: full screen, lower third, LED-wall strip, stage view with next line.
- Stage and confidence screens: current/next, notes, clocks, messages.

Exit: one song shows big lyrics on side screens, a strip on the LED wall and current/next on the stage monitor.

### B3 Mapping

- Corner pin and mesh warp (bezier grid) per screen, edited on the output with handles.
- Edge blend with gamma and overlap for multi-projector screens.
- Masks (polygon, bezier, image), colour and brightness per screen.
- Projection surfaces: map canvas regions onto physical shapes.

Exit: two projectors blend into one seamless image on a curved surface; a third maps a logo onto an object.

## Wave C — Live visuals

### C1 Clip grid

- Decks with layers and columns; trigger clips per cell, launch a column across layers.
- Clip transitions and per-layer crossfade; autopilot (next clip, random, loop count).
- Thumbnails and live previews per clip.

Exit: a performer launches columns on beat across four layers with crossfades.

### C2 Tempo and audio-reactive

- BPM clock: tap, MIDI clock in, Ableton Link; beat-synced clip speed and transitions.
- Audio input analysis (levels, FFT bands, onset) as modulation sources.
- Parameter modulation: LFOs, envelopes, beat and audio sources on any effect or layer parameter.

Exit: an effect pulses with the kick drum and clips change on the bar, locked to Ableton Link.

### C3 Live control surface

- Map any parameter or trigger to MIDI controllers with feedback (LEDs, motor faders).
- Dashboard of macros and favourite parameters for performance.

Exit: an APC-style controller launches clips and controls effects with lit pads.

## Wave D — Sync and control

### D1 Command bus and API

- One command type for every input and output; UI, cues, timeline and remotes dispatch through it.
- Local HTTP and WebSocket API; OSC in and out; Bitfocus Companion module and Stream Deck.

Exit: Companion, OSC and MIDI drive the same state with identical results.

### D2 Lighting sync

- DMX in over Art-Net and sACN: Lumen as a media-server fixture (layer intensity, clip select, effect parameters per channel).
- DMX out: lighting cues on the timeline and in the cue list; colour sampled from video to fixtures.
- MIDI and OSC to lighting consoles; timecode generation (LTC out, MTC out) for consoles and DAWs.

Exit: a lighting console controls Lumen layers over sACN; Lumen's timeline drives fixtures over Art-Net in sync with video.

### D3 Show clock

- One clock for timeline, clips and cues: internal, LTC/MTC follow, BPM, audio master; chase and freewheel.

Exit: a show follows LTC from a DAW while clips stay beat-locked and cues fire once.

## Wave E — Show running

### E1 Cue list

- QLab-style GO list: cues for clips, slides/lyrics, layouts, effects, lighting, audio, OSC/MIDI, waits, fades and groups.
- Pre-wait, post-wait, auto-follow, auto-continue; cue numbers; GO, stop, panic.
- Cue list and timeline share actions; a timeline can be a cue.

Exit: a 60-cue show runs from one GO button with fades and auto-follows.

### E2 Content running

- Rundowns of songs, presentations and media; lyrics with arrangements and section-aware navigation.
- PPTX/PDF import; text templates with data fields (CSV, JSON, HTTP).

Exit: a set list of songs with arrangements runs while visuals play under the lyrics.

### E3 Network Link and remotes

- Several machines: one controller, render nodes following state and clock; failover.
- Web remote and stage pages over LAN; NDI in as a source.

Exit: three machines drive six screens from one show; unplugging the controller leaves outputs running.

## Wave F — Audio

- Multichannel audio engine in `lumen-media`: devices, routing, per-cue levels and fades, sample-accurate clock.
- Audio cues and timeline audio on the engine; audio master for the show clock.

Exit: a show with backing tracks, stingers and video stays in sync across a 30-minute set.

## Wave G — Cloud, packs and release

- **Cloud:** accounts, workspaces, sync, shared libraries, collaboration.
- **Packs:** Worship (CCLI/SongSelect, Bible, Planning Center, MultiTracks); Events (agenda timers, speaker tools); Broadcast (graphics playout). Packs never change the scene contract.
- **Outputs:** SDI (DeckLink), Syphon/Spout, alpha key.
- **Release:** soak tests, GPU matrix, signed installers, updater channels, telemetry, security and licence review.

Exit: signed macOS and Windows builds run a full show offline; cloud sync and packs work on top.

## Sequencing rules

1. A1 and A2 before C: live visuals need the video engine and compositor.
2. A2 before B2: layouts filter layers of the v2 scene.
3. D1 before D2, E1 and E3: every control path goes through the command bus.
4. D3 before E1 and F: one clock for cues, timeline and audio.
5. Mapping and layouts stay per screen, after composition; content never knows which screen shows it.
6. Cloud stays out of the live path.
7. Every milestone needs an offline test, a restart test and a frame-rate budget check.
