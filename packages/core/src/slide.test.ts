import { compositionSchema, type Element, type PresentationDoc, type Theme } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import { buildSongDoc, textSlide } from './presentation'
import { defaultTheme } from './theme'
import { presentationSlideSource, slideComposition, slideElement, SLIDE_BACKGROUND_ID } from './slide'

const video = { assetId: 'media_video', hash: 'hash-video' }

function videoElement(id: string, z: number): Element {
  return {
    kind: 'video',
    id,
    frame: { x: 0.5, y: 0.5, w: 0.25, h: 0.25, rotation: 10 },
    z,
    opacity: 0.8,
    source: video,
    fit: 'contain',
    loop: false,
    muted: true,
    volume: 1,
    startMs: 250,
  }
}

function doc(): PresentationDoc {
  const song = buildSongDoc({ title: 'Song', author: '', ccli: '', key: '', tempo: null, lyrics: 'One\nTwo\n\nThree' })
  return { ...song, slides: song.slides.map((slide) => ({ ...slide, background: { kind: 'solid', color: '#112233' } })) }
}

describe('presentationSlideSource', () => {
  it('turns the background and elements into one slide source', () => {
    const source = presentationSlideSource('s', doc(), 1, null)!
    expect(source.kind).toBe('slide')
    expect(source.revision).toBe(1)
    expect(source.size).toEqual({ width: 1920, height: 1080 })
    expect(source.elements[0]).toMatchObject({ id: SLIDE_BACKGROUND_ID, kind: 'shape', fill: '#112233' })
    expect(source.elements.slice(1).every((element) => element.kind === 'text')).toBe(true)
  })

  it('uses the theme background for transparent slides and clamps the index', () => {
    const theme: Theme = { ...defaultTheme(), background: { kind: 'solid', color: '#abcdef' } }
    const plain = { ...doc(), slides: [{ ...textSlide('Hi'), background: { kind: 'transparent' as const } }] }
    const source = presentationSlideSource('s', plain, 9, theme)!
    expect(source.elements[0]).toMatchObject({ kind: 'shape', fill: '#abcdef' })
    expect(presentationSlideSource('s', { ...plain, slides: [] }, 0, theme)).toBeNull()
  })

  it('leaves video elements out', () => {
    expect(slideElement(videoElement('v', 0))).toBeNull()
  })
})

describe('slideComposition', () => {
  it('splits slide elements around videos and keeps z order', () => {
    const base = doc()
    const slide = base.slides[0]!
    const text = slide.elements[0]!
    const withVideo: PresentationDoc = {
      ...base,
      slides: [{ ...slide, background: { kind: 'video', source: video, fit: 'cover', loop: true, muted: true, volume: 1 }, elements: [{ ...text, z: 5 }, videoElement('clip', 1)] }],
    }
    const composition = slideComposition(withVideo, 0, null, { revision: 3, assets: [] })
    expect(compositionSchema.safeParse(composition).success).toBe(true)
    expect(composition.revision).toBe(3)
    expect(composition.layers.map((layer) => layer.id)).toEqual([SLIDE_BACKGROUND_ID, 'clip', 'slide-content-0'])
    const clip = composition.layers[1]!
    expect(clip).toMatchObject({ fit: 'contain', opacity: 0.8, transform: { x: 0.5, y: 0.5, w: 0.25, h: 0.25, rotation: 10 }, tags: ['content'] })
    const clipSource = composition.sources.find((source) => source.id === clip.sourceId)
    expect(clipSource).toMatchObject({ kind: 'video', inMs: 250, loop: false })
    const content = composition.sources.find((source) => source.id === 'slide-content-0')
    expect(content?.kind === 'slide' && content.elements.map((element) => element.id)).toEqual([text.id])
  })

  it('puts a solid background in the first slide source', () => {
    const composition = slideComposition(doc(), 0, null, { contentTag: 'lyrics' })
    expect(composition.layers).toHaveLength(1)
    expect(composition.layers[0]!.tags).toEqual(['lyrics'])
    const source = composition.sources[0]!
    expect(source.kind === 'slide' && source.elements[0]!.id).toBe(SLIDE_BACKGROUND_ID)
  })
})
