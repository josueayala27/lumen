import { describe, expect, it } from 'vitest'
import {
  buildBlankPresentation,
  buildSongDoc,
  setSlideText,
  slideText,
  songFields,
  textSlide,
  updatePresentationDoc,
  updateSongDoc,
} from '../src/presentation'

const lyrics = '[Verse 1]\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nI once was lost but now am found'

describe('song documents', () => {
  it('builds slides from lyric sections', () => {
    const doc = buildSongDoc({
      title: 'Amazing Grace',
      author: 'John Newton',
      ccli: '22025',
      key: 'G',
      tempo: 72,
      lyrics,
    })
    expect(doc.kind).toBe('song')
    expect(doc.slides.length).toBeGreaterThanOrEqual(2)
    expect(doc.slides[0]?.label).toBe('Verse 1')
    expect(doc.song?.sections.map((section) => section.label)).toEqual(['Verse 1', 'Chorus'])
    expect(doc.song?.author).toBe('John Newton')
    expect(slideText(doc.slides[0]!)).toContain('Amazing grace')
  })

  it('round-trips editable song fields', () => {
    const doc = buildSongDoc({
      title: 'Amazing Grace',
      author: 'John Newton',
      ccli: '22025',
      key: 'G',
      tempo: 72,
      lyrics,
    })
    const fields = songFields(doc)
    expect(fields.title).toBe('Amazing Grace')
    expect(fields.lyrics).toContain('[Chorus]')
    expect(songFields(buildSongDoc(fields)).lyrics).toBe(fields.lyrics)
  })

  it('preserves slide ids when lyrics split the same way', () => {
    const first = buildSongDoc({
      title: 'Song',
      author: '',
      ccli: '',
      key: '',
      tempo: null,
      lyrics,
    })
    const next = updateSongDoc(first, {
      title: 'Song',
      author: '',
      ccli: '',
      key: '',
      tempo: null,
      lyrics: lyrics.replace('Amazing', 'Amazing!'),
    })
    expect(next.slides.map((slide) => slide.id)).toEqual(first.slides.map((slide) => slide.id))
    expect(slideText(next.slides[0]!)).toContain('Amazing!')
  })
})

describe('presentation documents', () => {
  it('edits slide text and keeps ids', () => {
    const doc = buildBlankPresentation('Test')
    const slideId = doc.slides[0]!.id
    const next = updatePresentationDoc(doc, { title: 'Updated', slideTexts: ['One', 'Two'] })
    expect(next.title).toBe('Updated')
    expect(next.slides).toHaveLength(2)
    expect(next.slides[0]?.id).toBe(slideId)
    expect(slideText(next.slides[1]!)).toBe('Two')
  })

  it('adds a text element to a slide', () => {
    const slide = textSlide('One')
    const withoutText = { ...slide, elements: [] }
    expect(slideText(setSlideText(withoutText, 'New'))).toBe('New')
  })
})
