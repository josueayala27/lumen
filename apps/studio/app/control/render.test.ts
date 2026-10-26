import type { Frame } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import {
  boundsForElement,
  decodePreviewResponse,
  hitTestBounds,
  moveFrame,
  normalizePoint,
  snapFrame,
  type PreviewBounds,
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

function bounds(overrides: Partial<PreviewBounds> & { elementId: string }): PreviewBounds {
  return { x: 0, y: 0, width: 1, height: 1, ...overrides }
}

function frame(overrides: Partial<Frame> = {}): Frame {
  return { x: 0, y: 0, w: 0.2, h: 0.2, rotation: 0, ...overrides }
}

describe('decodePreviewResponse', () => {
  it('reads dimensions, layout and RGBA from the binary payload', () => {
    const layout = {
      revision: 7,
      bounds: [bounds({ elementId: 'a', x: 0.1, y: 0.2, width: 0.3, height: 0.4 })],
      textRuns: [
        {
          elementId: 'a',
          line: 0,
          text: 'Hi',
          x: 0.1,
          y: 0.2,
          width: 0.2,
          height: 0.1,
          caretStops: [0.1, 0.2],
        },
      ],
    }
    const decoded = decodePreviewResponse(payload({ layout }))
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect(decoded.layout.revision).toBe(7)
    expect(decoded.layout.bounds[0]?.elementId).toBe('a')
    expect(decoded.layout.textRuns[0]?.text).toBe('Hi')
    expect(Array.from(decoded.rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('accepts an ArrayBuffer and an ArrayBuffer view', () => {
    const bytes = payload({})
    expect(decodePreviewResponse(bytes.buffer as ArrayBuffer).width).toBe(2)
    expect(decodePreviewResponse(bytes).width).toBe(2)
  })

  it('rejects truncated payloads and layout length overruns', () => {
    expect(() => decodePreviewResponse(new Uint8Array(4))).toThrow(/truncated/i)
    expect(() => decodePreviewResponse(payload({ layoutLength: 9999 }))).toThrow(/layout length/i)
    expect(() => decodePreviewResponse(payload({ rgba: [1, 2, 3] }))).toThrow(/RGBA bytes/i)
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
