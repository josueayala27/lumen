# 02 — Render contract

The render contract is the only interface between the Vue control app and the Rust renderer. Version 2 replaces the single-slide `Scene` with a **composition** (what to draw) and a list of **screens** (where and how to show it). The model comes from `07-roadmap.md` § Core model.

- TypeScript: `packages/schema/src/composition.ts` (v2) and `packages/schema/src/scene.ts` (v1, kept until A2 lands).
- Rust mirror: `apps/studio/src-tauri/crates/lumen-render/src/lib.rs`.
- Screens, layouts and mapping: `10-screens-and-mapping.md`.

## Rules

- The composition knows nothing about screens. A screen picks layers, a region and style overrides from the composition (sequencing rule 5).
- Rust never calls the API. The contract carries resolved local paths or signed URLs.
- `revision` increases with every change. The renderer diffs by id and revision; it never rebuilds unchanged sources.
- Positions are normalized to the canvas (`0..1`). The canvas has a pixel size; screens scale it.
- Every parameter that can animate is a plain number, colour or boolean on a stable path, such as `layers.<id>.opacity` or `layers.<id>.effects.<id>.params.amount`. The timeline, cues, MIDI and DMX all write to these paths.
- Fonts and assets keep the v1 rules: fonts carry `id`, `family`, `path`, `hash` and fallbacks; assets carry `id`, `hash`, `kind`, path or URL, intrinsic size and `state`. Missing fonts and assets are detected before going live.

## Composition

```
Composition {
  schemaVersion: 2
  revision
  canvas: { width, height }            pixels
  colorSpace: 'srgb'
  sources: Source[]
  layers: Layer[]                      bottom to top
  master: { opacity, effects: Effect[] }
  fonts: SceneFont[]
  assets: SceneAsset[]
}
```

### Sources

A source produces pixels. Several layers can share one source; the renderer decodes it once.

| kind | Fields | Notes |
|---|---|---|
| `video` | `asset`, `loop`, `inMs`, `outMs`, `rate`, `reverse`, `muted`, `volume` | Decode and transport per `05-desktop-output.md` § Media. |
| `image` | `asset` | |
| `slide` | `elements: SlideElement[]`, `safeArea`, `size` | Text, shape and image elements from the v1 layer kinds. Lyrics, slides and text templates are all `slide` sources. |
| `solid` | `color` | |
| `gradient` | `kind: linear \| radial`, `stops`, `angle` | |
| `shader` | `shaderId`, `params` | Built-in WGSL generators: noise, plasma, lines, and similar. Parameters are typed. |
| `ndi`, `camera` | `name` or `deviceId` | Later (Wave E3). Reserved kinds. |

### Layers

```
Layer {
  id, name
  sourceId | null                      null renders nothing
  enabled
  transform: { x, y, w, h, rotation, anchorX, anchorY }   normalized canvas
  fit: cover | contain | stretch
  opacity                              0..1
  blend: normal | add | screen | multiply | overlay | difference | alpha
  effects: Effect[]                    applied in order
  mask: Mask | null
  tags: string[]                       layouts select layers by id or tag, e.g. 'lyrics'
}
```

`alpha` uses the layer as an alpha matte for the layer below it.

### Effects

```
Effect { id, kind, enabled, params: Record<string, number | Color | boolean> }
```

Each effect kind is one WGSL pass with a typed parameter list in `lumen-render`. The first set: `color` (brightness, contrast, saturation, hue, tint), `blur`, `key` (chroma and luma), `transform` (scale, offset, rotate, mirror), `kaleidoscope` and `feedback`. Unknown kinds fail validation in TypeScript and are skipped with a warning in Rust.

### Masks

```
Mask =
  | { kind: 'rect',    x, y, w, h, radius, feather, invert }
  | { kind: 'polygon', points: [x, y][], feather, invert }
  | { kind: 'image',   asset, invert }
```

Mask coordinates are normalized to the layer.

## Render pipeline

1. **Sources:** decode or render each source once per frame into its own texture. `slide` sources render at the size each screen needs (see step 4).
2. **Layers:** for each enabled layer, sample its source with `fit` and `transform`, run the effects chain, apply the mask, then blend onto the canvas with `blend` and `opacity`.
3. **Master:** apply `master.effects` and `master.opacity` to the canvas.
4. **Screens:** for each screen, filter layers by its layout, crop its region, apply text overrides, then apply mapping. Screens that share the same layer filter and no text override share one canvas render. See `10-screens-and-mapping.md`.

## Preview flow

1. Vue builds a `Composition` from the show, the live state and resolved assets.
2. `preview_render` renders the canvas, or one screen, offscreen at the requested size.
3. Rust returns raw image bytes and a `PreviewResult`.
4. Vue draws the image and places selection handles, snapping guides and the text editing overlay from `PreviewResult`.
5. During a drag, render at 640×360. Render at full size on release.

`PreviewResult` keeps the v1 shape: `bounds` and `textRuns` with line boxes and caret stops, now keyed by `sourceId` and `elementId`. The editor uses Rust text layout, never browser shaping.

## Transitions

- **Layer transition:** when a layer changes `sourceId`, the renderer keeps the old source and crossfades to the new one over `durationMs` with `easing`. A cut skips the blend.
- **Slide transition:** a `slide` source whose `revision` changes uses `TransitionPlan { fromRevision, toRevision, kind, durationMs, easing }`. Kinds: `cut`, `fade`, `dissolve`, `slide`, `zoom`.
- **Master modes:** black, clear and freeze from `03-live-engine.md` apply after the master stage, per screen.

## Stage display

The stage window is a Tauri webview with Vue chrome. Current and next images come from the Rust renderer, rendered from a stage screen layout. Notes, clock, timers and controls are Vue. There is no second text renderer for slide content.

## Migration from v1

`sceneToComposition(scene)` in `packages/core` converts a v1 `Scene`:

- `background` becomes layer 0 with a `solid`, `image` or `video` source.
- v1 `layers` become one `slide` source on a layer tagged `content`, or `lyrics` for songs.
- `role: audience` becomes the default audience screen. `role: stage` becomes a stage screen.

Rust renders v1 through the same adapter until A2 is complete. After that, `Scene` v1 is read only for import and old saved timelines.
