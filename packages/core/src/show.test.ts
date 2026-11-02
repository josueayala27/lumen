import { showDocSchema, type PresentationDoc, type ShowDoc } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import { addSource } from './composition'
import { layersForLayout } from './screen'
import { buildSongDoc } from './presentation'
import {
  activeClips,
  addScreen,
  addShowLayer,
  assignClip,
  clearLayer,
  clipAt,
  createShowDoc,
  emptyLive,
  launchClip,
  launchColumn,
  liveComposition,
  migrateShowV1,
  moveScreen,
  moveShowClip,
  moveShowLayer,
  parseShowDoc,
  removeScreen,
  removeShowClip,
  removeShowLayer,
  setGridColumns,
  stepLyrics,
  toggleScreenLayer,
  updateScreen,
  updateScreenLayout,
  updateScreenMapping,
  withComposition,
  type ShowMediaLike,
  type ShowResolveContext,
} from './show'

const media: ShowMediaLike[] = [
  { id: 'media_video', kind: 'video', sha256: 'hash-video', width: 1920, height: 1080, localPath: '/v.mov', missing: false },
  { id: 'media_image', kind: 'image', sha256: 'hash-image', width: 1920, height: 1080, localPath: '/i.png', missing: false },
  { id: 'media_gone', kind: 'video', sha256: 'hash-gone', width: 1920, height: 1080, localPath: '/g.mov', missing: true },
]

const song: PresentationDoc = buildSongDoc({
  title: 'Song',
  author: '',
  ccli: '',
  key: '',
  tempo: null,
  lyrics: 'First line\nSecond line\n\nThird line\nFourth line',
})
const SONG_ID = 'presentation_song'

const context: ShowResolveContext = {
  media,
  presentation: (id) => (id === SONG_ID ? song : null),
  theme: null,
}

function loadedShow(): ShowDoc {
  let show = createShowDoc()
  const [background, visuals, lyrics] = show.composition.layers
  show = assignClip(show, background!.id, 0, { kind: 'media', assetId: 'media_video', loop: true }, 'Loop')
  show = assignClip(show, visuals!.id, 0, { kind: 'media', assetId: 'media_image', loop: true }, 'Logo')
  show = assignClip(show, lyrics!.id, 0, { kind: 'presentation', presentationId: SONG_ID }, 'Song')
  return show
}

describe('show document', () => {
  it('creates a valid default show with three layers and three screens', () => {
    const show = createShowDoc()
    expect(showDocSchema.safeParse(show).success).toBe(true)
    expect(show.composition.layers.map((layer) => layer.name)).toEqual(['Background', 'Visuals', 'Lyrics'])
    expect(show.composition.layers[2]!.tags).toContain('lyrics')
    expect(show.screens.map((screen) => screen.layout.text?.preset)).toEqual(['full', 'hidden', 'lowerThird'])
  })

  it('adds, moves and removes layers, cleaning clips and layouts', () => {
    let show = loadedShow()
    show = addShowLayer(show, { id: 'extra', name: 'Extra' })
    expect(show.composition.layers.at(-1)!.id).toBe('extra')
    show = moveShowLayer(show, 'extra', 0)
    expect(show.composition.layers[0]!.id).toBe('extra')
    const background = show.composition.layers[1]!.id
    show = removeShowLayer(show, background)
    expect(show.grid.clips.some((clip) => clip.layerId === background)).toBe(false)
    const wall = show.screens[1]!.layout.layers
    expect(wall.mode === 'only' && wall.ids.includes(background)).toBe(false)
    expect(showDocSchema.safeParse(show).success).toBe(true)
  })

  it('edits the composition through withComposition', () => {
    const show = withComposition(loadedShow(), (composition) =>
      addSource(composition, { id: 'red', name: '', kind: 'solid', color: '#f00' }),
    )
    expect(show.composition.sources).toHaveLength(1)
  })

  it('adds, updates, moves and removes screens', () => {
    let show = addScreen(createShowDoc())
    expect(show.screens).toHaveLength(4)
    const id = show.screens[3]!.id
    show = updateScreen(show, id, { name: 'Stage', role: 'stage', blackout: true })
    show = updateScreenLayout(show, id, { region: { x: 0, y: 0, w: 0.5, h: 1 } })
    show = updateScreenMapping(show, id, { cornerPin: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] })
    expect(show.screens[3]).toMatchObject({ name: 'Stage', role: 'stage', blackout: true, layout: { region: { w: 0.5 } } })
    expect(show.screens[3]!.mapping.cornerPin).toHaveLength(4)
    show = moveScreen(show, id, 0)
    expect(show.screens[0]!.id).toBe(id)
    show = removeScreen(show, id)
    expect(show.screens).toHaveLength(3)
    expect(showDocSchema.safeParse(show).success).toBe(true)
  })

  it('toggles layers on a screen in composition order', () => {
    const show = createShowDoc()
    const [a, b, c] = show.composition.layers.map((layer) => layer.id)
    const main = show.screens[0]!.id
    const off = toggleScreenLayer(show, main, b!, false)
    expect(off.screens[0]!.layout.layers).toEqual({ mode: 'only', ids: [a, c], tags: [] })
    const on = toggleScreenLayer(off, main, b!, true)
    expect(on.screens[0]!.layout.layers).toEqual({ mode: 'only', ids: [a, b, c], tags: [] })
  })
})

describe('clip grid', () => {
  it('puts one clip per cell and replaces on reassign', () => {
    const show = loadedShow()
    const layer = show.composition.layers[0]!.id
    const next = assignClip(show, layer, 0, { kind: 'media', assetId: 'media_image', loop: true }, 'Other')
    expect(next.grid.clips.filter((clip) => clip.layerId === layer && clip.column === 0)).toHaveLength(1)
    expect(clipAt(next, layer, 0)?.label).toBe('Other')
  })

  it('moves and removes clips', () => {
    const show = loadedShow()
    const layer = show.composition.layers[0]!.id
    const clip = clipAt(show, layer, 0)!
    const moved = moveShowClip(show, clip.id, layer, 3)
    expect(clipAt(moved, layer, 0)).toBeNull()
    expect(clipAt(moved, layer, 3)?.id).toBe(clip.id)
    expect(clipAt(removeShowClip(show, clip.id), layer, 0)).toBeNull()
  })

  it('drops clips past the last column', () => {
    const show = loadedShow()
    const layer = show.composition.layers[0]!.id
    const wide = assignClip(show, layer, 6, { kind: 'media', assetId: 'media_image', loop: true }, 'Late')
    const narrow = setGridColumns(wide, 4)
    expect(narrow.grid.columns).toBe(4)
    expect(clipAt(narrow, layer, 6)).toBeNull()
  })

  it('launches a column across layers and keeps layers without a clip there', () => {
    let show = loadedShow()
    const background = show.composition.layers[0]!.id
    show = assignClip(show, background, 1, { kind: 'media', assetId: 'media_image', loop: true }, 'Still')
    let live = launchColumn(show, emptyLive(), 0)
    expect(activeClips(show, live)).toHaveLength(3)
    live = launchColumn(show, live, 1)
    expect(live.active[background]).toBe(clipAt(show, background, 1)!.id)
    expect(live.active[show.composition.layers[1]!.id]).toBe(clipAt(show, show.composition.layers[1]!.id, 0)!.id)
    expect(activeClips(show, clearLayer(live, background))).toHaveLength(2)
  })

  it('restarts slides on launch, keeps them on relaunch and clamps steps', () => {
    const show = loadedShow()
    const clip = clipAt(show, show.composition.layers[2]!.id, 0)!
    let live = launchClip(emptyLive(), clip)
    live = stepLyrics(live, clip.id, 1, song.slides.length)
    expect(live.slides[clip.id]).toBe(1)
    expect(launchClip(live, clip).slides[clip.id]).toBe(1)
    expect(stepLyrics(live, clip.id, 9, 2).slides[clip.id]).toBe(1)
    expect(stepLyrics(live, clip.id, -9, 2).slides[clip.id]).toBe(0)
  })
})

describe('liveComposition', () => {
  it('resolves active clips into sources and assets', () => {
    const show = loadedShow()
    const composition = liveComposition(show, launchColumn(show, emptyLive(), 0), context)
    expect(composition.layers.every((layer) => layer.sourceId !== null)).toBe(true)
    expect(composition.sources.map((source) => source.kind)).toEqual(['video', 'image', 'slide'])
    expect(composition.assets.map((asset) => asset.id).sort()).toEqual(['media_image', 'media_video'])
  })

  it('lets each screen layout pick its layers', () => {
    const show = loadedShow()
    const composition = liveComposition(show, launchColumn(show, emptyLive(), 0), context)
    const kindsOn = (index: number) =>
      layersForLayout(show.screens[index]!.layout, composition.layers).map(
        (layer) => composition.sources.find((source) => source.id === layer.sourceId)?.kind,
      )
    expect(kindsOn(0)).toEqual(['video', 'image', 'slide'])
    expect(kindsOn(1)).toEqual(['video', 'image'])
    expect(show.screens[2]!.layout.text?.preset).toBe('lowerThird')
  })

  it('leaves layers empty when media is missing and keeps authored sources', () => {
    let show = loadedShow()
    const [background, visuals] = show.composition.layers
    show = withComposition(show, (composition) => ({
      ...addSource(composition, { id: 'red', name: '', kind: 'solid', color: '#f00' }),
      layers: composition.layers.map((layer) => (layer.id === visuals!.id ? { ...layer, sourceId: 'red' } : layer)),
    }))
    show = assignClip(show, background!.id, 0, { kind: 'media', assetId: 'media_gone', loop: true }, 'Gone')
    const live = launchClip(emptyLive(), clipAt(show, background!.id, 0)!)
    const composition = liveComposition(show, live, context)
    expect(composition.layers[0]!.sourceId).toBeNull()
    expect(composition.layers[1]!.sourceId).toBe('red')
  })

  it('launches inline sources and composition source references', () => {
    let show = loadedShow()
    const [background, visuals] = show.composition.layers
    show = withComposition(show, (composition) => addSource(composition, { id: 'blue', name: '', kind: 'solid', color: '#00f' }))
    show = assignClip(show, background!.id, 2, { kind: 'source', source: { id: 'x', name: '', kind: 'solid', color: '#0f0' } }, 'Green')
    show = assignClip(show, visuals!.id, 2, { kind: 'sourceRef', sourceId: 'blue' }, 'Blue')
    const composition = liveComposition(show, launchColumn(show, emptyLive(), 2), context)
    const colors = composition.layers.map((layer) => {
      const source = composition.sources.find((entry) => entry.id === layer.sourceId)
      return source?.kind === 'solid' ? source.color : source?.kind
    })
    expect(colors.slice(0, 2)).toEqual(['#0f0', '#00f'])
  })
})

describe('loading', () => {
  const v1 = {
    schemaVersion: 1,
    id: 'show_old',
    name: 'Old show',
    columns: 6,
    layers: [
      { id: 'l1', name: 'Background', opacity: 1 },
      { id: 'l2', name: 'Words', opacity: 0.4 },
    ],
    clips: [
      { id: 'c1', layerId: 'l1', column: 0, label: 'Loop', source: { kind: 'media', assetId: 'media_video' }, loop: false },
      { id: 'c2', layerId: 'l2', column: 1, label: 'Song', source: { kind: 'lyrics', presentationId: SONG_ID }, loop: true },
      { id: 'c3', layerId: 'nope', column: 0, label: 'Orphan', source: { kind: 'media', assetId: 'a' }, loop: true },
    ],
    screens: [
      { id: 's1', name: 'Main', displayIndex: 1, layerIds: ['l1', 'l2'], lyrics: 'full', testPattern: false },
      { id: 's2', name: 'Wall', displayIndex: null, layerIds: ['l1', 'nope'], lyrics: 'hidden', testPattern: true },
    ],
  }

  it('migrates a v1 show', () => {
    const ref = { name: 'Projector', x: 1920, y: 0, width: 1280, height: 720 }
    const show = migrateShowV1(v1, { displayRef: (index) => (index === 1 ? ref : null) })!
    expect(showDocSchema.safeParse(show).success).toBe(true)
    expect(show).toMatchObject({ schemaVersion: 2, id: 'show_old', name: 'Old show', grid: { columns: 6 } })
    expect(show.composition.layers.map((layer) => [layer.id, layer.opacity, layer.tags])).toEqual([
      ['l1', 1, []],
      ['l2', 0.4, ['lyrics']],
    ])
    expect(show.grid.clips.map((clip) => clip.content)).toEqual([
      { kind: 'media', assetId: 'media_video', loop: false },
      { kind: 'presentation', presentationId: SONG_ID },
    ])
    const [main, wall] = show.screens
    expect(main).toMatchObject({ id: 's1', target: { kind: 'display', ref }, size: { width: 1280, height: 720 } })
    expect(main!.layout.layers).toEqual({ mode: 'all' })
    expect(wall).toMatchObject({ target: { kind: 'virtual' }, testPattern: 'bars' })
    expect(wall!.layout.layers).toEqual({ mode: 'only', ids: ['l1'], tags: [] })
    expect(wall!.layout.text?.preset).toBe('hidden')
  })

  it('parses v1 and v2 and rejects anything else', () => {
    expect(parseShowDoc(v1)?.schemaVersion).toBe(2)
    const show = loadedShow()
    expect(parseShowDoc(JSON.parse(JSON.stringify(show)))).toEqual(show)
    expect(parseShowDoc(null)).toBeNull()
    expect(parseShowDoc({ schemaVersion: 3 })).toBeNull()
    expect(parseShowDoc({ ...show, composition: { ...show.composition, schemaVersion: 1 } })).toBeNull()
  })

  it('drops clips and layout ids for unknown layers', () => {
    const show = loadedShow()
    const broken = {
      ...show,
      grid: { ...show.grid, clips: [...show.grid.clips, { id: 'x', layerId: 'nope', column: 0, label: '', content: { kind: 'media', assetId: 'a' } }] },
      screens: [{ ...show.screens[0]!, layout: { ...show.screens[0]!.layout, layers: { mode: 'only', ids: ['nope', show.composition.layers[0]!.id], tags: [] } } }],
    }
    const result = parseShowDoc(broken)!
    expect(result.grid.clips).toHaveLength(show.grid.clips.length)
    expect(result.screens[0]!.layout.layers).toEqual({ mode: 'only', ids: [show.composition.layers[0]!.id], tags: [] })
  })
})
