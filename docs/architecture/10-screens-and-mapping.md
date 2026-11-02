# 10 — Screens, layouts and mapping

A screen is one output: a physical display, an NDI stream or a virtual screen. Each screen shows the composition from `02-render-contract.md` through its own **layout** and **mapping**. Content never knows which screen shows it.

- TypeScript: `packages/schema/src/screen.ts`.
- Rust: monitor and window code in `lumen-output`; layout and mapping passes in `lumen-render` (`mapping.rs`, `screen.wgsl`).
- Roadmap: Wave B (B1 screen manager, B2 layouts, B3 mapping).

## Screen

```
Screen {
  id, name
  target:
    | { kind: 'display', ref: ScreenRef }   stable name + position, 05-desktop-output.md
    | { kind: 'ndi', name }                 later
    | { kind: 'virtual' }                   preview-only, for planning and tests
  size: { width, height }                   output pixels; display targets follow the monitor
  role: 'audience' | 'stage'
  enabled
  blackout
  testPattern: null | 'grid' | 'bars' | 'identify'
  layout: Layout
  mapping: Mapping
}
```

A show has any number of screens. Screen settings are saved with the show, not with the device. Display targets re-resolve after hotplug with the rules in `05-desktop-output.md`.

## Layout

```
Layout {
  layers: { mode: 'all' } | { mode: 'only', ids: string[], tags: string[] }
  region: { x, y, w, h }                    normalized canvas slice
  safeArea: { top, right, bottom, left }
  text: null | {
    preset: 'full' | 'lowerThird' | 'strip' | 'hidden'
    scale                                   multiplies font size
    color | null
  }
  background: Color | null                  drawn under the screen's layers
  stage: null | { show: ('current' | 'next' | 'notes' | 'clock' | 'timers' | 'message')[] }
}
```

- `layers` picks which composition layers this screen draws. Tags let one layout follow content: `{ tags: ['lyrics'] }` shows whatever layer carries lyrics.
- `region` is the slice of the canvas this screen shows. Three side-by-side projectors use three regions of one wide canvas.
- `text` re-lays out `slide` sources for this screen only. The same song shows full-screen lyrics on side screens and a one-line strip on the LED wall.
- `stage` makes this a stage or confidence screen. Stage screens render current and next slides as images for the stage webview.

## Mapping

Mapping runs after the layout, per screen, in this order:

```
Mapping {
  cornerPin: null | [tl, tr, br, bl]        each { x, y } normalized output
  mesh: null | { cols, rows, points: { x, y }[] }   bezier grid, row-major
  edgeBlend: null | { left, right, top, bottom: { width, gamma, power } }
  masks: Mask[]                             in output space
  color: { brightness, contrast, gamma, red, green, blue }
}
```

- Corner pin and mesh warp share one pass. The mesh refines the corner pin.
- Edge blend fades overlap zones for multi-projector screens. `width` is normalized; `gamma` and `power` shape the ramp.
- Masks hide parts of the output, for example to fit a non-rectangular surface.
- Colour correction matches projectors to each other.

## Pipeline per screen

1. Group screens by layer filter and text override. Each group renders the composition once.
2. Crop `region` and scale to `size`.
3. Draw `background` under the result if set.
4. Apply mapping: warp, edge blend, masks, colour.
5. Apply the screen state: `testPattern`, `blackout`, then the live mode (black, clear, freeze).
6. Present to the output surface.

## Editing

- The Screens workspace (`11-ui.md`) edits screens, layouts and mapping.
- Mapping handles show on the real output while editing, so the operator aligns to the physical surface.
- Every mapping parameter is a plain value on a stable path, such as `screens.<id>.mapping.color.brightness`. The command bus and DMX can drive them.

## Implementation (A2)

- `mapping.rs` holds the pure maths: layer filter, screen grouping, canvas render size, region crop, text preset re-layout, corner-pin homography, mesh interpolation, warp grid and edge-blend ramp.
- `Compositor::render_screens` groups screens by layer filter and text override. Presets placed in output space (`lowerThird`, `strip`) also group by region. Each group renders the canvas once, at the size its largest region needs.
- Text presets match the browser schematic (`apps/studio/app/show/schematic.ts`). Preset frames are mapped back into slide space, so text outside the layer box is clipped.
- The screen stage is one pass. Corner pin and mesh become a warped 32 × 32 grid; a mesh wins over the corner pin because its points already include the pin. Outside the warped surface is black.
- Edge blend runs on content coordinates. The ramp is a linear-light multiplier: with gamma 2.2 two overlapping projectors sum to one. `power` shapes the S-curve.
- Output masks hide the area they cover; `invert` keeps only that area. The pass takes up to 4 rect or polygon masks with up to 14 points each. Image masks are skipped for now.
- Colour correction works on sRGB values: brightness and contrast, then gamma, then the red, green and blue gains.
- Test patterns (`grid`, `bars`, `identify`) and blackout fill the whole output, unwarped. A disabled screen renders black.
- Each native output has its own render thread and wgpu device and renders only its own screen. Decoded video frames are shared between outputs; GPU textures are not.
- The studio renders the Screens output view and the Show outputs through this pass (`preview_render_composition` with the screen, `apply_composition`). The browser build shows an unmapped schematic drawn from the composition and screen. Stage layouts (`layout.stage`) are read by the stage window, which renders its slide images through the compositor; Rust does not lay out stage parts. Still not rendered: image output masks.

## Tests

- TypeScript: layout layer filtering, region maths, text preset resolution.
- Rust unit tests: corner-pin and mesh maths, edge-blend ramp, region crop, layer filter, grouping, text presets. No GPU tests in CI.
- Ignored GPU tests (`cargo test --release -p lumen-render -- --ignored`): blend modes, masks, mattes, region crop, corner pin, blackout, test patterns, grouped screens, crossfade, and preview against output pixels.
