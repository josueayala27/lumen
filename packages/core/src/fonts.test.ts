import { describe, expect, it } from 'vitest'
import { buildBlankPresentation, updatePresentationDoc } from './presentation'
import { BUILTIN_FONT_PREFIX, compositionFontIds, fontForId, withCompositionFonts } from './fonts'
import { slideComposition } from './slide'

describe('composition fonts', () => {
  it('resolves catalog ids and treats other ids as installed families', () => {
    expect(fontForId('inter')).toEqual({ id: 'inter', family: 'Inter', path: `${BUILTIN_FONT_PREFIX}inter`, hash: `${BUILTIN_FONT_PREFIX}inter`, fallback: [] })
    expect(fontForId('Georgia')).toMatchObject({ id: 'Georgia', family: 'Georgia' })
  })

  it('slide compositions carry the fonts their text uses', () => {
    const doc = updatePresentationDoc(buildBlankPresentation('Talk'), { title: 'Talk', slideTexts: ['Hello'] })
    const composition = slideComposition(doc, 0, null)
    expect(compositionFontIds(composition)).toEqual(['inter'])
    expect(composition.fonts.map((font) => font.id)).toEqual(['inter'])
  })

  it('keeps fonts already listed and returns the same object when nothing is missing', () => {
    const doc = updatePresentationDoc(buildBlankPresentation('Talk'), { title: 'Talk', slideTexts: ['Hello'] })
    const composition = slideComposition(doc, 0, null)
    const file = { id: 'inter', family: 'Inter Display', path: '/fonts/inter.ttf', hash: 'abc', fallback: [] }
    const listed = { ...composition, fonts: [file] }
    expect(withCompositionFonts(listed)).toBe(listed)
  })
})
