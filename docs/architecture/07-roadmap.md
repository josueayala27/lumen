# 07 — Roadmap

Supersedes the old Phase 0–4 list. Organised as waves of shippable milestones. The ProPresenter feature baseline is [all-features](https://www.renewedvision.com/pt/propresenter/all-features).

## Product target

A local-first worship presenter that can create a service, style it, run it live on audience and stage outputs, and survive a full service offline. ProPresenter parity is a later target; MVP parity is Wave 1.

## Wave 0 — Foundation and render proof

### M0.1 Local foundation — partial

Done: monorepo, design system, API skeleton, Drizzle schema, Tauri shell, CI, local SQLite library, song split, text editor, text-only live page.

Remaining:

- Desktop auth handoff and keychain (moved to Wave 4; not a blocker for local MVP).
- Signed dev builds and updater keys (release gate for Wave 2).
- Finish the renderer spike before editor work continues.

### M0.2 Renderer spike — partial

Done: borderless `wgpu` window, clear pass, frame timing, monitor polling, surface-state handling.

Exit: a hardcoded text/image scene renders in the audience window at 1080p60 with recovery after surface loss.

## Wave 1 — Core presenter (MVP-1)

Ship this before any more control features.

### M1 Scene renderer v1

- cosmic-text shaping, line boxes, caret stops, `PreviewResult`.
- Layers: text, shape, image, video background, group.
- Layer compositing with z, opacity, rotation, fit, radius.
- Transitions: cut/fade/dissolve/slide/zoom in shader.
- `preview_render` returns image plus real layout; native output draws the same scene.

Exit: text + image + video-background slide renders identically in editor and audience; 1080p60; surface loss recovers.

### M2 Editor v1

- Slide rail, Rust-rendered canvas, layer inspector.
- Add/edit/reorder/delete text, shape, image, video layers.
- Undo/redo, copy/paste, multi-select, keyboard shortcuts, autosave.
- Snapping and selection from Rust layout data.
- Reflow view for all text and slide breaks.

Exit: create a presentation, add text and an image, edit, save, reopen, undo/redo.

### M3 Themes and typography

- Theme editor: background, title/body styles, transition.
- Apply theme to a presentation; theme changes update every slide.
- Font import, missing-font detection, fallback selection, license flag.
- Safe-area and letterbox controls.

Exit: two presentations share a theme; changing it updates both.

### M4 Playlists and live v1

- Playlist editor: presentations, media, headers; reorder.
- Real `LiveState` store, not page-local mock.
- Preview/take, next/prev item, output modes, transitions.
- Next-slide preload and crash resume.
- Live loads a playlist, not one presentation.

Exit: run a 30-minute playlist on a second display with no webview in the audience path; restart resumes position.

### M5 Stage v1

- Stage window with Rust current/next images.
- Notes, clock, countdown/elapsed timers, stage message, safe area.
- Per-performer layouts.

Exit: stage display runs beside audience output with current/next and notes.

### M6 Media v1

- Import images and video into an app-managed folder.
- Media bin, thumbnails, probe metadata, missing-media relink.
- Image/video backgrounds and foreground layers.
- Media path validation and decoder budget.

Exit: import a video, set it as a background, play it live, recover from a moved file.

### Wave 1 exit — MVP-1

Create a song and a presentation, style both with a theme, put them in a playlist, run live on audience and stage, offline, and reopen after restart. Wave 1 code is complete; manual acceptance is the remaining gate.

## Wave 1.5 — Timeline and automation

Priority changed: timestamp automation and an After Effects-style timeline come before audio and imports. One timeline model, delivered in two phases.

### T1 Timeline model v1

- `TimelineDoc`: frame rate, duration, tracks, clips, markers, keyframes.
- Tracks: slide, layer, media, audio, macro.
- Clips: start, duration, trim, source reference, z.
- Markers: timestamp, action, enabled.
- Keyframes: property, frame, value, easing.
- Migrate the existing cue timeline to markers; keep LTC/MTC frame counts.

Exit: schema + pure edit helpers (add/move/trim/split/delete/keyframe) with tests.

### T2 Playback engine

- Internal clock, play/pause/stop/seek, loop, frame-accurate stepping.
- External clock: LTC/MTC lock, offset and drift handling.
- Evaluate timeline at frame: visible clips, marker firing, sampled keyframe values.
- Emit scene snapshots and commands to live/output.

Exit: a timeline plays forward/back and follows LTC without duplicate cue fires.

### T3 Timeline editor

- After Effects-style panel: ruler, playhead, zoom/pan, multi-track rows.
- Drag clips, trim edges, split, delete, snap to frames/markers/clip edges.
- Marker editor, track mute/lock, inspector for selected clip/keyframe.
- Undo/redo, copy/paste, keyboard shortcuts.
- Persist per presentation/playlist.

Exit: build and edit a 10-minute timeline without touching JSON.

### T4 Cue automation

- Slide changes, output modes, media play/stop, macros and stage messages at timestamps.
- Auto-advance slides; transition at marker; loop ranges.
- Arm/disarm, skip missed cues policy, live status.

Exit: a service timeline drives slides, media and macros by timestamp.

### T5 Keyframes and curves

- Animate layer position, scale, rotation, opacity, color and text properties.
- Easing curves, linear/bezier, per-property keyframes.
- Preview and audience render from sampled values, not duplicated scenes.
- Text builds/animations reuse the same keyframe engine.

Exit: a text layer animates in/out on the timeline with correct easing in preview and audience.

### T6 Timeline audio and integration

- Audio clips and waveform track in the timeline model.
- Audio-master clock; video/LTC follows audio within tolerance.
- Markers can trigger audio actions and macros.
- Import/export timeline JSON.

Exit: timeline with video, audio, slide cues, macros and keyframes runs offline.

### Wave 1.5 exit

A 10-minute service timeline with slide cues, macros, video, text keyframes and audio follows an external LTC clock, survives restart, and renders the same in editor, audience and stage.

## Wave 2 — Service-ready (MVP-2)

### M7 Audio

- Audio bin, audio tracks and sound effects.
- Device selection, per-track routing, up to 16 internal channels.
- Audio-master clock; video seeks within 40 ms.
- Preload and decoder limits.

Exit: playlist with a backing track and sound effects runs in sync with slides.

### M8 Automation

- Slide actions: clear media, switch input, fire macro.
- Macros: chain slide, media, audio, output and timer actions.
- Playback markers: fire macros or stage messages at time/frame.
- Timers and dynamic text.
- Calendar scheduling for announcements.

Exit: a macro fired by a marker changes media, starts audio and updates the stage message.

### M9 Song workflow

- Arrangements: reorder, repeat, skip sections.
- Quick Edit and Reflow Editor parity.
- Section-aware live navigation and arrangement save.

Exit: build two arrangements of one song and run both.

### M10 Outputs v2

- Multiple simultaneous outputs with per-output Looks.
- Alpha key, edge blending, announcements screen.
- Output assignment persisted by stable display identity.
- Power assertions and display-sleep prevention.

Exit: two projectors plus a stage screen with different Looks.

### M11 Import and content

- SongSelect by CCLI.
- MultiTracks import.
- Planning Center order of service and Services Live.
- PowerPoint import (no backgrounds first).
- ProPresenter import.
- Bible, public-domain translations first.

Exit: import a Planning Center service and a SongSelect song; run it unchanged.

### Wave 2 exit — MVP-2

Run a complete service from a playlist with audio, macros, arrangements, multiple outputs, stage display and imported content.

## Wave 3 — Production

### M12 Advanced content

- Props, masks, builds, text animations, custom objects.
- Live video inputs and overlays.
- ProContent asset browser (licence-dependent).

Exit: lower third, mask and build run live.

### M13 Broadcast outputs

- NDI, SDI (DeckLink/UltraStudio), Syphon/Spout.
- Alpha key and edge blend under load.
- ProDisplay export, Resi/stream actions.
- Announcements and secondary presentation at production quality.

Exit: send key/fill to a switcher over NDI and SDI simultaneously.

### M14 Control surfaces and API

- MIDI out and LED/fader feedback.
- DMX, Stream Deck, Remote, HTTP API.
- Network Link for multiple local machines.
- Existing LTC/MTC and MIDI input move onto the shared command bus.

Exit: Stream Deck, MIDI controller, DMX and remote all drive the same live state.

### M15 Timeline v2

- Timeline with slides, media, audio, actions and macros.
- LTC/MTC lock drives the whole timeline, not just commands.
- Playback markers and timecode offset.

Exit: a 10-minute timeline with video and macros follows external LTC without drift.

## Wave 4 — Cloud, scale and launch

### M16 Accounts, workspaces and sync

- Better Auth desktop handoff, keychain.
- Workspaces, members, roles, invites, libraries.
- Pull/push sync, revisions, conflict copies and conflict UI.
- R2 media upload, missing-media states across devices.

Exit: edit on two machines, resolve a conflict, reopen offline.

### M17 Collaboration and billing

- Cloud collaboration and realtime remote.
- Plans, seats, entitlements, billing.
- Shared themes/media libraries.

Exit: two editors in one workspace without data loss.

### M18 Hardening and GA

- Soak tests, GPU matrix, low disk, sleep/wake, decoder crash.
- Data migrations, backfills, rollback.
- Sentry/Workers Logs, crash triage, support.
- Signed installers, updater channels, staged rollout.
- Security and privacy review; licence compliance.
- Linux/web-output decision; 4K60 measurement.

Exit: signed macOS and Windows GA builds with rollback and telemetry.

## Feature coverage map

| ProPresenter area | Milestones |
|---|---|
| Editor, custom objects, effects | M1, M2, M12 |
| Themes, Quick Edit, Reflow | M2, M3, M9 |
| Lyrics, arrangements, SongSelect | M9, M11 |
| Playlists | M4 |
| Media, video inputs, ProContent | M6, M12 |
| Audio | M7 |
| Stage display | M5 |
| Outputs, Looks, alpha, blending | M10, M13 |
| MIDI, DMX, Stream Deck, API, Remote | M14 |
| Macros, markers, calendar, timeline, timecode | M8, T1–T6, M15 |
| Planning Center, MultiTracks, Bible | M11 |
| NDI, SDI, Syphon/Spout, Resi, ProDisplay | M13 |
| Cloud, Network Link, collaboration | M14, M16, M17 |
| Import/export | M11 |

## Sequencing rules

1. M1 blocks M2 and audience output. Do not build editor UI on a fake renderer.
2. M2 blocks M3 and M4. Do not build playlists on text-only slides.
3. M4 blocks M5, M7, M8. Live state must be real before automation.
4. Wave 1.5 starts after Wave 1 acceptance. T1/T2 block T3/T4/T5.
5. MIDI/LTC/timeline work is a parallel track and does not gate MVP-1.
6. Cloud and auth stay in Wave 4 until local service flow is solid.
7. Every milestone needs an offline test and a restart test.

## Current state

- M0.1: partial.
- M0.2: renderer spike complete.
- M1: scene renderer done; remote video decode and group layers remain blocked (no schema variant).
- M2: editor layer inspector, undo/redo, copy/paste, Rust canvas, snapping and debounced autosave done.
- M3: themes model, store and editor page done; editor applies theme on save.
- M4: playlists, real live session, crash resume and persisted timers done.
- M5: stage window, current/next, notes, timers and safe area done; stage capability added.
- M6: media import, probe, thumbnails, relink, video playback via ffmpeg and editor media picker done.
- Wave 1 code complete. Manual acceptance still required: second display, stage window, MIDI/LTC, video playback with `LUMEN_FFMPEG` or `ffmpeg` on PATH.
- Frozen: MIDI/LTC/timeline track.
