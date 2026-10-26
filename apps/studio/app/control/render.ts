import { invoke } from '@tauri-apps/api/core'
import { previewResultSchema, type Frame, type PreviewBounds, type PreviewResult, type Scene } from '@lumen/schema'

/** A rendered preview frame plus the layout data returned by the same Rust shaping pass. */
export interface DecodedPreview {
  width: number
  height: number
  layout: PreviewResult
  /** Raw row-major RGBA bytes, `width * height * 4` long. */
  rgba: Uint8Array
}

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
 * Decodes the binary IPC layout documented on `preview_render`:
 * `width: u32 le`, `height: u32 le`, `layoutLength: u32 le`, UTF-8 `PreviewResult`
 * JSON, then raw row-major RGBA.
 */
export function decodePreviewResponse(payload: PreviewPayload): DecodedPreview {
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
    layout: previewResultSchema.parse(parsed),
    rgba: rgba.subarray(0, expected),
  }
}

/** Renders a scene offscreen through the native renderer. */
export async function previewRender(
  scene: Scene,
  width: number,
  height: number,
): Promise<DecodedPreview> {
  const payload = await invoke<PreviewPayload>('preview_render', { scene, width, height })
  return decodePreviewResponse(payload)
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
  bounds: PreviewBounds[],
  elementId: string,
): PreviewBounds | null {
  return bounds.find((entry) => entry.elementId === elementId) ?? null
}

/**
 * Returns the topmost layer under a point. `order` is bottom-to-top, matching
 * `orderedElements`; the background is never hit.
 */
export function hitTestBounds(
  bounds: PreviewBounds[],
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

function axisTargets(bounds: PreviewBounds[], axis: 'x' | 'y'): number[] {
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
  others: PreviewBounds[],
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
