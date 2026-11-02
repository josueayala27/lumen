import { describe, expect, it } from 'vitest'
import { identityCornerPin, meshForCornerPin, quadPoint, resampleMesh } from './screen'

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
})
