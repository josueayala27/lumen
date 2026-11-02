import { invoke } from '@tauri-apps/api/core'
import {
  compositionPreviewResultSchema,
  type Composition,
  type CompositionPreviewResult,
  type CompositionTextRun,
  type Frame,
  type Screen,
} from '@lumen/schema'

/** Editor box of one slide element (or video element layer), normalized to the slide. */
export interface ElementBounds {
  elementId: string
  x: number
  y: number
  width: number
  height: number
}

/** One shaped text line of a slide element, normalized to the slide. */
export type ElementTextRun = CompositionTextRun

/** A rendered preview frame plus the layout data returned by the same Rust shaping pass. */
export interface DecodedFrame<Layout> {
  width: number
  height: number
  layout: Layout
  /** Raw row-major RGBA bytes, `width * height * 4` long. */
  rgba: Uint8Array
}

/** A composition preview frame (`preview_render_composition`). */
export type DecodedCompositionPreview = DecodedFrame<CompositionPreviewResult>

export interface NormalizedPoint {
  x: number
  y: number
}

export interface SnapGuide {
  axis: 'x' | 'y'
  /** Normalized slide coordinate of the guide line. */
  position: number
}

export interface SnapResult {
  frame: Frame
  guides: SnapGuide[]
}

type PreviewPayload = ArrayBuffer | ArrayBufferView | number[]

/** True inside a Tauri webview, false in the browser (and in tests). */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function payloadBytes(payload: PreviewPayload): Uint8Array {
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
  if (Array.isArray(payload)) return Uint8Array.from(payload)
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
}

/**
 * Decodes the binary IPC layout of `preview_render_composition`: `width: u32 le`, `height: u32 le`,
 * `layoutLength: u32 le`, UTF-8 layout JSON, then raw row-major RGBA.
 */
function decodeFrame<Layout>(payload: PreviewPayload, parse: (value: unknown) => Layout): DecodedFrame<Layout> {
  const bytes = payloadBytes(payload)
  if (bytes.length < 12) throw new Error('Preview payload is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(0, true)
  const height = view.getUint32(4, true)
  const layoutLength = view.getUint32(8, true)
  const layoutEnd = 12 + layoutLength
  if (layoutEnd > bytes.length) throw new Error('Preview layout length exceeds payload')
  if (width === 0 || height === 0) throw new Error('Preview payload has no pixels')

  const expected = width * height * 4
  const rgba = bytes.subarray(layoutEnd)
  if (rgba.length < expected) {
    throw new Error(`Preview payload has ${rgba.length} RGBA bytes, expected ${expected}`)
  }

  const json = new TextDecoder().decode(bytes.subarray(12, layoutEnd))
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Preview layout is not valid JSON')
  }

  return {
    width,
    height,
    layout: parse(parsed),
    rgba: rgba.subarray(0, expected),
  }
}

/** Decodes a `preview_render_composition` payload with its `CompositionPreviewResult` layout. */
export function decodeCompositionPreviewResponse(payload: PreviewPayload): DecodedCompositionPreview {
  return decodeFrame(payload, (value) => compositionPreviewResultSchema.parse(value))
}

/**
 * Native preview renders share one Rust renderer behind a lock, so running
 * many at once only queues IPC payloads. At most this many are in flight;
 * the rest wait their turn (many screen thumbnails, Preview and Program).
 */
const MAX_PREVIEW_RENDERS = 2
let previewsInFlight = 0
const previewQueue: (() => void)[] = []

async function limitPreview<T>(run: () => Promise<T>): Promise<T> {
  // A finishing render hands its slot straight to the next waiter.
  if (previewsInFlight >= MAX_PREVIEW_RENDERS) await new Promise<void>((resolve) => previewQueue.push(resolve))
  else previewsInFlight += 1
  try {
    return await run()
  } finally {
    const next = previewQueue.shift()
    if (next) next()
    else previewsInFlight -= 1
  }
}

/**
 * Renders a composition offscreen through the v2 compositor: one screen with
 * its layout, mapping, test pattern and blackout, or the bare canvas when
 * `screen` is null. Bounds and text runs are normalized to the screen output
 * before mapping (or to the canvas).
 */
export async function previewRenderComposition(
  composition: Composition,
  screen: Screen | null,
  width: number,
  height: number,
): Promise<DecodedCompositionPreview> {
  const payload = await limitPreview(() =>
    invoke<PreviewPayload>('preview_render_composition', {
      composition,
      screen,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }),
  )
  return decodeCompositionPreviewResponse(payload)
}

/**
 * Element boxes and text runs of a slide composition (`slideComposition` in
 * `@lumen/core`): slide elements by `elementId`, and layers drawn without an
 * element (video elements, a video background) by their layer id, which is
 * the element id. Full-canvas slide layers (`isContentLayer`) are left out.
 */
export function elementLayout(
  layout: CompositionPreviewResult,
  isContentLayer: (layerId: string) => boolean = (layerId) => layerId.startsWith('slide-content-'),
): { bounds: ElementBounds[]; textRuns: ElementTextRun[] } {
  const bounds: ElementBounds[] = []
  for (const entry of layout.bounds) {
    const elementId = entry.elementId ?? (isContentLayer(entry.layerId) ? null : entry.layerId)
    if (elementId === null) continue
    bounds.push({ elementId, x: entry.x, y: entry.y, width: entry.width, height: entry.height })
  }
  return { bounds, textRuns: layout.textRuns }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Converts a client-space point into normalized slide coordinates. */
export function normalizePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): NormalizedPoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  }
}

export function boundsForElement(
  bounds: ElementBounds[],
  elementId: string,
): ElementBounds | null {
  return bounds.find((entry) => entry.elementId === elementId) ?? null
}

/**
 * Returns the topmost layer under a point. `order` is bottom-to-top, matching
 * `orderedElements`; the background is never hit.
 */
export function hitTestBounds(
  bounds: ElementBounds[],
  point: NormalizedPoint,
  order: string[],
): string | null {
  const byId = new Map(bounds.map((entry) => [entry.elementId, entry]))
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index]
    if (!id) continue
    const entry = byId.get(id)
    if (!entry) continue
    if (
      point.x >= entry.x &&
      point.x <= entry.x + entry.width &&
      point.y >= entry.y &&
      point.y <= entry.y + entry.height
    ) {
      return id
    }
  }
  return null
}

/** Clamps a frame inside the slide without changing its size. */
export function moveFrame(frame: Frame, dx: number, dy: number): Frame {
  const x = Math.min(Math.max(0, frame.x + dx), Math.max(0, 1 - frame.w))
  const y = Math.min(Math.max(0, frame.y + dy), Math.max(0, 1 - frame.h))
  return { ...frame, x, y }
}

function snapAxis(
  candidates: number[],
  targets: number[],
  threshold: number,
): { delta: number; guide: number } | null {
  let best: { delta: number; guide: number } | null = null
  for (const candidate of candidates) {
    for (const target of targets) {
      const delta = target - candidate
      if (Math.abs(delta) > threshold) continue
      if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, guide: target }
      }
    }
  }
  return best
}

function axisTargets(bounds: ElementBounds[], axis: 'x' | 'y'): number[] {
  const targets = [0, 0.5, 1]
  for (const entry of bounds) {
    if (axis === 'x') {
      targets.push(entry.x, entry.x + entry.width / 2, entry.x + entry.width)
    } else {
      targets.push(entry.y, entry.y + entry.height / 2, entry.y + entry.height)
    }
  }
  return targets
}

/**
 * Snaps a moved frame to slide and layer edges/centers. Returns the adjusted
 * frame plus the normalized guide positions to draw. `others` are the bounds of
 * every layer except the one being dragged.
 */
export function snapFrame(
  frame: Frame,
  others: ElementBounds[],
  threshold = 0.008,
): SnapResult {
  const x = snapAxis(
    [frame.x, frame.x + frame.w / 2, frame.x + frame.w],
    axisTargets(others, 'x'),
    threshold,
  )
  const y = snapAxis(
    [frame.y, frame.y + frame.h / 2, frame.y + frame.h],
    axisTargets(others, 'y'),
    threshold,
  )

  const guides: SnapGuide[] = []
  if (x) guides.push({ axis: 'x', position: x.guide })
  if (y) guides.push({ axis: 'y', position: y.guide })

  return {
    frame: moveFrame(frame, x?.delta ?? 0, y?.delta ?? 0),
    guides,
  }
}
