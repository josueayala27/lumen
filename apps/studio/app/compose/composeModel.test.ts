import { EFFECT_CATALOG, sourceSchema, type EffectParamSpec, type GradientSource, type LayerTransform } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import {
  MIN_LAYER_SIZE,
  addGradientStop,
  coerceParam,
  createGradientSource,
  createMediaSource,
  createShaderSource,
  createSolidSource,
  defaultMask,
  defaultShaderParams,
  dragTransform,
  effectParamEntries,
  layersTopFirst,
  normalizedDelta,
  parseTags,
  removeGradientStop,
  roundTransform,
  sourceCss,
  sourceLabel,
  stackIndexFromDisplay,
  transformStyle,
  updateGradientStop,
} from './composeModel'

const start: LayerTransform = { x: 0.2, y: 0.2, w: 0.4, h: 0.2, rotation: 0, anchorX: 0.5, anchorY: 0.5 }

function close(actual: LayerTransform, expected: Partial<LayerTransform>): void {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key as keyof LayerTransform]).toBeCloseTo(value as number, 6)
  }
}

describe('dragTransform', () => {
  it('moves without changing size', () => {
    close(dragTransform(start, 'move', 0.1, -0.05), { x: 0.3, y: 0.15, w: 0.4, h: 0.2 })
  })

  it('resizes from the east and south edges', () => {
    close(dragTransform(start, 'se', 0.1, 0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.3 })
    close(dragTransform(start, 'e', 0.1, 0.5), { x: 0.2, y: 0.2, w: 0.5, h: 0.2 })
  })

  it('keeps the opposite edge fixed when resizing from west and north', () => {
    close(dragTransform(start, 'nw', 0.1, 0.05), { x: 0.3, y: 0.25, w: 0.3, h: 0.15 })
    close(dragTransform(start, 'n', 0.3, -0.1), { x: 0.2, y: 0.1, w: 0.4, h: 0.3 })
  })

  it('stops at the minimum size instead of flipping', () => {
    const result = dragTransform(start, 'w', 0.9, 0)
    close(result, { w: MIN_LAYER_SIZE, x: 0.6 - MIN_LAYER_SIZE })
  })

  it('keeps the aspect ratio on corners when asked', () => {
    const result = dragTransform(start, 'se', 0.4, 0, { keepAspect: true })
    close(result, { w: 0.8, h: 0.4, x: 0.2, y: 0.2 })
  })

  it('resizes around the centre', () => {
    close(dragTransform(start, 'e', 0.1, 0, { fromCenter: true }), { x: 0.1, w: 0.6 })
  })

  it('snaps edges and centre to the canvas', () => {
    close(dragTransform(start, 'move', -0.195, 0, { snap: 0.01 }), { x: 0 })
    // Centre x = 0.2 + 0.105 + 0.2 = 0.505 → snaps to 0.5.
    close(dragTransform(start, 'move', 0.105, 0, { snap: 0.01 }), { x: 0.3 })
    close(dragTransform(start, 'se', 0.395, 0, { snap: 0.01 }), { w: 0.8 })
  })

  it('converts pixel deltas and rounds', () => {
    expect(normalizedDelta(96, 54, { width: 960, height: 540 })).toEqual({ dx: 0.1, dy: 0.1 })
    expect(normalizedDelta(5, 5, { width: 0, height: 0 })).toEqual({ dx: 0, dy: 0 })
    expect(roundTransform({ ...start, x: 0.123456789 }).x).toBe(0.1235)
  })

  it('builds a CSS box', () => {
    expect(transformStyle({ ...start, rotation: 15 })).toEqual({
      left: '20%',
      top: '20%',
      width: '40%',
      height: '20%',
      transform: 'rotate(15deg)',
    })
  })
})

describe('coerceParam', () => {
  const number: EffectParamSpec = { name: 'n', label: 'N', type: 'number', min: 0, max: 2, step: 0.1, default: 1 }

  it('parses, clamps and steps numbers', () => {
    expect(coerceParam(number, '1.26')).toBe(1.3)
    expect(coerceParam(number, 5)).toBe(2)
    expect(coerceParam(number, -1)).toBe(0)
    expect(coerceParam(number, 'abc')).toBe(1)
    expect(coerceParam(number, true)).toBe(1)
  })

  it('validates colours, booleans and enums', () => {
    const color: EffectParamSpec = { name: 'c', label: 'C', type: 'color', default: '#ffffff' }
    expect(coerceParam(color, ' #00FF00 ')).toBe('#00ff00')
    expect(coerceParam(color, 'green')).toBe('#ffffff')
    const flag: EffectParamSpec = { name: 'b', label: 'B', type: 'boolean', default: false }
    expect(coerceParam(flag, 'true')).toBe(true)
    expect(coerceParam(flag, 1)).toBe(false)
    const mode: EffectParamSpec = { name: 'm', label: 'M', type: 'enum', options: ['a', 'b'], default: 'a' }
    expect(coerceParam(mode, 'b')).toBe('b')
    expect(coerceParam(mode, 'c')).toBe('a')
  })

  it('fills every catalog parameter of an effect', () => {
    const entries = effectParamEntries('key', { threshold: 3, mode: 'luma' })
    expect(entries.map((entry) => entry.spec.name)).toEqual(EFFECT_CATALOG.key.params.map((spec) => spec.name))
    expect(entries.find((entry) => entry.spec.name === 'threshold')!.value).toBe(1)
    expect(entries.find((entry) => entry.spec.name === 'mode')!.value).toBe('luma')
    expect(entries.find((entry) => entry.spec.name === 'keyColor')!.value).toBe('#00ff00')
  })
})

describe('sources', () => {
  it('creates schema-valid sources', () => {
    for (const source of [
      createSolidSource('#ff0000', 's1'),
      createGradientSource('s2'),
      createShaderSource('plasma', 's3'),
      createShaderSource('noise', 's4'),
      createShaderSource('lines', 's5'),
      createMediaSource({ id: 'm', kind: 'video', name: 'Loop', sha256: 'h' }, 's6')!,
      createMediaSource({ id: 'm', kind: 'image', name: 'Still', sha256: 'h' }, 's7')!,
    ]) {
      expect(sourceSchema.safeParse(source).success).toBe(true)
    }
    expect(createMediaSource({ id: 'a', kind: 'audio', name: 'Click', sha256: 'h' })).toBeNull()
  })

  it('labels and approximates sources', () => {
    const shader = createShaderSource('lines', 'x')
    expect(sourceLabel({ ...shader, name: '' })).toBe('Lines')
    expect(sourceCss(createSolidSource('#123456', 'y'))).toBe('#123456')
    expect(sourceCss(createGradientSource('z'))).toBe('linear-gradient(90deg, #0b1020 0%, #3b5bdb 100%)')
    expect(defaultShaderParams('unknown')).toEqual({})
  })

  it('edits gradient stops', () => {
    const source = createGradientSource('g') as GradientSource
    const added = addGradientStop(source)
    expect(added.map((stop) => stop.at)).toEqual([0, 0.5, 1])
    expect(removeGradientStop({ ...source, stops: added }, 1)).toHaveLength(2)
    expect(removeGradientStop(source, 0)).toBe(source.stops)
    expect(updateGradientStop(source, 1, { at: 3, color: '#000000' })[1]).toEqual({ at: 1, color: '#000000' })
  })
})

describe('layers', () => {
  it('maps between the top-first list and the stack', () => {
    const layers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[]
    expect(layersTopFirst(layers).map((layer: { id: string }) => layer.id)).toEqual(['c', 'b', 'a'])
    expect(stackIndexFromDisplay(0, 3)).toBe(2)
    expect(stackIndexFromDisplay(2, 3)).toBe(0)
  })

  it('parses tags', () => {
    expect(parseTags(' Lyrics, content  lyrics,,')).toEqual(['lyrics', 'content'])
  })

  it('creates default masks', () => {
    expect(defaultMask('none')).toBeNull()
    expect(defaultMask('rect')).toMatchObject({ kind: 'rect', w: 0.8 })
    expect(defaultMask('polygon')).toMatchObject({ kind: 'polygon' })
    expect(defaultMask('image')).toBeNull()
    expect(defaultMask('image', { assetId: 'a', hash: 'h' })).toMatchObject({ kind: 'image', invert: false })
  })
})
