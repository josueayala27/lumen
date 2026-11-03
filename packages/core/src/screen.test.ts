import { describe, expect, it } from 'vitest'
import { identityCornerPin, meshForCornerPin, quadPoint, quadUv, rebaseMesh, resampleMesh, type CornerPin } from './screen'

describe('corner pin and mesh helpers', () => {
  it('interpolates inside a quad', () => {
    const pin = identityCornerPin()
    expect(quadPoint(pin, 0.25, 0.75)).toEqual({ x: 0.25, y: 0.75 })
    const skewed = [
      { x: 0.1, y: 0 },
      { x: 0.9, y: 0.1 },
      { x: 1, y: 1 },
      { x: 0, y: 0.9 },
    ]
    expect(quadPoint(skewed, 0, 0)).toEqual({ x: 0.1, y: 0 })
    expect(quadPoint(skewed, 1, 1)).toEqual({ x: 1, y: 1 })
    const centre = quadPoint(skewed, 0.5, 0.5)
    expect(centre.x).toBeCloseTo(0.5)
    expect(centre.y).toBeCloseTo(0.5)
  })

  it('spreads a mesh over the corner pin, row-major', () => {
    const mesh = meshForCornerPin(3, 2)
    expect(mesh.cols).toBe(3)
    expect(mesh.rows).toBe(2)
    expect(mesh.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 0.5, y: 1 },
      { x: 1, y: 1 },
    ])
    expect(meshForCornerPin(1, 0).points).toHaveLength(4)
  })

  it('resamples a mesh and keeps its shape', () => {
    const pin = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 0.9 },
    ]
    const coarse = meshForCornerPin(2, 2, pin)
    const fine = resampleMesh(coarse, 5, 3)
    expect(fine.points).toHaveLength(15)
    expect(fine.points[0]).toEqual(pin[0])
    expect(fine.points[14]).toEqual(pin[2])
    const centre = fine.points[1 * 5 + 2]!
    const expected = quadPoint(pin, 0.5, 0.5)
    expect(centre.x).toBeCloseTo(expected.x)
    expect(centre.y).toBeCloseTo(expected.y)
    expect(resampleMesh(coarse, 2, 2)).toBe(coarse)
  })

  it('inverts quadPoint and rebases a mesh onto a new pin', () => {
    const pin: CornerPin = [{ x: 0.2, y: 0.1 }, { x: 0.85, y: 0.05 }, { x: 0.95, y: 0.9 }, { x: 0.05, y: 0.8 }]
    for (const [u, v] of [[0, 0], [0.3, 0.7], [1, 1], [0.5, 0.25]] as const) {
      const back = quadUv(pin, quadPoint(pin, u, v))
      expect(back.u).toBeCloseTo(u, 9)
      expect(back.v).toBeCloseTo(v, 9)
    }
    const mesh = meshForCornerPin(4, 3)
    const moved = rebaseMesh(mesh, null, pin)
    expect(moved).toMatchObject({ cols: 4, rows: 3 })
    moved.points.forEach((point, index) => {
      const expected = meshForCornerPin(4, 3, pin).points[index]!
      expect(point.x).toBeCloseTo(expected.x, 9)
      expect(point.y).toBeCloseTo(expected.y, 9)
    })
  })
})
