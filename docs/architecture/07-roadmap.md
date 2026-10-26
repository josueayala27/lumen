# 07 — Roadmap

Supersedes the worship-only roadmap (Waves 0–4, M0–M18). Organised as waves of shippable milestones.

## Product target

Lumen is one engine for everything shown live on screens: slides, graphics, media and cues, run by one operator or a team, on one machine or many.

First markets:

1. **Events and corporate** — conferences, keynotes, town halls, launches. Replaces PowerPoint/Keynote presenter view, confidence-monitor timers and ProPresenter at events.
2. **Streaming and broadcast** — lower thirds, titles, scoreboards, tickers. Competes with vMix titles, H2R Graphics, Singular and CasparCG.

Worship is a supported market through an optional pack, not the product definition. Theatre and show control follow through the timeline and control bus.

## Product structure

**Core** — every workspace:

- Content: scenes, layers, templates, media, themes, timeline.
- Running: rundowns (formerly playlists), live state, cue engine, timers, macros.
- Outputs: multiple outputs with per-output Looks, stage and confidence displays, NDI, alpha key, web output.
- Control: one command bus behind MIDI, OSC, HTTP/WebSocket, Stream Deck/Companion, web remote and macros.
- Cloud: accounts, workspaces, sync, collaboration.

**Packs** — enabled per workspace. A pack adds content types, importers, rundown item kinds and integrations. It never changes the scene contract or the renderer.

| Pack | Adds |
|---|---|
| Events | PPTX/Keynote/PDF import, agenda rundowns, speaker timers and messages, presenter clickers |
| Broadcast | Data-bound templates, data sources, lower thirds, tickers, scoreboards, playout queue |
| Worship | Songs and arrangements, lyric split, Bible, CCLI/SongSelect, Planning Center, MultiTracks |
| Show control | OSC out, DMX, projection surfaces, MIDI feedback |

## Done

- **Foundation:** monorepo, design system, Drizzle schema, Tauri shell, CI, local SQLite library, native `wgpu` audience window with surface recovery.
- **Presenter core (former Wave 1):** scene renderer, editor (layers, undo/redo, snapping, autosave), themes, playlists with real live state and crash resume, stage window, media import/probe/relink and ffmpeg video playback. Code complete; manual acceptance still required on a second display, stage window and video playback.
- **Timeline (former Wave 1.5, T1–T6):** `ShowTimeline` model and edit helpers, pure playback engine, live runner with internal clock or LTC/MTC follow, marker and clip cues, keyframes applied to the audience scene, media clips as scene layers, audio clips with audio-master clock, timeline editor with undo/redo, copy/paste, playback and JSON import/export. Desktop acceptance (audience keyframes, audio, real LTC) still required.
- **Show control:** MIDI input bindings, MTC and LTC decode.

## Wave A — Generalize the core

### A1 Core and pack boundary

- `PresentationDoc.kind` becomes a content-type registry; `song` registers from the Worship pack.
- Move `song.ts`, the lyric split and the Songs page behind the Worship pack.
- Workspace setting for enabled packs; new workspaces default to Events and Broadcast.
- "Playlist" becomes "Rundown" in UI, docs and new code; storage keeps the existing tables with a migration alias.
- Neutral sample content, onboarding and empty states (no church defaults).

Exit: a fresh install with no Worship pack shows no song or church wording; enabling the pack restores songs with existing documents intact.

### A2 Presenter acceptance

- Run the open manual acceptance from Done on real hardware: second display, stage, video, timeline keyframes, audio, LTC.

Exit: a 30-minute rundown runs on a second display, survives a restart, and a timeline drives slides, media and keyframes on the audience output.

## Wave B — Outputs and control

### B1 Command bus and API

- One `Command` type for every input; MIDI, timeline, macros and UI dispatch through it (former M14 move-up).
- Local HTTP and WebSocket API: state, commands, rundown, timers. Token-protected, LAN-only by default.
- OSC input mapped to commands.
- Bitfocus Companion module and Stream Deck support on top of the API.

Exit: Companion, MIDI, OSC and HTTP all drive the same live state with identical results.

### B2 Multiple outputs and Looks

- Any number of outputs, each with a Look: layer visibility (slides, media, graphics, props), mask, safe area.
- Output assignment by stable display identity.
- Props and announcement layers independent of the slide.

Exit: two projectors and a confidence monitor show different Looks of one rundown.

### B3 Network outputs

- NDI output per output, with alpha.
- Alpha key (key/fill) on two physical outputs.
- Web output: a read-only HTML scene view for OBS/vMix browser sources and remote screens.

Exit: a lower third with alpha reaches a switcher over NDI and an OBS browser source at the same time.

### B4 Web remote and confidence monitor

- Phone/tablet remote served by the desktop app over LAN: next/prev, rundown, timers, messages.
- Confidence monitor: current/next slide, notes, speaker countdown with warning colours, operator messages.

Exit: a speaker runs a session from a clicker while the operator controls timers from a phone.

### B5 Network Link

- Several Lumen machines on one LAN: one controller, any number of render nodes.
- Nodes follow live state and timeline clock from the controller and render their own outputs locally.
- Controller failover: a node can take over control without stopping its outputs.

Exit: three machines drive five outputs from one rundown; unplugging the controller leaves every output running.

## Wave C — Events pack

### C1 Import

- PPTX import as native editable slides (text, images, notes, simple builds).
- Keynote via PDF/PPTX export; PDF as image slides with notes.
- Re-import that updates an existing deck and keeps rundown cues.

Exit: a 40-slide corporate deck imports, edits and runs with notes on the confidence monitor.

### C2 Agenda rundowns

- Rundown items with planned start and duration, over/under tracking, session countdowns.
- Speaker timers tied to rundown items; walk-in loops and holding slides.
- Presenter clicker and HID keyboard mapping.
- Calendar scheduling: start rundowns, loops and announcements at set times for venues, lobbies and classrooms (signage mode).

Exit: a half-day agenda runs on time with automatic countdowns and walk-in loops between sessions, and a lobby screen switches loops on a schedule.

### C3 Importers from other presenters

- ProPresenter (`.pro`, playlists), EasyWorship, OpenSong/OpenLP and FreeShow libraries.
- Slides, media references, themes and notes map to core content; songs map to the Worship pack when it is enabled, otherwise to plain presentations.
- Import report listing anything that could not be mapped.

Exit: a ProPresenter library and an EasyWorship library import, and a converted show runs unchanged.

## Wave D — Broadcast pack

### D1 Data-bound templates

- Template fields bound to layer properties (text, colour, image, visibility).
- Field values per rundown item or per cue; quick edit while live.
- Template library: lower thirds, titles, full-screen cards, bugs.

Exit: one lower-third template shows twenty different speakers without duplicating slides.

### D2 Data sources

- CSV, Google Sheets, JSON over HTTP, and push via the local API.
- Polling with change detection; values flow into bound fields live.
- Scoreboards, clocks and tickers built from fields.

Exit: a scoreboard updates from a spreadsheet and a ticker from a JSON feed during a stream.

### D3 Playout

- Graphics queue independent of the slide rundown: cue, take, clear per layer.
- Animated in/out from timeline keyframes.
- NDI input as a layer source.

Exit: an operator stacks, takes and clears lower thirds over NDI video while slides run on another output.

## Wave E — Cloud and collaboration

### E1 Accounts, workspaces and sync

- Better Auth desktop handoff, keychain, workspaces, members, roles, invites.
- Pull/push sync, revisions, conflict copies and conflict UI; R2 media.

Exit: edit on two machines, resolve a conflict, run offline.

### E2 Collaboration and browser apps

- Several editors on one rundown with presence; live updates while a show runs.
- Browser editor and browser remote from `apps/web`.
- Shared template and media libraries across workspaces.

Exit: a producer edits the rundown in a browser while the operator runs it on desktop without data loss.

### E3 Multi-site and billing

- One show sent to several sites, each with a local engine.
- Plans, seats, entitlements, per-pack billing.

Exit: two venues run the same show with local outputs and shared cues.

### E4 Platform

- Pack SDK: third-party packs register content types, rundown items, importers, data sources and commands through the A1 boundary.
- Template and pack marketplace inside workspaces.
- Public cloud API and webhooks for rundowns, templates and data sources.

Exit: an external pack adds a new data source and template type without changes to the core.

## Wave F — More packs

### F1 Worship pack

- Arrangements, Quick Edit and Reflow, section-aware navigation.
- Bible (public-domain translations first), CCLI/SongSelect, Planning Center, MultiTracks.

Exit: import a Planning Center service and a SongSelect song; run it unchanged.

### F2 Show control pack

- OSC and MIDI output, LED/fader feedback, DMX.
- Projection surfaces and edge blending.

Exit: a timeline drives lights over DMX and video over two blended projectors.

### F3 Audio

- Audio bin, tracks, device routing up to 16 channels, sound effects.

Exit: a rundown with backing tracks and stingers stays in sync with slides.

## Wave G — Production and GA

- SDI (DeckLink/UltraStudio), Syphon/Spout.
- Soak tests, GPU matrix, sleep/wake, decoder crash, low disk.
- Data migrations, backfills, rollback; Sentry/Workers Logs.
- Signed installers, updater channels, staged rollout; security, privacy and licence review.
- Linux decision; 4K60 measurement.

Exit: signed macOS and Windows GA builds with rollback and telemetry.

## Coverage map

| Area | Reference products | Waves |
|---|---|---|
| Slides, editor, themes | PowerPoint, Keynote, ProPresenter | Done, C1 |
| Rundowns and timers | ProPresenter, StageTimer-style tools | Done, C2 |
| Confidence monitor | ProPresenter Stage, Watchout | Done, B4 |
| Outputs, Looks, alpha, NDI | ProPresenter, vMix | B2, B3, G |
| Data-driven graphics | Singular, H2R Graphics, vMix titles, CasparCG | D1–D3 |
| Control surfaces and API | Companion, Stream Deck, QLab OSC | B1, F2 |
| Timeline and timecode | QLab, Millumin, ProPresenter | Done, F2 |
| Collaboration and cloud | Proclaim, Singular | E1–E3 |
| Multi-machine shows | ProPresenter Network Link, Watchout | B5, E3 |
| Importers from other presenters | FreeShow, ProPresenter | C3 |
| Scheduling and signage | ProPresenter calendar, signage tools | C2 |
| Plugins and marketplace | Companion modules, Singular apps | E4 |
| Worship content | ProPresenter, EasyWorship, FreeShow | F1 |

## Sequencing rules

1. A1 before any new content type: packs register through the boundary, never by editing the core.
2. B1 before B4, C2 and D3: every control path goes through the command bus.
3. B2 before B3: network outputs are outputs with a Look.
4. D1 before D2: data sources only feed bound fields.
5. A1 before C3 and E4: importers and external packs use the pack boundary.
6. Cloud stays out of the live path: a show runs with no network (invariant 2).
7. Every milestone needs an offline test and a restart test.
