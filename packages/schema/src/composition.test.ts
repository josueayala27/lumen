import { describe, expect, it } from 'vitest'
import {
  EFFECT_CATALOG,
  EFFECT_KINDS,
  compositionSchema,
  defaultEffectParams,
  effectSchema,
  maskSchema,
  sourceSchema,
} from './composition'
import { screenSchema } from './screen'
import { showDocSchema } from './show'

const asset = { assetId: 'media_1', hash: 'abc' }

function composition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    revision: 1,
    canvas: { width: 1920, height: 1080 },
    sources: [
      { id: 'video', kind: 'video', asset },
      { id: 'solid', kind: 'solid', color: '#ff0000' },
    ],
    layers: [
      { id: 'bg', name: 'Background', sourceId: 'video', transform: {} },
      { id: 'fg', name: 'Overlay', sourceId: 'solid', transform: { x: 0.5, w: 0.5 }, blend: 'add', opacity: 0.5 },
    ],
    master: {},
    ...overrides,
  }
}

function screen(overrides: Record<string, unknown> = {}) {
  return {
    id: 'screen_1',
    name: 'Main',
    target: { kind: 'display', ref: { name: 'Projector', x: 1920, y: 0, width: 1920, height: 1080 } },
    size: { width: 1920, height: 1080 },
    layout: {
      layers: { mode: 'only', tags: ['lyrics'] },
      region: { x: 0, y: 0, w: 1, h: 1 },
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    mapping: { color: {} },
    ...overrides,
  }
}

describe('composition schema', () => {
  it('accepts a composition and fills defaults', () => {
    const parsed = compositionSchema.parse(composition())
    expect(parsed.colorSpace).toBe('srgb')
    expect(parsed.master).toEqual({ opacity: 1, effects: [] })
    expect(parsed.layers[0]).toMatchObject({ enabled: true, fit: 'cover', opacity: 1, blend: 'normal', mask: null, tags: [] })
    expect(parsed.layers[0]!.transform).toEqual({ x: 0, y: 0, w: 1, h: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 })
    expect(parsed.sources[0]).toMatchObject({ loop: true, inMs: 0, outMs: null, rate: 1, reverse: false, muted: true, volume: 1 })
  })

  it('rejects unknown source references and duplicate ids', () => {
    expect(compositionSchema.safeParse(composition({ layers: [{ id: 'a', name: 'A', sourceId: 'nope', transform: {} }] })).success).toBe(false)
    const dupes = composition({
      sources: [
        { id: 'x', kind: 'solid', color: '#000' },
        { id: 'x', kind: 'solid', color: '#fff' },
      ],
      layers: [],
    })
    expect(compositionSchema.safeParse(dupes).success).toBe(false)
  })

  it('rejects a wrong schema version and bad layer values', () => {
    expect(compositionSchema.safeParse(composition({ schemaVersion: 1 })).success).toBe(false)
    expect(
      compositionSchema.safeParse(composition({ layers: [{ id: 'a', name: 'A', transform: {}, blend: 'burn' }] })).success,
    ).toBe(false)
    expect(compositionSchema.safeParse(composition({ layers: [{ id: 'a', name: 'A', transform: {}, opacity: 2 }] })).success).toBe(false)
  })

  it('validates every source kind', () => {
    const slide = {
      id: 's',
      kind: 'slide',
      elements: [
        {
          kind: 'text',
          id: 't',
          frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.8, rotation: 0 },
          runs: [{ text: 'Hi' }],
          fontId: 'f',
          fontSize: 64,
          color: '#fff',
        },
      ],
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      size: { width: 1920, height: 1080 },
    }
    for (const source of [
      { id: 'v', kind: 'video', asset },
      { id: 'i', kind: 'image', asset },
      slide,
      { id: 'c', kind: 'solid', color: '#000' },
      { id: 'g', kind: 'gradient', stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] },
      { id: 'sh', kind: 'shader', shaderId: 'plasma', params: { speed: 1, tint: '#f00', on: true } },
      { id: 'n', kind: 'ndi', name: 'Cam' },
      { id: 'cam', kind: 'camera', deviceId: 'dev' },
    ]) {
      expect(sourceSchema.safeParse(source).success, source.kind).toBe(true)
    }
    expect(sourceSchema.safeParse({ id: 'x', kind: 'hologram' }).success).toBe(false)
    expect(sourceSchema.safeParse({ id: 'g', kind: 'gradient', stops: [{ at: 0, color: '#000' }] }).success).toBe(false)
    // Video is not a slide element in v2.
    const withVideo = { ...slide, elements: [{ kind: 'video', id: 'v', frame: slide.elements[0]!.frame, source: asset }] }
    expect(sourceSchema.safeParse(withVideo).success).toBe(false)
  })

  it('validates effects against the known kinds', () => {
    expect(effectSchema.safeParse({ id: 'e', kind: 'blur', params: { radius: 4 } }).success).toBe(true)
    expect(effectSchema.safeParse({ id: 'e', kind: 'glow' }).success).toBe(false)
  })

  it('validates masks', () => {
    expect(maskSchema.safeParse({ kind: 'rect', x: 0, y: 0, w: 1, h: 1 }).success).toBe(true)
    expect(maskSchema.safeParse({ kind: 'polygon', points: [[0, 0], [1, 0], [1, 1]] }).success).toBe(true)
    expect(maskSchema.safeParse({ kind: 'polygon', points: [[0, 0], [1, 0]] }).success).toBe(false)
    expect(maskSchema.safeParse({ kind: 'image', asset }).success).toBe(true)
  })
})

describe('effect catalog', () => {
  it('covers every kind with defaults inside their range', () => {
    for (const kind of EFFECT_KINDS) {
      const params = defaultEffectParams(kind)
      expect(Object.keys(params).length).toBeGreaterThan(0)
      for (const spec of EFFECT_CATALOG[kind].params) {
        if (spec.type === 'number') {
          expect(spec.default).toBeGreaterThanOrEqual(spec.min)
          expect(spec.default).toBeLessThanOrEqual(spec.max)
        }
        if (spec.type === 'enum') expect(spec.options).toContain(spec.default)
      }
    }
  })
})

describe('screen schema', () => {
  it('accepts a screen and fills defaults', () => {
    const parsed = screenSchema.parse(screen())
    expect(parsed).toMatchObject({ role: 'audience', enabled: true, blackout: false, testPattern: null })
    expect(parsed.layout).toMatchObject({ text: null, background: null, stage: null })
    expect(parsed.layout.layers).toEqual({ mode: 'only', ids: [], tags: ['lyrics'] })
    expect(parsed.mapping).toMatchObject({ cornerPin: null, mesh: null, edgeBlend: null, masks: [] })
    expect(parsed.mapping.color).toEqual({ brightness: 0, contrast: 1, gamma: 1, red: 1, green: 1, blue: 1 })
  })

  it('accepts virtual targets, corner pins and meshes', () => {
    const pin = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    const mesh = { cols: 2, rows: 2, points: pin }
    expect(screenSchema.safeParse(screen({ target: { kind: 'virtual' }, mapping: { color: {}, cornerPin: pin, mesh } })).success).toBe(true)
  })

  it('rejects bad targets, regions and meshes', () => {
    expect(screenSchema.safeParse(screen({ target: { kind: 'hdmi' } })).success).toBe(false)
    const badRegion = screen({ layout: { ...screen().layout, region: { x: 0, y: 0, w: 0, h: 1 } } })
    expect(screenSchema.safeParse(badRegion).success).toBe(false)
    const badMesh = { cols: 3, rows: 2, points: [{ x: 0, y: 0 }] }
    expect(screenSchema.safeParse(screen({ mapping: { color: {}, mesh: badMesh } })).success).toBe(false)
    expect(screenSchema.safeParse(screen({ testPattern: 'zebra' })).success).toBe(false)
  })
})

describe('show doc schema', () => {
  it('accepts a v2 show and rejects bad clip content', () => {
    const show = {
      schemaVersion: 2,
      id: 'show_1',
      name: 'Show',
      composition: composition(),
      screens: [screen()],
      grid: {
        columns: 8,
        clips: [
          { id: 'c1', layerId: 'bg', column: 0, label: 'Loop', content: { kind: 'media', assetId: 'media_1' } },
          { id: 'c2', layerId: 'fg', column: 1, label: 'Red', content: { kind: 'source', source: { id: 'r', kind: 'solid', color: '#f00' } } },
          { id: 'c3', layerId: 'fg', column: 2, label: 'Song', content: { kind: 'presentation', presentationId: 'p' } },
        ],
      },
    }
    expect(showDocSchema.safeParse(show).success).toBe(true)
    const bad = { ...show, grid: { columns: 8, clips: [{ id: 'c', layerId: 'bg', column: 0, label: '', content: { kind: 'lyrics' } }] } }
    expect(showDocSchema.safeParse(bad).success).toBe(false)
    expect(showDocSchema.safeParse({ ...show, grid: { columns: 0, clips: [] } }).success).toBe(false)
  })
})
