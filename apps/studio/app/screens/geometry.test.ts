import { describe, expect, it } from 'vitest'
import { clampRegion, dragPoint, dragRegion, meshLines, regionPixels, replacePoint, snapRegion, snapTargets } from './geometry'

describe('clampRegion', () => {
  it('keeps a region on the canvas and above the minimum size', () => {
    expect(clampRegion({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 })
    expect(clampRegion({ x: 0.5, y: 0.5, w: 0, h: 3 })).toEqual({ x: 0.5, y: 0, w: 0.02, h: 1 })
    expect(clampRegion({ x: Number.NaN, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('dragRegion', () => {
  const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }

  it('moves without resizing and stops at the canvas edge', () => {
    expect(dragRegion(start, 'move', 0.1, -0.1)).toEqual({ x: 0.3, y: 0.1, w: 0.4, h: 0.4 })
    expect(dragRegion(start, 'move', 0.9, -0.9)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 })
  })

  it('resizes only the grabbed edges', () => {
    expect(dragRegion(start, 'e', 0.1, 0.5)).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.4 })
    expect(dragRegion(start, 'nw', -0.1, -0.1)).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    expect(dragRegion(start, 's', 0, 1)).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.8 })
  })

  it('never collapses or flips a region', () => {
    expect(dragRegion(start, 'w', 1, 0)).toEqual({ x: 0.58, y: 0.2, w: 0.02, h: 0.4 })
    expect(dragRegion(start, 'n', 0, 1, 0.1)).toEqual({ x: 0.2, y: 0.5, w: 0.4, h: 0.1 })
  })
})

describe('snapRegion', () => {
  const targets = snapTargets([{ x: 0, y: 0, w: 0.5, h: 1 }])

  it('collects canvas edges, centre lines and other region edges', () => {
    expect(targets.x.sort()).toEqual([0, 0.5, 1])
    expect(snapTargets([{ x: 0.25, y: 0.1, w: 0.25, h: 0.3 }]).y.sort()).toEqual([0, 0.1, 0.4, 0.5, 1])
  })

  it('snaps the nearest moving edge when moving', () => {
    const result = snapRegion({ x: 0.506, y: 0.2, w: 0.4, h: 0.6 }, 'move', targets, 0.01)
    expect(result.region.x).toBe(0.5)
    expect(result.guides).toContainEqual({ axis: 'x', position: 0.5 })
    expect(result.region.y).toBe(0.2)
  })

  it('snaps the centre line when moving', () => {
    const result = snapRegion({ x: 0.296, y: 0.3, w: 0.4, h: 0.4 }, 'move', targets, 0.01)
    expect(result.region.x).toBeCloseTo(0.3)
    expect(result.guides).toContainEqual({ axis: 'x', position: 0.5 })
    expect(result.guides).toContainEqual({ axis: 'y', position: 0.5 })
  })

  it('snaps only grabbed edges when resizing', () => {
    const result = snapRegion({ x: 0.1, y: 0.2, w: 0.395, h: 0.3 }, 'e', targets, 0.01)
    expect(result.region).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.3 })
    expect(result.guides).toEqual([{ axis: 'x', position: 0.5 }])
  })

  it('leaves the region alone outside the threshold', () => {
    const region = { x: 0.13, y: 0.17, w: 0.2, h: 0.2 }
    expect(snapRegion(region, 'move', targets, 0.01)).toEqual({ region, guides: [] })
  })
})

describe('points and meshes', () => {
  it('drags a point within the allowed range', () => {
    expect(dragPoint({ x: 0.5, y: 0.5 }, 0.1, -0.2)).toEqual({ x: 0.6, y: 0.3 })
    expect(dragPoint({ x: 1, y: 0 }, 5, -5)).toEqual({ x: 1.5, y: -0.5 })
  })

  it('replaces one point immutably', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]
    const next = replacePoint(points, 1, { x: 0.9, y: 0.1 })
    expect(next).toEqual([
      { x: 0, y: 0 },
      { x: 0.9, y: 0.1 },
    ])
    expect(points[1]).toEqual({ x: 1, y: 0 })
    expect(replacePoint(points, 5, { x: 0, y: 0 })).toBe(points)
  })

  it('lists mesh rows then columns', () => {
    expect(meshLines(3, 2)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [0, 3],
      [1, 4],
      [2, 5],
    ])
  })

  it('measures a region in pixels', () => {
    expect(regionPixels({ x: 0, y: 0, w: 1 / 3, h: 1 }, { width: 5760, height: 1080 })).toEqual({ width: 1920, height: 1080 })
  })
})
