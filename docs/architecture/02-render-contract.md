# 02 — Render contract

The render contract is the only interface between the Vue control app and the Rust renderer. Version 2 replaces the single-slide `Scene` with a **composition** (what to draw) and a list of **screens** (where and how to show it). The model comes from `07-roadmap.md` § Core model.

- TypeScript: `packages/schema/src/composition.ts` (v2) and `packages/schema/src/scene.ts` (v1, kept until A2 lands).
- Rust mirror: `lumen-render/src/lib.rs` (v1) and `lumen-render/src/composition.rs` (v2, with screens). Fixture tests parse JSON produced by the Zod schemas (`lumen-render/fixtures/`).
- Rust compositor: `lumen-render/src/compositor.rs`, `compositor.wgsl` and `screen.wgsl`. Effect and generator parameters: `effects.rs`. Layout and mapping maths: `mapping.rs`.
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

## Implementation (A2)

The Rust compositor implements this contract. Notes on how it reads the contract:

- Every intermediate texture holds premultiplied linear RGBA in `Rgba16Float`. Contract colours are sRGB and are converted to linear light. Blending runs in WGSL with ping-pong targets.
- Each used source renders once per frame. Videos and images convert once per new frame. Solids and gradients are cached until they change. Slides re-render only when their layout, size or text override changes. Shader generators render every frame.
- Slide sources render at the layer box size through the v1 scene renderer, so slide pixels stretch to the box like the TS adapter. Text layout comes from the same pass.
- Gradients interpolate in sRGB, like CSS. They keep the first 8 stops.
- Effects run in canvas space, after the source is placed with `fit` and `transform`. The mask applies after the effects, as in the pipeline above.
- `alpha` multiplies the layer directly below by this layer's alpha: where the matte is clear, the canvas from before that layer shows.
- Image masks use the luminance of the image. Polygon masks keep the first 48 points.
- Unknown effect kinds, unknown shader ids and `ndi`/`camera` sources are skipped with one warning.
- Blur radius is in canvas pixels. Colour and key adjustments work on sRGB values, like the editor sliders.

### Desktop commands

- `preview_render_composition { composition, screen?, width, height }` returns the same binary layout as `preview_render`. The layout JSON is a `CompositionPreviewResult`: `bounds` (one per drawn layer with `elementId: null`, one per slide element) and `textRuns`, keyed by `layerId`, `sourceId` and `elementId`, normalized to the screen output before mapping (or to the canvas when `screen` is omitted).
- `apply_composition { composition, screens, transition? }` drives one native output per enabled `display` screen. It matches the monitor by name and position, opens the output if needed and returns `{ screenId, label, error }` per screen. `transition` is `{ kind, durationMs, easing }` and defaults to a cut.
- Composition videos decode under the same per-caller demand as scene video layers. The v1 commands are unchanged; an output shows the last scene or composition it received.

### Transitions as implemented

- A layer whose `sourceId` changes crossfades from the old source over `transition.durationMs` with `transition.easing`. A cut or zero duration switches at once.
- A `slide` source whose `revision` changes runs `transition.kind` (`fade`, `dissolve`, `slide`, `zoom`) between the old and new slide textures. Fades go through transparent, not black. The v1 `TransitionPlan` with full scenes is not used for v2.

## Migration from v1

`sceneToComposition(scene)` in `packages/core` converts a v1 `Scene`:

- `background` becomes layer 0 with a `solid`, `image` or `video` source.
- v1 `layers` become one `slide` source on a layer tagged `content`, or `lyrics` for songs.
- `role: audience` becomes the default audience screen. `role: stage` becomes a stage screen.

Rust still renders v1 scenes for the existing commands. The compositor renders v2 directly. When the studio moves to `apply_composition`, `Scene` v1 is read only for import and old saved timelines.
