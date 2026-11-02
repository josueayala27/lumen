import { newId } from '@lumen/core'
import {
  EFFECT_CATALOG,
  SHADER_IDS,
  type EffectKind,
  type EffectParamSpec,
  type GradientSource,
  type Layer,
  type LayerTransform,
  type Mask,
  type ParamValue,
  type Source,
} from '@lumen/schema'

/**
 * Pure logic for the Compose workspace: transform handle maths, typed
 * parameter coercion, built-in generator catalog and source factories.
 */

// --- Transform handles -------------------------------------------------------

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export type TransformHandle = 'move' | ResizeHandle

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Smallest layer size a handle drag can produce, normalized to the canvas. */
export const MIN_LAYER_SIZE = 0.01
/** Snap distance for canvas edges and centre, normalized to the canvas. */
export const SNAP_DISTANCE = 0.01

export interface TransformDragOptions {
  /** Keep the start width/height ratio (corner handles only). */
  keepAspect?: boolean
  /** Resize around the centre instead of the opposite edge. */
  fromCenter?: boolean
  /** Snap edges and centre to the canvas edges and centre; 0 disables. */
  snap?: number
}

const SNAP_TARGETS = [0, 0.5, 1]

/** Offset that moves the closest of `points` onto a snap target, or 0. */
function snapOffset(points: number[], distance: number): number {
  let best = 0
  let bestDistance = distance
  for (const point of points) {
    for (const target of SNAP_TARGETS) {
      const gap = Math.abs(target - point)
      if (gap <= bestDistance) {
        bestDistance = gap
        best = target - point
      }
    }
  }
  return best
}

function snapPoint(value: number, distance: number): number {
  return value + snapOffset([value], distance)
}

/**
 * The transform after dragging `handle` by (`dx`, `dy`), both normalized to the
 * canvas. Resizing works in canvas axes (rotation is edited numerically) and a
 * handle dragged past the opposite edge stops at `MIN_LAYER_SIZE`.
 */
export function dragTransform(
  start: LayerTransform,
  handle: TransformHandle,
  dx: number,
  dy: number,
  options: TransformDragOptions = {},
): LayerTransform {
  const snap = options.snap ?? 0
  if (handle === 'move') {
    let x = start.x + dx
    let y = start.y + dy
    if (snap > 0) {
      x += snapOffset([x, x + start.w / 2, x + start.w], snap)
      y += snapOffset([y, y + start.h / 2, y + start.h], snap)
    }
    return { ...start, x, y }
  }

  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')
  const factor = options.fromCenter ? 2 : 1

  let left = start.x
  let right = start.x + start.w
  let top = start.y
  let bottom = start.y + start.h
  if (west) left = snap > 0 ? snapPoint(left + dx, snap) : left + dx
  if (east) right = snap > 0 ? snapPoint(right + dx, snap) : right + dx
  if (north) top = snap > 0 ? snapPoint(top + dy, snap) : top + dy
  if (south) bottom = snap > 0 ? snapPoint(bottom + dy, snap) : bottom + dy

  let w = west || east ? Math.max(MIN_LAYER_SIZE, start.w + (east ? right - start.x - start.w : start.x - left) * factor) : start.w
  let h = north || south ? Math.max(MIN_LAYER_SIZE, start.h + (south ? bottom - start.y - start.h : start.y - top) * factor) : start.h

  const corner = (west || east) && (north || south)
  if (corner && options.keepAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h
    if (w / start.w >= h / start.h) h = Math.max(MIN_LAYER_SIZE, w / ratio)
    else w = Math.max(MIN_LAYER_SIZE, h * ratio)
  }

  let x: number
  let y: number
  if (options.fromCenter) {
    x = start.x + (start.w - w) / 2
    y = start.y + (start.h - h) / 2
  } else {
    x = west ? start.x + start.w - w : start.x
    y = north ? start.y + start.h - h : start.y
  }
  return { ...start, x, y, w, h }
}

/** Converts a pixel delta on the preview into a normalized canvas delta. */
export function normalizedDelta(dxPx: number, dyPx: number, rect: { width: number; height: number }): { dx: number; dy: number } {
  return {
    dx: rect.width > 0 ? dxPx / rect.width : 0,
    dy: rect.height > 0 ? dyPx / rect.height : 0,
  }
}

/** Rounds every transform field so stored values stay readable. */
export function roundTransform(transform: LayerTransform, decimals = 4): LayerTransform {
  const factor = 10 ** decimals
  const round = (value: number) => Math.round(value * factor) / factor
  return {
    x: round(transform.x),
    y: round(transform.y),
    w: round(transform.w),
    h: round(transform.h),
    rotation: round(transform.rotation),
    anchorX: round(transform.anchorX),
    anchorY: round(transform.anchorY),
  }
}

/** Absolute CSS placement for a layer box over the preview. */
export function transformStyle(transform: LayerTransform): Record<string, string> {
  return {
    left: `${transform.x * 100}%`,
    top: `${transform.y * 100}%`,
    width: `${transform.w * 100}%`,
    height: `${transform.h * 100}%`,
    transform: transform.rotation ? `rotate(${transform.rotation}deg)` : 'none',
  }
}

// --- Typed parameters --------------------------------------------------------

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function roundToStep(value: number, min: number, step: number): number {
  if (!(step > 0)) return value
  const steps = Math.round((value - min) / step)
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  return Number((min + steps * step).toFixed(Math.min(decimals, 10)))
}

/**
 * Coerces any input to a valid value for a parameter spec: numbers are parsed,
 * clamped and snapped to the step; colours must be hex; enums must be listed.
 * Anything else falls back to the spec default.
 */
export function coerceParam(spec: EffectParamSpec, value: unknown): ParamValue {
  switch (spec.type) {
    case 'number': {
      const parsed = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN
      if (!Number.isFinite(parsed)) return spec.default
      const clamped = Math.min(spec.max, Math.max(spec.min, parsed))
      return Math.min(spec.max, Math.max(spec.min, roundToStep(clamped, spec.min, spec.step)))
    }
    case 'color':
      return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : spec.default
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      return spec.default
    case 'enum':
      return typeof value === 'string' && spec.options.includes(value) ? value : spec.default
  }
}

export interface ParamEntry {
  spec: EffectParamSpec
  value: ParamValue
}

/** Every parameter of a spec list with its current value, coerced and defaulted. */
export function paramEntries(specs: readonly EffectParamSpec[], params: Readonly<Record<string, ParamValue>>): ParamEntry[] {
  return specs.map((spec) => ({ spec, value: coerceParam(spec, params[spec.name]) }))
}

export function effectParamEntries(kind: EffectKind, params: Readonly<Record<string, ParamValue>>): ParamEntry[] {
  return paramEntries(EFFECT_CATALOG[kind].params, params)
}

// --- Generators --------------------------------------------------------------

export type ShaderId = (typeof SHADER_IDS)[number]

/** What the Sources add menu can create without a picker. */
export type SourceAddKind = 'solid' | 'gradient' | `shader:${ShaderId}`

function num(name: string, label: string, min: number, max: number, value: number, step = 0.01): EffectParamSpec {
  return { name, label, type: 'number', min, max, step, default: value }
}

/** Built-in WGSL generators and their typed parameters. */
export const SHADER_CATALOG: Record<ShaderId, { label: string; params: readonly EffectParamSpec[] }> = {
  noise: {
    label: 'Noise',
    params: [
      num('scale', 'Scale', 0.1, 20, 4, 0.1),
      num('speed', 'Speed', 0, 5, 0.5),
      num('contrast', 'Contrast', 0, 2, 1),
      { name: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
    ],
  },
  plasma: {
    label: 'Plasma',
    params: [
      num('scale', 'Scale', 0.1, 10, 2, 0.1),
      num('speed', 'Speed', 0, 5, 1),
      { name: 'colorA', label: 'Colour A', type: 'color', default: '#ff2d95' },
      { name: 'colorB', label: 'Colour B', type: 'color', default: '#2d6bff' },
    ],
  },
  lines: {
    label: 'Lines',
    params: [
      num('count', 'Count', 1, 200, 24, 1),
      num('width', 'Width', 0, 1, 0.2),
      num('angle', 'Angle', -180, 180, 0, 1),
      num('speed', 'Speed', -5, 5, 0.5),
      { name: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
    ],
  },
}

export function isShaderId(value: string): value is ShaderId {
  return (SHADER_IDS as readonly string[]).includes(value)
}

/** Parameter specs for a shader; unknown ids have none. */
export function shaderParamSpecs(shaderId: string): readonly EffectParamSpec[] {
  return isShaderId(shaderId) ? SHADER_CATALOG[shaderId].params : []
}

export function defaultShaderParams(shaderId: string): Record<string, ParamValue> {
  return Object.fromEntries(shaderParamSpecs(shaderId).map((spec) => [spec.name, spec.default]))
}

// --- Sources -----------------------------------------------------------------

export function createSolidSource(color = '#1f6feb', id = newId('source')): Source {
  return { id, name: 'Solid', kind: 'solid', color }
}

export function createGradientSource(id = newId('source')): Source {
  return {
    id,
    name: 'Gradient',
    kind: 'gradient',
    gradient: 'linear',
    angle: 90,
    stops: [
      { at: 0, color: '#0b1020' },
      { at: 1, color: '#3b5bdb' },
    ],
  }
}

export function createShaderSource(shaderId: ShaderId, id = newId('source')): Source {
  return { id, name: SHADER_CATALOG[shaderId].label, kind: 'shader', shaderId, params: defaultShaderParams(shaderId) }
}

/** Media library row fields needed to build a source. */
export interface MediaLike {
  id: string
  kind: string
  name: string
  sha256: string
}

/** An image or video source for a media file; null for other kinds. */
export function createMediaSource(media: MediaLike, id = newId('source')): Source | null {
  const asset = { assetId: media.id, hash: media.sha256 }
  if (media.kind === 'image') return { id, name: media.name, kind: 'image', asset }
  if (media.kind !== 'video') return null
  return {
    id,
    name: media.name,
    kind: 'video',
    asset,
    loop: true,
    inMs: 0,
    outMs: null,
    rate: 1,
    reverse: false,
    muted: true,
    volume: 1,
  }
}

const SOURCE_KIND_LABELS: Record<Source['kind'], string> = {
  video: 'Video',
  image: 'Image',
  slide: 'Slide',
  solid: 'Solid',
  gradient: 'Gradient',
  shader: 'Generator',
  ndi: 'NDI',
  camera: 'Camera',
}

const SOURCE_KIND_ICONS: Record<Source['kind'], string> = {
  video: 'lucide:film',
  image: 'lucide:image',
  slide: 'lucide:type',
  solid: 'lucide:square',
  gradient: 'lucide:blend',
  shader: 'lucide:sparkles',
  ndi: 'lucide:radio',
  camera: 'lucide:video',
}

export function sourceKindLabel(source: Source): string {
  return SOURCE_KIND_LABELS[source.kind]
}

export function sourceIcon(source: Source): string {
  return SOURCE_KIND_ICONS[source.kind]
}

/** Display name: the source name, else the generator or kind label. */
export function sourceLabel(source: Source): string {
  if (source.name) return source.name
  if (source.kind === 'shader') return isShaderId(source.shaderId) ? SHADER_CATALOG[source.shaderId].label : source.shaderId
  return SOURCE_KIND_LABELS[source.kind]
}

/** CSS background approximating a source for the browser preview, or null. */
export function sourceCss(source: Source): string | null {
  switch (source.kind) {
    case 'solid':
      return source.color
    case 'gradient': {
      const stops = [...source.stops].sort((a, b) => a.at - b.at).map((stop) => `${stop.color} ${stop.at * 100}%`)
      return source.gradient === 'radial'
        ? `radial-gradient(circle, ${stops.join(', ')})`
        : `linear-gradient(${source.angle}deg, ${stops.join(', ')})`
    }
    case 'shader': {
      const params = source.params
      const color = (key: string, fallback: string) => (typeof params[key] === 'string' ? (params[key] as string) : fallback)
      if (source.shaderId === 'plasma') {
        return `radial-gradient(circle at 30% 30%, ${color('colorA', '#ff2d95')}, transparent 60%), radial-gradient(circle at 70% 70%, ${color('colorB', '#2d6bff')}, transparent 60%), #000000`
      }
      if (source.shaderId === 'lines') {
        const angle = typeof params.angle === 'number' ? params.angle : 0
        return `repeating-linear-gradient(${angle + 90}deg, ${color('color', '#ffffff')} 0 2px, #000000 2px 16px)`
      }
      return `repeating-conic-gradient(${color('color', '#ffffff')} 0 25%, #404040 0 50%) 0 0 / 8px 8px`
    }
    default:
      return null
  }
}

// --- Gradient stops ----------------------------------------------------------

export function updateGradientStop(
  source: GradientSource,
  index: number,
  patch: Partial<GradientSource['stops'][number]>,
): GradientSource['stops'] {
  return source.stops.map((stop, at) =>
    at === index ? { at: Math.min(1, Math.max(0, patch.at ?? stop.at)), color: patch.color ?? stop.color } : stop,
  )
}

/** Adds a stop halfway into the widest gap, using the colour on its left. */
export function addGradientStop(source: GradientSource): GradientSource['stops'] {
  const sorted = [...source.stops].sort((a, b) => a.at - b.at)
  let gapIndex = 0
  let gap = -1
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const size = sorted[index + 1]!.at - sorted[index]!.at
    if (size > gap) {
      gap = size
      gapIndex = index
    }
  }
  const left = sorted[gapIndex]!
  const at = Math.round((left.at + Math.max(0, gap) / 2) * 1000) / 1000
  return [...sorted.slice(0, gapIndex + 1), { at, color: left.color }, ...sorted.slice(gapIndex + 1)]
}

/** Removes a stop; a gradient keeps at least two. */
export function removeGradientStop(source: GradientSource, index: number): GradientSource['stops'] {
  if (source.stops.length <= 2) return source.stops
  return source.stops.filter((_, at) => at !== index)
}

// --- Layers ------------------------------------------------------------------

/** Display order for the layer list: top of the list is the top layer. */
export function layersTopFirst(layers: readonly Layer[]): Layer[] {
  return [...layers].reverse()
}

/** Converts an index in the top-first list into an index in the bottom-to-top stack. */
export function stackIndexFromDisplay(displayIndex: number, count: number): number {
  return Math.max(0, count - 1 - displayIndex)
}

/** Parses a comma or space separated tag list: trimmed, lowercased, unique. */
export function parseTags(text: string): string[] {
  const tags = text
    .split(/[,\s]+/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(tags)]
}

export type MaskKind = 'none' | Mask['kind']

/** A starting mask for each kind; image masks need an asset and return null without one. */
export function defaultMask(kind: MaskKind, asset?: { assetId: string; hash: string }): Mask | null {
  switch (kind) {
    case 'none':
      return null
    case 'rect':
      return { kind: 'rect', x: 0.1, y: 0.1, w: 0.8, h: 0.8, radius: 0, feather: 0, invert: false }
    case 'polygon':
      return {
        kind: 'polygon',
        points: [
          [0.5, 0.1],
          [0.9, 0.9],
          [0.1, 0.9],
        ],
        feather: 0,
        invert: false,
      }
    case 'image':
      return asset ? { kind: 'image', asset, invert: false } : null
  }
}
