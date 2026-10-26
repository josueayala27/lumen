import { describe, expect, it } from 'vitest'
import { themeSchema, type Element } from '@lumen/schema'
import {
  applyThemeToDoc,
  buildTheme,
  defaultTheme,
  defaultThemes,
  DEFAULT_BACKGROUND,
  DEFAULT_THEME_NAME,
  themeTextStyleForSlide,
  validateTheme,
} from '../src/theme'
import { buildBlankPresentation, textSlide } from '../src/presentation'

describe('theme defaults', () => {
  it('builds a valid dark theme', () => {
    const theme = defaultTheme()
    expect(themeSchema.safeParse(theme).success).toBe(true)
    expect(theme.schemaVersion).toBe(1)
    expect(theme.name).toBe(DEFAULT_THEME_NAME)
    expect(theme.background).toEqual({ kind: 'solid', color: DEFAULT_BACKGROUND })
    expect(theme.textStyles.body.fontId).toBe('inter')
    expect(theme.textStyles.body.color).toBe('#ffffff')
    expect(theme.textStyles.title.fontSize).toBeGreaterThan(theme.textStyles.body.fontSize)
    expect(theme.transition.kind).toBe('fade')
  })

  it('returns fresh theme objects', () => {
    const first = defaultTheme()
    first.textStyles.body.fontSize = 12
    expect(defaultTheme().textStyles.body.fontSize).toBe(64)
  })

  it('merges partial overrides without touching the defaults', () => {
    const theme = buildTheme({
      name: '  Chapel  ',
      title: { weight: 800, color: '#fef3c7' },
      body: { align: 'left' },
      transition: { kind: 'slide' },
    })
    expect(theme.name).toBe('Chapel')
    expect(theme.textStyles.title.weight).toBe(800)
    expect(theme.textStyles.title.color).toBe('#fef3c7')
    expect(theme.textStyles.title.fontSize).toBe(96)
    expect(theme.textStyles.body.align).toBe('left')
    expect(theme.textStyles.body.fontSize).toBe(64)
    expect(theme.transition).toMatchObject({ kind: 'slide', durationMs: 300 })
    expect(defaultTheme().textStyles.title.weight).toBe(700)
  })

  it('offers two built-in themes', () => {
    const themes = defaultThemes()
    expect(themes).toHaveLength(2)
    expect(themes.map((theme) => theme.name)).toEqual(['Default dark', 'Default light'])
    for (const theme of themes) expect(themeSchema.safeParse(theme).success).toBe(true)
  })

  it('rejects invalid themes', () => {
    expect(validateTheme(null)).toBeNull()
    expect(validateTheme({ schemaVersion: 2 })).toBeNull()
    expect(validateTheme(defaultTheme())).toEqual(defaultTheme())
  })
})

describe('applyThemeToDoc', () => {
  it('sets the theme id, slide backgrounds and body text style', () => {
    const doc = buildBlankPresentation('Sunday')
    const theme = defaultTheme('Warm')
    const next = applyThemeToDoc(doc, theme, 'theme_warm')

    expect(next.themeId).toBe('theme_warm')
    expect(next.slides).toHaveLength(doc.slides.length)
    for (const slide of next.slides) {
      expect(slide.background).toEqual(theme.background)
    }

    const text = next.slides[0]!.elements.find((element) => element.kind === 'text')
    expect(text?.kind).toBe('text')
    if (text?.kind !== 'text') return
    expect(text.style).toEqual(theme.textStyles.body)
    expect(text.layout.align).toBe(theme.textStyles.body.align)
    expect(text.layout.lineHeight).toBe(theme.textStyles.body.lineHeight)
  })

  it('uses an embedded theme id when no explicit id is passed', () => {
    const doc = buildBlankPresentation()
    const next = applyThemeToDoc(doc, { ...defaultTheme(), id: 'theme_embedded' })
    expect(next.themeId).toBe('theme_embedded')
  })

  it('keeps the current theme id for a plain theme without an id', () => {
    const current = { ...buildBlankPresentation(), themeId: 'theme_old' }
    const next = applyThemeToDoc(current, defaultTheme('New'))
    expect(next.themeId).toBe('theme_old')
  })

  it('applies the title style to title slides and leaves non-text elements alone', () => {
    const shape: Element = {
      kind: 'shape',
      id: 'shape_1',
      frame: { x: 0, y: 0, w: 0.5, h: 0.5, rotation: 0 },
      z: 2,
      opacity: 1,
      fill: { kind: 'solid', color: '#22c55e' },
      stroke: null,
      strokeWidth: 0,
      radius: 0,
    }
    const base = buildBlankPresentation()
    const titleSlide = textSlide('Welcome', 'Title')
    const doc = {
      ...base,
      slides: [
        { ...titleSlide, elements: [...titleSlide.elements, shape] },
        { ...textSlide('Lyrics', 'Verse 1'), notes: 'Hold for 4 bars' },
      ],
    }
    const theme = defaultTheme()
    const next = applyThemeToDoc(doc, theme, 'theme_dark')

    const titleElement = next.slides[0]!.elements.find((element) => element.kind === 'text')
    expect(titleElement?.kind).toBe('text')
    if (titleElement?.kind === 'text') expect(titleElement.style).toEqual(theme.textStyles.title)
    expect(next.slides[0]!.elements.find((element) => element.kind === 'shape')).toEqual(shape)

    expect(next.slides[1]!.notes).toBe('Hold for 4 bars')
    expect(next.slides[0]!.id).toBe(doc.slides[0]!.id)
    expect(themeTextStyleForSlide(theme, doc.slides[1]!)).toEqual(theme.textStyles.body)
    expect(themeTextStyleForSlide(theme, doc.slides[0]!)).toEqual(theme.textStyles.title)
  })

  it('does not mutate the document or share background objects with the theme', () => {
    const doc = buildBlankPresentation()
    const before = JSON.parse(JSON.stringify(doc)) as unknown
    const theme = buildTheme({
      background: {
        kind: 'gradient',
        paint: {
          kind: 'linear',
          angle: 90,
          stops: [
            { at: 0, color: '#000000' },
            { at: 1, color: '#ffffff' },
          ],
        },
      },
    })
    const next = applyThemeToDoc(doc, theme, 'theme_gradient')

    expect(doc).toEqual(before)
    expect(next).not.toBe(doc)
    next.slides[0]!.background = { kind: 'solid', color: '#ff0000' }
    expect(theme.background.kind).toBe('gradient')
  })

  it('preserves text runs while replacing the style', () => {
    const doc = buildBlankPresentation()
    const element = doc.slides[0]!.elements[0]!
    expect(element.kind).toBe('text')
    if (element.kind !== 'text') return
    const runs = [{ text: 'Bold run', bold: true, italic: false, underline: false, color: '#f97316' }]
    element.runs = runs

    const next = applyThemeToDoc(doc, defaultTheme(), 'theme_dark')
    const text = next.slides[0]!.elements[0]!
    expect(text.kind).toBe('text')
    if (text.kind === 'text') expect(text.runs).toEqual(runs)
  })
})
