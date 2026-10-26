import { describe, expect, it } from 'vitest'
import { parseSongSections, splitSongLyrics, wrapLine } from '../src/song'

describe('song splitting', () => {
  it('parses section markers and keeps labels', () => {
    const sections = parseSongSections('[Verse 1]\nAmazing grace\n\n[Chorus]\nHow sweet')
    expect(sections.map((section) => section.label)).toEqual(['Verse 1', 'Chorus'])
    expect(sections[1]?.lyrics).toBe('How sweet')
  })

  it('splits long sections by line count', () => {
    const slides = splitSongLyrics('[Verse 1]\none\ntwo\nthree\nfour\nfive', { maxLines: 2, maxChars: 40 })
    expect(slides.map((slide) => slide.lines)).toEqual([['one', 'two'], ['three', 'four'], ['five']])
  })

  it('wraps a line that exceeds the character budget', () => {
    expect(wrapLine('grace grace grace grace', 12)).toEqual(['grace grace', 'grace grace'])
  })
})
