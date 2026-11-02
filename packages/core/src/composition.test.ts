import { compositionSchema, type Composition, type Scene, type SceneLayer, type Screen } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import {
  addCompositionLayer,
  addLayerEffect,
  addMasterEffect,
  duplicateCompositionLayer,
  moveMasterEffect,
  removeMasterEffect,
  setCanvasSize,
  updateMasterEffect,
  addSource,
  createComposition,
  createEffect,
  createLayer,
  moveCompositionLayer,
  moveLayerEffect,
  removeCompositionLayer,
  removeLayerEffect,
  removeSource,
  setLayerSource,
  setMasterOpacity,
  touchComposition,
  updateCompositionLayer,
  updateLayerEffect,
  updateSource,
} from './composition'
import { compositionToScene, sceneToComposition } from './compositionScene'
import {
  createScreen,
  frameInRegion,
  layersForLayout,
  layoutIncludesLayer,
  regionSize,
  resolveLayoutText,
  sideBySideRegions,
} from './screen'

const asset = { assetId: 'media_video', hash: 'hash-video' }
const sceneAsset = {
  id: 'media_video',
  hash: 'hash-video',
  kind: 'video' as const,
  localPath: '/v.mov',
  url: null,
  intrinsic: { width: 1920, height: 1080 },
  state: 'ready' as const,
}

function textElement(id: string, z = 1): Extract<SceneLayer, { kind: 'text' }> {
  return {
    kind: 'text',
    id,
    frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.8, rotation: 0 },
    z,
    opacity: 1,
    runs: [{ text: 'Hello', bold: false, italic: false, underline: false, color: null }],
    fontId: 'font',
    fontSize: 80,
    weight: 400,
    color: '#ffffff',
    align: 'center',
    vAlign: 'middle',
    lineHeight: 1.2,
    letterSpacing: 0,
    fit: 'wrap',
    padding: 0,
    maxLines: null,
    shadow: null,
    outline: null,
  }
}

/** Video background, a red overlay and lyrics. */
function sample(): Composition {
  let composition = createComposition()
  composition = addSource(composition, {
    id: 'video',
    name: '',
    kind: 'video',
    asset,
    loop: true,
    inMs: 500,
    outMs: null,
    rate: 1,
    reverse: false,
    muted: true,
    volume: 1,
  })
  composition = addSource(composition, { id: 'red', name: '', kind: 'solid', color: '#ff0000' })
  composition = addSource(composition, {
    id: 'words',
    name: '',
    kind: 'slide',
    revision: 0,
    elements: [textElement('t1')],
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    size: { width: 1920, height: 1080 },
  })
  composition = addCompositionLayer(composition, createLayer({ id: 'bg', name: 'Background', sourceId: 'video', fit: 'contain' }))
  composition = addCompositionLayer(
    composition,
    createLayer({ id: 'overlay', name: 'Overlay', sourceId: 'red', opacity: 0.5, blend: 'add', transform: { x: 0.5, w: 0.5 } }),
  )
  composition = addCompositionLayer(composition, createLayer({ id: 'lyrics', name: 'Lyrics', sourceId: 'words', tags: ['lyrics'] }))
  return { ...composition, assets: [sceneAsset] }
}

describe('composition ops', () => {
  it('builds a valid composition', () => {
    expect(compositionSchema.safeParse(sample()).success).toBe(true)
  })

  it('adds, moves, updates and removes layers', () => {
    let composition = sample()
    composition = addCompositionLayer(composition, createLayer({ id: 'bottom' }), 0)
    expect(composition.layers.map((layer) => layer.id)).toEqual(['bottom', 'bg', 'overlay', 'lyrics'])
    composition = moveCompositionLayer(composition, 'bottom', 99)
    expect(composition.layers.at(-1)!.id).toBe('bottom')
    composition = updateCompositionLayer(composition, 'bottom', { opacity: 3, transform: { x: 0.25 } })
    expect(composition.layers.at(-1)!.opacity).toBe(1)
    expect(composition.layers.at(-1)!.transform).toMatchObject({ x: 0.25, w: 1 })
    composition = removeCompositionLayer(composition, 'bottom')
    expect(composition.layers).toHaveLength(3)
  })

  it('sets layer sources only to known sources', () => {
    const composition = sample()
    expect(setLayerSource(composition, 'bg', 'nope')).toBe(composition)
    expect(setLayerSource(composition, 'bg', 'red').layers[0]!.sourceId).toBe('red')
    expect(setLayerSource(composition, 'bg', null).layers[0]!.sourceId).toBeNull()
  })

  it('updates and removes sources, clearing layers that used them', () => {
    let composition = updateSource(sample(), 'red', { color: '#00ff00' } as never)
    expect(composition.sources.find((source) => source.id === 'red')).toMatchObject({ kind: 'solid', color: '#00ff00' })
    composition = removeSource(composition, 'red')
    expect(composition.layers[1]!.sourceId).toBeNull()
    expect(compositionSchema.safeParse(composition).success).toBe(true)
  })

  it('edits an effects chain', () => {
    let composition = addLayerEffect(sample(), 'bg', createEffect('blur', 'e1'))
    composition = addLayerEffect(composition, 'bg', createEffect('color', 'e2'))
    expect(composition.layers[0]!.effects[0]!.params).toEqual({ radius: 8 })
    composition = updateLayerEffect(composition, 'bg', 'e1', { params: { radius: 2 }, enabled: false })
    expect(composition.layers[0]!.effects[0]).toMatchObject({ enabled: false, params: { radius: 2 } })
    composition = moveLayerEffect(composition, 'bg', 'e2', 0)
    expect(composition.layers[0]!.effects.map((effect) => effect.id)).toEqual(['e2', 'e1'])
    composition = removeLayerEffect(composition, 'bg', 'e2')
    expect(composition.layers[0]!.effects.map((effect) => effect.id)).toEqual(['e1'])
    expect(compositionSchema.safeParse(composition).success).toBe(true)
  })

  it('bumps the revision only when touched', () => {
    const composition = sample()
    expect(touchComposition(composition).revision).toBe(composition.revision + 1)
    expect(setMasterOpacity(composition, -1).master.opacity).toBe(0)
  })
})

describe('layout helpers', () => {
  const layers = [
    { id: 'a', tags: ['background'] },
    { id: 'b', tags: [] },
    { id: 'c', tags: ['lyrics'] },
  ]

  it('filters layers by id or tag', () => {
    const layout = createScreen({ layout: { layers: { mode: 'only', ids: ['b'], tags: ['lyrics'] } } }).layout
    expect(layersForLayout(layout, layers).map((layer) => layer.id)).toEqual(['b', 'c'])
    expect(layoutIncludesLayer(createScreen().layout, layers[0]!)).toBe(true)
  })

  it('maps frames into regions', () => {
    const region = { x: 0.5, y: 0, w: 0.5, h: 1 }
    expect(frameInRegion({ x: 0.5, y: 0, w: 0.25, h: 1, rotation: 0 }, region)).toEqual({ x: 0, y: 0, w: 0.5, h: 1, rotation: 0 })
    expect(regionSize({ width: 3840, height: 1080 }, region)).toEqual({ width: 1920, height: 1080 })
  })

  it('splits a wide canvas into overlapping regions', () => {
    const regions = sideBySideRegions(3, 0.1)
    expect(regions).toHaveLength(3)
    expect(regions[0]!.x).toBe(0)
    expect(regions[2]!.x + regions[2]!.w).toBeCloseTo(1)
    expect(regions[0]!.x + regions[0]!.w - regions[1]!.x).toBeCloseTo(0.1)
  })

  it('resolves text settings with a full default', () => {
    const screen = createScreen()
    expect(resolveLayoutText({ ...screen.layout, text: null })).toEqual({ preset: 'full', scale: 1, color: null })
  })
})

describe('compositionToScene', () => {
  it('draws each layer bottom to top with mapped opacity, fit and assets', () => {
    const scene = compositionToScene(sample(), createScreen())
    expect(scene.schemaVersion).toBe(1)
    expect(scene.layers.map((layer) => layer.kind)).toEqual(['video', 'shape', 'text'])
    const [video, overlay] = scene.layers
    expect(video).toMatchObject({ kind: 'video', fit: 'contain', startMs: 500, source: asset })
    expect(overlay).toMatchObject({ kind: 'shape', fill: '#ff0000', opacity: 0.5, frame: { x: 0.5, w: 0.5 } })
    expect(scene.layers[0]!.z).toBeLessThan(scene.layers[2]!.z)
    expect(scene.assets.map((entry) => entry.id)).toEqual(['media_video'])
    expect(scene.background).toMatchObject({ kind: 'shape', fill: '#000000' })
  })

  it('applies the layer filter, region and text preset', () => {
    const screen: Screen = createScreen({
      layout: {
        layers: { mode: 'only', ids: ['bg'], tags: ['lyrics'] },
        region: { x: 0.5, y: 0, w: 0.5, h: 1 },
        text: { preset: 'lowerThird', scale: 1, color: '#ffff00' },
        background: '#112233',
      },
    })
    const scene = compositionToScene(sample(), screen, { revision: 42 })
    expect(scene.revision).toBe(42)
    expect(scene.viewport).toMatchObject({ width: 960, height: 1080 })
    expect(scene.layers.map((layer) => layer.kind)).toEqual(['video', 'text'])
    expect(scene.layers[0]!.frame).toMatchObject({ x: -1, w: 2 })
    const text = scene.layers[1]!
    expect(text.kind === 'text' && text.frame.y).toBeGreaterThan(0.7)
    expect(text.kind === 'text' && text.color).toBe('#ffff00')
    expect(scene.background).toMatchObject({ fill: '#112233' })
  })

  it('hides text and skips disabled, sourceless and generator layers', () => {
    let composition = sample()
    composition = addSource(composition, { id: 'plasma', name: '', kind: 'shader', shaderId: 'plasma', params: {} })
    composition = addCompositionLayer(composition, createLayer({ id: 'gen', sourceId: 'plasma' }))
    composition = addCompositionLayer(composition, createLayer({ id: 'empty' }))
    composition = updateCompositionLayer(composition, 'overlay', { enabled: false })
    const screen = createScreen({ layout: { text: { preset: 'hidden', scale: 1, color: null } } })
    expect(compositionToScene(composition, screen).layers.map((layer) => layer.id)).toEqual(['bg'])
  })

  it('multiplies master opacity and blacks out', () => {
    const composition = setMasterOpacity(sample(), 0.5)
    const scene = compositionToScene(composition, createScreen())
    expect(scene.layers[1]!.opacity).toBeCloseTo(0.25)
    const black = compositionToScene(composition, { ...createScreen(), blackout: true })
    expect(black.layers).toHaveLength(0)
    expect(black.assets).toHaveLength(0)
  })

  it('places slide elements inside the layer box and scales text', () => {
    const composition = updateCompositionLayer(sample(), 'lyrics', { transform: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } })
    const text = compositionToScene(composition, createScreen()).layers.find((layer) => layer.kind === 'text')!
    expect(text.frame).toMatchObject({ x: 0.55, y: 0.55, w: 0.4, h: 0.4 })
    expect(text.kind === 'text' && text.fontSize).toBe(40)
  })
})

describe('sceneToComposition', () => {
  const scene: Scene = {
    schemaVersion: 1,
    revision: 7,
    role: 'stage',
    viewport: { width: 1920, height: 1080, scale: 1 },
    colorSpace: 'srgb',
    background: {
      kind: 'video',
      id: 'slide-background',
      frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      z: -1000,
      opacity: 1,
      source: asset,
      fit: 'cover',
      loop: true,
      muted: true,
      volume: 1,
      startMs: 0,
    },
    layers: [textElement('b', 2), textElement('a', 1)],
    fonts: [],
    assets: [sceneAsset],
    safeArea: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  }

  it('converts background and slide layers', () => {
    const { composition, screen } = sceneToComposition(scene, { contentTag: 'lyrics' })
    expect(compositionSchema.safeParse(composition).success).toBe(true)
    expect(composition.revision).toBe(7)
    expect(composition.layers.map((layer) => layer.tags)).toEqual([['background'], ['lyrics']])
    expect(composition.sources.map((source) => source.kind)).toEqual(['video', 'slide'])
    const slide = composition.sources[1]!
    expect(slide.kind === 'slide' && slide.elements.map((element) => element.id)).toEqual(['a', 'b'])
    expect(screen.role).toBe('stage')
    expect(screen.layout.safeArea.top).toBe(0.05)
  })

  it('round-trips through compositionToScene', () => {
    const { composition, screen } = sceneToComposition({ ...scene, role: 'audience' })
    const back = compositionToScene(composition, screen)
    expect(screen.role).toBe('audience')
    expect(back.layers.map((layer) => layer.kind)).toEqual(['video', 'text', 'text'])
    expect(back.layers[1]!.frame).toEqual(scene.layers[1]!.frame)
    expect(back.assets).toEqual([sceneAsset])
  })
})

describe('compose helpers', () => {
  it('duplicates a layer above the original with fresh ids', () => {
    let composition = createComposition()
    composition = addCompositionLayer(composition, createLayer({ id: 'a', name: 'Back', effects: [createEffect('blur', 'fx')] }))
    composition = addCompositionLayer(composition, createLayer({ id: 'b' }))
    const next = duplicateCompositionLayer(composition, 'a', 'copy')
    expect(next.layers.map((layer) => layer.id)).toEqual(['a', 'copy', 'b'])
    const copy = next.layers[1]!
    expect(copy.name).toBe('Back copy')
    expect(copy.effects[0]!.id).not.toBe('fx')
    expect(copy.effects[0]!.params).toEqual(composition.layers[0]!.effects[0]!.params)
    expect(copy.transform).not.toBe(composition.layers[0]!.transform)
    expect(duplicateCompositionLayer(composition, 'missing')).toBe(composition)
  })

  it('edits master effects', () => {
    let composition = addMasterEffect(createComposition(), createEffect('color', 'c'))
    composition = addMasterEffect(composition, createEffect('blur', 'b'))
    composition = updateMasterEffect(composition, 'c', { enabled: false, params: { brightness: 0.5 } })
    expect(composition.master.effects[0]).toMatchObject({ enabled: false, params: { brightness: 0.5, contrast: 1 } })
    composition = moveMasterEffect(composition, 'b', 0)
    expect(composition.master.effects.map((effect) => effect.id)).toEqual(['b', 'c'])
    expect(moveMasterEffect(composition, 'missing', 0)).toBe(composition)
    composition = removeMasterEffect(composition, 'b')
    expect(composition.master.effects.map((effect) => effect.id)).toEqual(['c'])
  })

  it('sets the canvas size to whole positive pixels', () => {
    const composition = createComposition({ width: 1920, height: 1080 })
    expect(setCanvasSize(composition, { width: 1280.4, height: 720 }).canvas).toEqual({ width: 1280, height: 720 })
    expect(setCanvasSize(composition, { width: 0, height: 720 })).toBe(composition)
    expect(setCanvasSize(composition, { width: 1920, height: 1080 })).toBe(composition)
  })
})
