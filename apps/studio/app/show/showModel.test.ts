import { buildSongDoc } from '@lumen/core'
import type { PresentationDoc } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import type { MediaAssetLike } from '~/live/liveScene'
import type { DisplayInfo } from '~/output/api'
import {
  assignClip,
  createShowDoc,
  displayForScreen,
  emptyLive,
  launchColumn,
  liveComposition,
  schematicScene,
  updateScreen,
  withComposition,
  type ComposeContext,
  type ShowDoc,
  type ShowLive,
  type Screen,
} from './showModel'

const media: MediaAssetLike[] = [
  { id: 'media_video', kind: 'video', sha256: 'hash-video', width: 1920, height: 1080, localPath: '/v.mov', missing: false },
  { id: 'media_image', kind: 'image', sha256: 'hash-image', width: 1920, height: 1080, localPath: '/i.png', missing: false },
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

const context: ComposeContext = {
  media,
  presentation: (id) => (id === SONG_ID ? song : null),
  theme: null,
  revision: 9,
}

function loadedShow(): ShowDoc {
  let show = createShowDoc()
  const [background, visuals, lyrics] = show.composition.layers
  show = assignClip(show, background!.id, 0, { kind: 'media', assetId: 'media_video', loop: true }, 'Loop')
  show = assignClip(show, visuals!.id, 0, { kind: 'media', assetId: 'media_image', loop: true }, 'Logo')
  show = assignClip(show, lyrics!.id, 0, { kind: 'presentation', presentationId: SONG_ID }, 'Song')
  return show
}

function composeScreenScene(show: ShowDoc, live: ShowLive, screen: Screen, ctx: ComposeContext) {
  return schematicScene(liveComposition(show, live, ctx), screen, ctx)
}

describe('schematicScene', () => {
  it('renders each screen through the composition adapter', () => {
    const show = loadedShow()
    const live = launchColumn(show, emptyLive(), 0)
    const [main, wall] = show.screens
    const scene = composeScreenScene(show, live, main!, context)
    expect(scene.revision).toBe(9)
    expect(scene.layers.slice(0, 2).map((layer) => layer.kind)).toEqual(['video', 'image'])
    expect(scene.assets.map((asset) => asset.id).sort()).toEqual(['media_image', 'media_video'])
    expect(composeScreenScene(show, live, wall!, context).layers.map((layer) => layer.kind)).toEqual(['video', 'image'])
  })

  it('multiplies layer opacity into lyrics', () => {
    let show = loadedShow()
    const lyrics = show.composition.layers[2]!.id
    show = withComposition(show, (composition) => ({
      ...composition,
      layers: composition.layers.map((layer) => (layer.id === lyrics ? { ...layer, opacity: 0.5 } : layer)),
    }))
    const scene = composeScreenScene(show, launchColumn(show, emptyLive(), 0), show.screens[0]!, context)
    const text = scene.layers.filter((layer) => layer.kind === 'text')
    expect(text.length).toBeGreaterThan(0)
    for (const layer of text) expect(layer.opacity).toBeLessThanOrEqual(0.5)
  })

  it('shows the bare canvas without a screen', () => {
    const show = loadedShow()
    const composition = liveComposition(show, launchColumn(show, emptyLive(), 0), context)
    const scene = schematicScene(composition, null)
    expect(scene.viewport).toMatchObject(composition.canvas)
    expect(scene.layers.slice(0, 2).map((layer) => layer.kind)).toEqual(['video', 'image'])
  })

  it('renders a test pattern instead of content', () => {
    const base = loadedShow()
    const show = updateScreen(base, base.screens[0]!.id, { testPattern: 'bars' })
    const scene = composeScreenScene(show, launchColumn(show, emptyLive(), 0), show.screens[0]!, context)
    expect(scene.layers.some((layer) => layer.id.startsWith('pattern-bar'))).toBe(true)
    expect(scene.assets).toHaveLength(0)
  })
})

describe('displayForScreen', () => {
  const displays: DisplayInfo[] = [
    { index: 0, name: 'Built-in', width: 1512, height: 982, scale_factor: 2, x: 0, y: 0, primary: true },
    { index: 1, name: 'Projector', width: 1920, height: 1080, scale_factor: 1, x: 1512, y: 0, primary: false },
  ]

  it('matches name and position, then name, and never falls back', () => {
    const screen = createShowDoc().screens[0]!
    expect(displayForScreen(displays, screen)).toBeNull()
    const ref = { name: 'Projector', x: 9999, y: 0, width: 1920, height: 1080 }
    expect(displayForScreen(displays, { ...screen, target: { kind: 'display', ref } })?.index).toBe(1)
    const gone = { ...ref, name: 'Other' }
    expect(displayForScreen(displays, { ...screen, target: { kind: 'display', ref: gone } })).toBeNull()
  })
})
