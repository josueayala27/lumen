import type {
  Frame,
  Layer,
  Layout,
  LayoutText,
  Mapping,
  Mesh,
  Point,
  Region,
  Screen,
  ScreenRef,
  Size,
} from '@lumen/schema'
import { newId } from './presentation'

/** Default composition canvas and virtual screen size. */
export const DEFAULT_CANVAS: Size = { width: 1920, height: 1080 }
export const FULL_REGION: Region = { x: 0, y: 0, w: 1, h: 1 }
export const DEFAULT_LAYOUT_TEXT: LayoutText = { preset: 'full', scale: 1, color: null }

export function defaultLayout(): Layout {
  return {
    layers: { mode: 'all' },
    region: { ...FULL_REGION },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    text: { ...DEFAULT_LAYOUT_TEXT },
    background: null,
    stage: null,
  }
}

export function defaultMapping(): Mapping {
  return {
    cornerPin: null,
    mesh: null,
    edgeBlend: null,
    masks: [],
    color: { brightness: 0, contrast: 1, gamma: 1, red: 1, green: 1, blue: 1 },
  }
}

export interface ScreenInput {
  id?: string
  name?: string
  target?: Screen['target']
  size?: Size
  role?: Screen['role']
  layout?: Partial<Layout>
  mapping?: Partial<Mapping>
}

/** A new enabled screen; a virtual 1920×1080 audience screen by default. */
export function createScreen(input: ScreenInput = {}): Screen {
  const target = input.target ?? { kind: 'virtual' as const }
  const role = input.role ?? 'audience'
  const layout = { ...defaultLayout(), ...input.layout }
  if (role === 'stage' && !input.layout?.stage) layout.stage = { show: ['current', 'next', 'clock'] }
  return {
    id: input.id ?? newId('screen'),
    name: input.name ?? 'Screen',
    target,
    size: input.size ?? sizeForTarget(target),
    role,
    enabled: true,
    blackout: false,
    testPattern: null,
    layout,
    mapping: { ...defaultMapping(), ...input.mapping },
  }
}

/** Display targets follow the monitor; everything else defaults to the canvas size. */
export function sizeForTarget(target: Screen['target']): Size {
  if (target.kind === 'display' && target.ref.width > 0 && target.ref.height > 0) {
    return { width: target.ref.width, height: target.ref.height }
  }
  return { ...DEFAULT_CANVAS }
}

/** Points a screen at a monitor and follows its size. */
export function displayTarget(ref: ScreenRef): Screen['target'] {
  return { kind: 'display', ref: { ...ref } }
}

/** Whether a layout draws a layer: every layer, or a matching id or tag. */
export function layoutIncludesLayer(layout: Layout, layer: Pick<Layer, 'id' | 'tags'>): boolean {
  if (layout.layers.mode === 'all') return true
  const { ids, tags } = layout.layers
  return ids.includes(layer.id) || layer.tags.some((tag) => tags.includes(tag))
}

/** Layers a screen draws, bottom to top. */
export function layersForLayout<T extends Pick<Layer, 'id' | 'tags'>>(layout: Layout, layers: readonly T[]): T[] {
  return layers.filter((layer) => layoutIncludesLayer(layout, layer))
}

/** Text settings the layout applies to slide sources; `full` at 1× when unset. */
export function resolveLayoutText(layout: Layout): LayoutText {
  return layout.text ?? DEFAULT_LAYOUT_TEXT
}

/** Maps a canvas-normalized frame into a region's normalized space. */
export function frameInRegion<T extends Frame>(frame: T, region: Region): T {
  return {
    ...frame,
    x: (frame.x - region.x) / region.w,
    y: (frame.y - region.y) / region.h,
    w: frame.w / region.w,
    h: frame.h / region.h,
  }
}

/** Pixel size of a region of the canvas. */
export function regionSize(canvas: Size, region: Region): Size {
  return { width: canvas.width * region.w, height: canvas.height * region.h }
}

/**
 * Splits the canvas into `count` side-by-side regions, for projectors that
 * share one wide canvas. `overlap` is the normalized width shared by neighbours.
 */
export function sideBySideRegions(count: number, overlap = 0): Region[] {
  const n = Math.max(1, Math.round(count))
  const w = (1 + overlap * (n - 1)) / n
  return Array.from({ length: n }, (_, index) => ({ x: index * (w - overlap), y: 0, w, h: 1 }))
}

/** tl, tr, br, bl in normalized output space. */
export type CornerPin = [Point, Point, Point, Point]

/** A corner pin that leaves the output unwarped. */
export function identityCornerPin(): CornerPin {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]
}

/** Bilinear point inside a corner-pin quad at `(u, v)` in 0..1. */
export function quadPoint(pin: readonly Point[], u: number, v: number): Point {
  const [tl, tr, br, bl] = pin as CornerPin
  const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u }
  const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u }
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v }
}

/** A `cols × rows` mesh spread evenly over a corner pin, or over the full output. */
export function meshForCornerPin(cols: number, rows: number, pin: readonly Point[] | null = null): Mesh {
  const c = Math.max(2, Math.round(cols))
  const r = Math.max(2, Math.round(rows))
  const quad = pin ?? identityCornerPin()
  const points: Point[] = []
  for (let row = 0; row < r; row += 1) {
    for (let col = 0; col < c; col += 1) points.push(quadPoint(quad, col / (c - 1), row / (r - 1)))
  }
  return { cols: c, rows: r, points }
}

/** Mesh point at a fractional grid position, interpolated from its cell. */
function meshPointAt(mesh: Mesh, u: number, v: number): Point {
  const fx = u * (mesh.cols - 1)
  const fy = v * (mesh.rows - 1)
  const col = Math.min(mesh.cols - 2, Math.floor(fx))
  const row = Math.min(mesh.rows - 2, Math.floor(fy))
  const at = (c: number, r: number): Point => mesh.points[r * mesh.cols + c]!
  return quadPoint([at(col, row), at(col + 1, row), at(col + 1, row + 1), at(col, row + 1)], fx - col, fy - row)
}

/** Resamples a mesh to a new grid size, keeping its current shape. */
export function resampleMesh(mesh: Mesh, cols: number, rows: number): Mesh {
  const c = Math.max(2, Math.round(cols))
  const r = Math.max(2, Math.round(rows))
  if (c === mesh.cols && r === mesh.rows) return mesh
  const points: Point[] = []
  for (let row = 0; row < r; row += 1) {
    for (let col = 0; col < c; col += 1) points.push(meshPointAt(mesh, col / (c - 1), row / (r - 1)))
  }
  return { cols: c, rows: r, points }
}
