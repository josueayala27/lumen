import { addSource, buildSongDoc, createLayer, setMasterOpacity } from '@lumen/core'
import type { PresentationDoc } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import type { MediaAssetLike } from '~/live/liveContent'
import { presetText, schematicFrame } from './schematic'
import {
  assignClip,
  createShowDoc,
  emptyLive,
  launchColumn,
  liveComposition,
  updateScreen,
  updateScreenLayout,
  withComposition,
  type ComposeContext,
  type ShowDoc,
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

function playing(show: ShowDoc) {
  return liveComposition(show, launchColumn(show, emptyLive(), 0), context)
}

describe('schematicFrame', () => {
  it('draws each screen through its layer filter', () => {
    const show = loadedShow()
    const [main, wall] = show.screens
    const frame = schematicFrame(playing(show), main!)
    expect(frame.background).toBe('#000000')
    expect(frame.layers.slice(0, 2).map((layer) => layer.kind)).toEqual(['video', 'image'])
    expect(frame.layers.slice(2).some((layer) => layer.kind === 'text' && layer.text.includes('First line'))).toBe(true)
    expect(schematicFrame(playing(show), wall!).layers.map((layer) => layer.kind)).toEqual(['video', 'image'])
  })

  it('multiplies layer and master opacity into slide elements', () => {
    let show = loadedShow()
    const lyrics = show.composition.layers[2]!.id
    show = withComposition(show, (composition) => ({
      ...setMasterOpacity(composition, 0.5),
      layers: composition.layers.map((layer) => (layer.id === lyrics ? { ...layer, opacity: 0.5 } : layer)),
    }))
    const text = schematicFrame(playing(show), show.screens[0]!).layers.filter((layer) => layer.kind === 'text')
    expect(text.length).toBeGreaterThan(0)
    for (const layer of text) expect(layer.opacity).toBeLessThanOrEqual(0.25)
  })

  it('shows the bare canvas without a screen', () => {
    const frame = schematicFrame(playing(loadedShow()), null)
    expect(frame.layers.slice(0, 2).map((layer) => layer.kind)).toEqual(['video', 'image'])
  })

  it('crops to the region, moves text by preset and uses the layout background', () => {
    const base = loadedShow()
    const id = base.screens[0]!.id
    let show = updateScreenLayout(base, id, { region: { x: 0.5, y: 0, w: 0.5, h: 1 }, background: '#112233' })
    show = updateScreenLayout(show, id, { text: { preset: 'lowerThird', scale: 1, color: null } })
    const frame = schematicFrame(playing(show), show.screens[0]!)
    expect(frame.background).toBe('#112233')
    expect(frame.layers[0]).toMatchObject({ kind: 'video', x: -1, w: 2 })
    const text = frame.layers.filter((layer) => layer.kind === 'text')
    for (const layer of text) expect(layer.y).toBeGreaterThan(0.7)
    const hidden = updateScreenLayout(show, id, { text: { preset: 'hidden', scale: 1, color: null } })
    expect(schematicFrame(playing(hidden), hidden.screens[0]!).layers.some((layer) => layer.kind === 'text')).toBe(false)
  })

  it('shows every line of a verse on a strip, joined on one line', () => {
    const base = loadedShow()
    const id = base.screens[0]!.id
    const show = updateScreenLayout(base, id, { text: { preset: 'strip', scale: 1, color: null } })
    const text = schematicFrame(playing(show), show.screens[0]!).layers.filter((layer) => layer.kind === 'text')
    expect(text.length).toBeGreaterThan(0)
    for (const layer of text) expect(layer.text).not.toContain('\n')
    expect(text.map((layer) => layer.text).join(' ')).toContain('First line / Second line')

    const element = {
      kind: 'text',
      runs: [{ text: 'Line one\nLine two\n' }, { text: 'Line three' }, { text: '\r\n\nLine four' }],
    } as Parameters<typeof presetText>[0]
    expect(presetText(element, 'strip')).toBe('Line one / Line two / Line three / Line four')
    expect(presetText(element, 'lowerThird').split('\n').filter(Boolean)).toHaveLength(4)
  })

  it('fills solids, gradients and generators and skips disabled layers', () => {
    let show = createShowDoc()
    show = withComposition(show, (composition) => {
      let next = addSource(composition, { id: 'red', name: '', kind: 'solid', color: '#ff0000' })
      next = addSource(next, { id: 'ramp', name: '', kind: 'gradient', gradient: 'linear', angle: 90, stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] })
      next = addSource(next, { id: 'plasma', name: '', kind: 'shader', shaderId: 'plasma', params: {} })
      return {
        ...next,
        layers: [
          createLayer({ id: 'a', sourceId: 'red' }),
          createLayer({ id: 'b', sourceId: 'ramp' }),
          createLayer({ id: 'c', sourceId: 'plasma' }),
          createLayer({ id: 'd', sourceId: 'red', enabled: false }),
          createLayer({ id: 'e' }),
        ],
      }
    })
    const frame = schematicFrame(show.composition, null)
    expect(frame.layers.map((layer) => layer.id)).toEqual(['a', 'b', 'c'])
    expect(frame.layers[0]!.fill).toBe('#ff0000')
    expect(frame.layers[1]!.fill).toBe('linear-gradient(90deg, #000 0%, #fff 100%)')
    expect(frame.layers[2]!.fill).toContain('gradient')
  })

  it('blacks out and draws test patterns instead of content', () => {
    const base = loadedShow()
    const id = base.screens[0]!.id
    const black = updateScreen(base, id, { blackout: true })
    expect(schematicFrame(playing(black), black.screens[0]!)).toEqual({ background: '#000000', layers: [] })
    const bars = updateScreen(base, id, { testPattern: 'bars' })
    const frame = schematicFrame(playing(bars), bars.screens[0]!)
    expect(frame.layers.some((layer) => layer.id.startsWith('pattern-bar'))).toBe(true)
    expect(frame.layers.find((layer) => layer.kind === 'text')?.text).toBe(bars.screens[0]!.name)
  })
})
