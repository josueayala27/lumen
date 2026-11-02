import { buildSongDoc } from '@lumen/core'
import type { PresentationDoc } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import type { MediaAssetLike } from '~/live/liveScene'
import {
  activeClips,
  assignClip,
  clearLayer,
  clipAt,
  composeScreenScene,
  defaultShow,
  emptyLive,
  launchClip,
  launchColumn,
  normalizeShow,
  removeClip,
  setLayerOpacity,
  stepLyrics,
  updateScreen,
  type ComposeContext,
  type ShowDoc,
} from './showModel'

const media: MediaAssetLike[] = [
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

const context: ComposeContext = {
  media,
  presentation: (id) => (id === SONG_ID ? song : null),
  theme: null,
  revision: 1,
}

/** Background video, a visuals image and lyrics in column 0. */
function loadedShow(): ShowDoc {
  let show = defaultShow()
  const [background, visuals, lyrics] = show.layers
  show = assignClip(show, background!.id, 0, { kind: 'media', assetId: 'media_video' }, 'Loop')
  show = assignClip(show, visuals!.id, 0, { kind: 'media', assetId: 'media_image' }, 'Logo')
  show = assignClip(show, lyrics!.id, 0, { kind: 'lyrics', presentationId: SONG_ID }, 'Song')
  return show
}

describe('clip grid', () => {
  it('puts one clip per cell and replaces on reassign', () => {
    const show = loadedShow()
    const layer = show.layers[0]!.id
    const next = assignClip(show, layer, 0, { kind: 'media', assetId: 'media_image' }, 'Other')
    expect(next.clips.filter((clip) => clip.layerId === layer && clip.column === 0)).toHaveLength(1)
    expect(clipAt(next, layer, 0)?.label).toBe('Other')
  })

  it('removes a clip', () => {
    const show = loadedShow()
    const clip = clipAt(show, show.layers[0]!.id, 0)!
    expect(clipAt(removeClip(show, clip.id), show.layers[0]!.id, 0)).toBeNull()
  })

  it('launches a column across layers and keeps layers without a clip there', () => {
    let show = loadedShow()
    const background = show.layers[0]!.id
    show = assignClip(show, background, 1, { kind: 'media', assetId: 'media_image' }, 'Still')
    let live = launchColumn(show, emptyLive(), 0)
    expect(activeClips(show, live)).toHaveLength(3)
    live = launchColumn(show, live, 1)
    expect(live.active[background]).toBe(clipAt(show, background, 1)!.id)
    expect(live.active[show.layers[1]!.id]).toBe(clipAt(show, show.layers[1]!.id, 0)!.id)
  })

  it('clears one layer', () => {
    const show = loadedShow()
    const live = clearLayer(launchColumn(show, emptyLive(), 0), show.layers[0]!.id)
    expect(activeClips(show, live)).toHaveLength(2)
  })

  it('restarts lyrics at slide 0 on launch and keeps the slide on relaunch', () => {
    const show = loadedShow()
    const clip = clipAt(show, show.layers[2]!.id, 0)!
    let live = launchClip(emptyLive(), clip)
    live = stepLyrics(live, clip.id, 1, song.slides.length)
    expect(live.slides[clip.id]).toBe(1)
    expect(launchClip(live, clip).slides[clip.id]).toBe(1)
  })

  it('clamps lyric steps to the document', () => {
    const live = stepLyrics(emptyLive(), 'clip', 5, 2)
    expect(live.slides.clip).toBe(1)
    expect(stepLyrics(live, 'clip', -9, 2).slides.clip).toBe(0)
  })

  it('clamps layer opacity and updates screens', () => {
    const show = loadedShow()
    const layer = show.layers[0]!.id
    expect(setLayerOpacity(show, layer, 2).layers[0]!.opacity).toBe(1)
    const screen = show.screens[0]!.id
    expect(updateScreen(show, screen, { lyrics: 'hidden' }).screens[0]!.lyrics).toBe('hidden')
  })
})

describe('screen scenes', () => {
  it('shows only the layers a screen is assigned, bottom to top', () => {
    const show = loadedShow()
    const live = launchColumn(show, emptyLive(), 0)
    const [main, wall] = show.screens
    const mainScene = composeScreenScene(show, live, main!, context)
    const kinds = mainScene.layers.map((layer) => layer.kind)
    expect(kinds.slice(0, 2)).toEqual(['video', 'image'])
    expect(kinds.slice(2).every((kind) => kind === 'text')).toBe(true)
    expect(mainScene.assets.map((asset) => asset.id).sort()).toEqual(['media_image', 'media_video'])

    const wallScene = composeScreenScene(show, live, wall!, context)
    expect(wallScene.layers.map((layer) => layer.kind)).toEqual(['video', 'image'])
  })

  it('restyles lyrics as a lower third', () => {
    const show = loadedShow()
    const live = launchColumn(show, emptyLive(), 0)
    const side = show.screens[2]!
    const text = composeScreenScene(show, live, side, context).layers.filter((layer) => layer.kind === 'text')
    expect(text.length).toBeGreaterThan(0)
    for (const layer of text) expect(layer.frame.y).toBeGreaterThan(0.7)
  })

  it('multiplies layer opacity and skips hidden layers and missing media', () => {
    let show = loadedShow()
    show = setLayerOpacity(show, show.layers[1]!.id, 0)
    show = assignClip(show, show.layers[0]!.id, 0, { kind: 'media', assetId: 'media_gone' }, 'Gone')
    show = setLayerOpacity(show, show.layers[2]!.id, 0.5)
    const live = launchColumn(show, emptyLive(), 0)
    const scene = composeScreenScene(show, live, show.screens[0]!, context)
    expect(scene.layers.every((layer) => layer.kind === 'text')).toBe(true)
    expect(scene.layers[0]!.opacity).toBeLessThanOrEqual(0.5)
  })

  it('renders a test pattern instead of content', () => {
    const show = updateScreen(loadedShow(), defaultShow().screens[0]!.id, {})
    const screen = { ...show.screens[0]!, testPattern: true }
    const scene = composeScreenScene(show, launchColumn(show, emptyLive(), 0), screen, context)
    expect(scene.layers.some((layer) => layer.id.startsWith('pattern-bar'))).toBe(true)
    expect(scene.assets).toHaveLength(0)
  })
})

describe('normalizeShow', () => {
  it('round-trips a show', () => {
    const show = loadedShow()
    expect(normalizeShow(JSON.parse(JSON.stringify(show)))).toEqual(show)
  })

  it('rejects non-shows and drops clips and screen layers for unknown layers', () => {
    expect(normalizeShow(null)).toBeNull()
    expect(normalizeShow({ schemaVersion: 2 })).toBeNull()
    const show = loadedShow()
    const broken = {
      ...show,
      clips: [...show.clips, { id: 'x', layerId: 'nope', column: 0, label: '', source: { kind: 'media', assetId: 'a' }, loop: true }],
      screens: [{ ...show.screens[0]!, layerIds: ['nope', show.layers[0]!.id], lyrics: 'weird' }],
    }
    const result = normalizeShow(broken)!
    expect(result.clips).toHaveLength(show.clips.length)
    expect(result.screens[0]!.layerIds).toEqual([show.layers[0]!.id])
    expect(result.screens[0]!.lyrics).toBe('full')
  })
})
