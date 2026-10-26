# 07 — Roadmap

## Phase 0 — Foundation

Current state: monorepo, design system, studio shell, web shell, API skeleton, DB schema, realtime DO, Tauri shell, native window placement, tests and typechecks.

Remaining Phase 0 exit items:

- Neon branch and `.dev.vars` for local API.
- Better Auth schema migration and Google/magic-link credentials.
- Desktop auth handoff (`/desktop-auth` → `lumen://auth` → keychain).
- CI workflow for macOS and Windows.
- Certificate and updater-key procurement.

## Phase 0.5 — Native output spike

- One borderless `wgpu` window on a chosen monitor.
- Hardcoded scene, clear pass and frame timing.
- `PreviewResult` with Rust layout.
- Surface-loss recovery and monitor polling.
- Signed dev builds on macOS and Windows.

## Phase 1 — Content

- Local SQLite repo and sync engine.
- Presentation editor: slide rail, Rust-rendered canvas, inspector, text/shape/image/media.
- Song lyrics, sections and automatic splitting.
- Theme editor, media import, thumbnails, playlist editor.
- Asset upload and missing-media states.

## Phase 2a — Output core

- Live workspace wired to the reducer.
- Audience output, display assignment, black/clear/logo/freeze, transitions.
- Next-slide preview, preload, crash resume.

## Phase 2b — Media

- Image/video backgrounds, audio device selection, audio-master clock, decoder budget.

## Phase 2c — Stage

- Stage display with Rust current/next, notes, clock, timers, safe area.

## Phase 2d — Show control

- MIDI input bindings (note, CC, program change) with learn mode.
- SMPTE frame math for 24, 25, 29.97, 29.97 drop-frame and 30.
- Follow external MTC and LTC, with lock state and timeout.
- Audio input selection for LTC and the `control:event` Tauri channel.
- Exit: a MIDI pedal drives next/prev/take; MTC and LTC drive a locked timecode readout.

## Phase 3 — Remote

- Durable Object pairing, QR/code, phone remote, reconnect.

## Phase 4 — Pro

- NDI/Syphon/Spout, OSC, Bible, SongSelect, ProPresenter import, streaming, builds, props/masks, lower thirds, collaboration, billing.
