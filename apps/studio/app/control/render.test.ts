import type { Frame } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import {
  boundsForElement,
  decodeCompositionPreviewResponse,
  elementLayout,
  hitTestBounds,
  moveFrame,
  normalizePoint,
  snapFrame,
  type ElementBounds,
} from './render'

function payload(options: {
  width?: number
  height?: number
  layout?: unknown
  rgba?: number[]
  layoutLength?: number
}): Uint8Array {
  const width = options.width ?? 2
  const height = options.height ?? 1
  const layout = new TextEncoder().encode(
    JSON.stringify(options.layout ?? { revision: 1, bounds: [], textRuns: [] }),
  )
  const layoutLength = options.layoutLength ?? layout.length
  const rgba = options.rgba ?? [255, 0, 0, 255, 0, 255, 0, 255]
  const bytes = new Uint8Array(12 + layout.length + rgba.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, width, true)
  view.setUint32(4, height, true)
  view.setUint32(8, layoutLength, true)
  bytes.set(layout, 12)
  bytes.set(rgba, 12 + layout.length)
  return bytes
}

function bounds(overrides: Partial<ElementBounds> & { elementId: string }): ElementBounds {
  return { x: 0, y: 0, width: 1, height: 1, ...overrides }
}

function frame(overrides: Partial<Frame> = {}): Frame {
  return { x: 0, y: 0, w: 0.2, h: 0.2, rotation: 0, ...overrides }
}

describe('decodeCompositionPreviewResponse', () => {
  it('reads layer and element bounds keyed by layer, source and element', () => {
    const layout = {
      revision: 3,
      bounds: [
        { layerId: 'bg', sourceId: 'solid', elementId: null, x: 0, y: 0, width: 1, height: 1 },
        { layerId: 'lyrics', sourceId: 'slide', elementId: 'title', x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
      ],
      textRuns: [
        { layerId: 'lyrics', sourceId: 'slide', elementId: 'title', line: 0, text: 'Hi', x: 0.1, y: 0.7, width: 0.2, height: 0.1, caretStops: [0.1, 0.2] },
      ],
    }
    const decoded = decodeCompositionPreviewResponse(payload({ layout }))
    expect(decoded.width).toBe(2)
    expect(decoded.layout.revision).toBe(3)
    expect(decoded.layout.bounds.map((entry) => [entry.layerId, entry.elementId])).toEqual([
      ['bg', null],
      ['lyrics', 'title'],
    ])
    expect(decoded.layout.textRuns[0]).toMatchObject({ layerId: 'lyrics', text: 'Hi' })
    expect(Array.from(decoded.rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('accepts an ArrayBuffer and an ArrayBuffer view', () => {
    const bytes = payload({})
    expect(decodeCompositionPreviewResponse(bytes.buffer as ArrayBuffer).width).toBe(2)
    expect(decodeCompositionPreviewResponse(bytes).width).toBe(2)
  })

  it('rejects layouts without layer ids and bad payloads', () => {
    const bare = { revision: 1, bounds: [{ elementId: 'a', x: 0, y: 0, width: 1, height: 1 }], textRuns: [] }
    expect(() => decodeCompositionPreviewResponse(payload({ layout: bare }))).toThrow()
    expect(() => decodeCompositionPreviewResponse(payload({ layoutLength: 9999 }))).toThrow(/layout length/i)
    expect(() => decodeCompositionPreviewResponse(new Uint8Array(4))).toThrow(/truncated/i)
    expect(() => decodeCompositionPreviewResponse(payload({ rgba: [1, 2, 3] }))).toThrow(/RGBA bytes/i)
  })
})

describe('elementLayout', () => {
  it('keys slide elements by element id and video layers by layer id', () => {
    const layout = elementLayout({
      revision: 1,
      bounds: [
        { layerId: 'slide-background', sourceId: 'slide-background', elementId: null, x: 0, y: 0, width: 1, height: 1 },
        { layerId: 'slide-content-0', sourceId: 'slide-content-0', elementId: null, x: 0, y: 0, width: 1, height: 1 },
        { layerId: 'slide-content-0', sourceId: 'slide-content-0', elementId: 'title', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        { layerId: 'clip', sourceId: 'video-clip', elementId: null, x: 0.5, y: 0.5, width: 0.25, height: 0.25 },
      ],
      textRuns: [],
    })
    expect(layout.bounds.map((entry) => entry.elementId)).toEqual(['slide-background', 'title', 'clip'])
    expect(layout.bounds[1]).toEqual({ elementId: 'title', x: 0.1, y: 0.2, width: 0.3, height: 0.4 })
  })

  it('keeps text runs in canvas space with y at the line top', () => {
    // Rust reports each line box as top-left + size, normalized to the canvas (not the element
    // frame); the editor overlay draws it as-is, so it must sit inside the element bounds.
    const run = { layerId: 'slide-content-0', sourceId: 'slide-content-0', elementId: 'title', line: 0, text: 'Hello', x: 0.42, y: 0.46, width: 0.16, height: 0.07, caretStops: [0.42, 0.58] }
    const layout = elementLayout({
      revision: 1,
      bounds: [{ layerId: 'slide-content-0', sourceId: 'slide-content-0', elementId: 'title', x: 0.1, y: 0.16, width: 0.8, height: 0.68 }],
      textRuns: [run],
    })
    expect(layout.textRuns).toEqual([run])
    const [box] = layout.bounds
    expect(run.y).toBeGreaterThanOrEqual(box!.y)
    expect(run.y + run.height).toBeLessThanOrEqual(box!.y + box!.height)
  })
})

describe('normalizePoint', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }

  it('maps client space into the unit square', () => {
    expect(normalizePoint(200, 100, rect)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('clamps points outside the slide', () => {
    expect(normalizePoint(0, 0, rect)).toEqual({ x: 0, y: 0 })
    expect(normalizePoint(500, 500, rect)).toEqual({ x: 1, y: 1 })
  })

  it('returns origin for a zero-size rect', () => {
    expect(normalizePoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
    })
  })
})

describe('hitTestBounds', () => {
  const layout = [
    bounds({ elementId: 'low', x: 0.1, y: 0.1, width: 0.5, height: 0.5 }),
    bounds({ elementId: 'high', x: 0.2, y: 0.2, width: 0.2, height: 0.2 }),
  ]

  it('returns the topmost layer for overlapping bounds', () => {
    expect(hitTestBounds(layout, { x: 0.25, y: 0.25 }, ['low', 'high'])).toBe('high')
    expect(hitTestBounds(layout, { x: 0.5, y: 0.5 }, ['low', 'high'])).toBe('low')
  })

  it('ignores layers that are not in the z order', () => {
    expect(hitTestBounds(layout, { x: 0.5, y: 0.5 }, ['high'])).toBeNull()
    expect(hitTestBounds(layout, { x: 0.9, y: 0.9 }, ['low', 'high'])).toBeNull()
  })

  it('finds bounds by element id', () => {
    expect(boundsForElement(layout, 'high')?.x).toBe(0.2)
    expect(boundsForElement(layout, 'missing')).toBeNull()
  })
})

describe('moveFrame', () => {
  it('moves a frame by a normalized delta', () => {
    expect(moveFrame(frame({ x: 0.2, y: 0.3 }), 0.1, -0.1)).toMatchObject({
      x: 0.30000000000000004,
      y: 0.19999999999999998,
    })
  })

  it('clamps the frame inside the slide', () => {
    expect(moveFrame(frame({ x: 0.1, y: 0.1 }), -0.5, -0.5)).toMatchObject({ x: 0, y: 0 })
    expect(moveFrame(frame({ x: 0.7, y: 0.7 }), 0.5, 0.5)).toMatchObject({ x: 0.8, y: 0.8 })
  })
})

describe('snapFrame', () => {
  it('snaps an edge to the slide center and reports the guide', () => {
    const result = snapFrame(
      frame({ x: 0.44, y: 0.2, w: 0.1, h: 0.1 }),
      [],
      0.02,
    )
    expect(result.frame.x).toBeCloseTo(0.45)
    expect(result.guides).toEqual([{ axis: 'x', position: 0.5 }])
  })

  it('snaps to another layer edge', () => {
    const other = bounds({ elementId: 'other', x: 0.6, y: 0.8, width: 0.2, height: 0.1 })
    const result = snapFrame(frame({ x: 0.58, y: 0.2, w: 0.1, h: 0.1 }), [other], 0.03)
    expect(result.frame.x).toBeCloseTo(0.6)
    expect(result.guides).toContainEqual({ axis: 'x', position: 0.6 })
  })

  it('leaves a frame alone outside the threshold', () => {
    const result = snapFrame(frame({ x: 0.6, y: 0.2, w: 0.1, h: 0.1 }), [], 0.02)
    expect(result.frame.x).toBe(0.6)
    expect(result.guides).toEqual([])
  })
})
