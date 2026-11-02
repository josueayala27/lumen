# 10 — Screens, layouts and mapping

A screen is one output: a physical display, an NDI stream or a virtual screen. Each screen shows the composition from `02-render-contract.md` through its own **layout** and **mapping**. Content never knows which screen shows it.

- TypeScript: `packages/schema/src/screen.ts`.
- Rust: monitor and window code in `lumen-output`; layout and mapping passes in `lumen-render`.
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

## Tests

- TypeScript: layout layer filtering, region maths, text preset resolution.
- Rust unit tests: corner-pin and mesh maths, edge-blend ramp, region crop. No GPU tests in CI.
