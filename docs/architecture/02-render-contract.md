# 02 — Render contract

`packages/schema/src/scene.ts` is the only contract between the Vue editor and the Rust renderer. The Rust mirror lives in `apps/studio/src-tauri/crates/lumen-render/src/lib.rs`.

## Rules

- Frames are normalized `{x,y,w,h}` in slide units. The viewport scales; the document does not.
- `Scene` carries resolved local paths or signed URLs. Rust never calls the API.
- Fonts carry `id`, `family`, `path`, `hash` and fallbacks. Missing fonts are detected before live.
- Assets carry `id`, `hash`, `kind`, path/URL, intrinsic size and `state` (`ready`/`missing`).
- `revision` increases with every edit. Transitions compare `fromRevision` and `toRevision`.
- `PreviewResult` returns `bounds` and `textRuns` with line boxes and caret stops. The editor overlay uses Rust layout, not browser shaping.

## Preview flow

1. Vue builds a `Scene` from the document, theme and resolved assets.
2. `preview_render` renders offscreen at the requested size.
3. Rust returns raw image bytes plus `PreviewResult` layout data.
4. Vue draws the image and positions selection handles, snapping guides and the text editing overlay from `PreviewResult`.
5. During drag, render at 640×360; render full size on release.

## Stage display

The stage window is a Tauri webview with Vue chrome. Current and next slide images come from the Rust renderer; notes, clock, timers and controls are Vue. There is no second text renderer for slide content.

## Transitions

`TransitionPlan { fromRevision, toRevision, from, to, kind, durationMs, easing }` is sent as one payload. The renderer keeps the outgoing and incoming textures and blends them in a shader. Cut bypasses the blend.
