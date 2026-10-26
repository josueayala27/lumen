import type { PresentationDoc, Slide, SongSection } from '@lumen/schema'
import { splitSongLyrics, toSongSections } from './song'

export interface SongFields {
  title: string
  author: string
  ccli: string
  key: string
  tempo: number | null
  lyrics: string
}

export interface PresentationFields {
  title: string
  slideTexts: string[]
}

const DEFAULT_SETTINGS = {
  aspectRatio: '16:9' as const,
  width: 1920,
  height: 1080,
  safeArea: 0.05,
}

export function newId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}_${suffix}`
}

function textElement(text: string, id = newId('element')): Slide['elements'][number] {
  return {
    kind: 'text',
    id,
    frame: { x: 0.1, y: 0.16, w: 0.8, h: 0.68, rotation: 0 },
    z: 1,
    opacity: 1,
    runs: [{ text, bold: false, italic: false, underline: false, color: null }],
    style: {
      fontId: 'inter',
      fontSize: 64,
      weight: 600,
      italic: false,
      color: '#ffffff',
      align: 'center',
      lineHeight: 1.15,
      letterSpacing: 0,
    },
    layout: {
      align: 'center',
      vAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      fit: 'wrap',
      padding: 0,
      maxLines: null,
    },
    effects: { shadow: null, outline: null },
  }
}

export function textSlide(text: string, label: string | null = null, id = newId('slide')): Slide {
  const content = text.trim() || 'New slide'
  return {
    id,
    label,
    notes: '',
    background: { kind: 'solid', color: '#101828' },
    transition: null,
    elements: [textElement(content)],
  }
}

export function slideText(slide: Slide): string {
  const element = slide.elements.find((entry) => entry.kind === 'text')
  if (!element || element.kind !== 'text') return ''
  return element.runs.map((run) => run.text).join('\n')
}

export function setSlideText(slide: Slide, text: string): Slide {
  const element = slide.elements.find((entry) => entry.kind === 'text')
  if (element && element.kind === 'text') {
    return {
      ...slide,
      elements: slide.elements.map((entry) =>
        entry.id === element.id
          ? { ...entry, runs: [{ text, bold: false, italic: false, underline: false, color: null }] }
          : entry,
      ),
    }
  }
  return { ...slide, elements: [...slide.elements, textElement(text)] }
}

export function buildSongDoc(fields: SongFields): PresentationDoc {
  const title = fields.title.trim() || 'Untitled song'
  const sections: SongSection[] = toSongSections(fields.lyrics)
  const split = splitSongLyrics(fields.lyrics)
  const slides =
    split.length > 0
      ? split.map((slide) => textSlide(slide.text, slide.sectionLabel))
      : [textSlide('Add lyrics', 'Verse 1')]

  return {
    schemaVersion: 1,
    kind: 'song',
    title,
    themeId: null,
    settings: DEFAULT_SETTINGS,
    slides,
    song: {
      author: fields.author.trim(),
      ccli: fields.ccli.trim(),
      key: fields.key.trim(),
      tempo: fields.tempo,
      sections,
      arrangement: sections.map((section) => section.id),
    },
  }
}

export function updateSongDoc(doc: PresentationDoc, fields: SongFields): PresentationDoc {
  const next = buildSongDoc(fields)
  return {
    ...next,
    slides: next.slides.map((slide, index) => ({
      ...slide,
      id: doc.slides[index]?.id ?? slide.id,
    })),
  }
}

export function songFields(doc: PresentationDoc): SongFields {
  const lyrics = doc.song?.sections.length
    ? doc.song.sections.map((section) => `[${section.label}]\n${section.lyrics}`).join('\n\n')
    : ''
  return {
    title: doc.title,
    author: doc.song?.author ?? '',
    ccli: doc.song?.ccli ?? '',
    key: doc.song?.key ?? '',
    tempo: doc.song?.tempo ?? null,
    lyrics,
  }
}

export function buildBlankPresentation(title = 'Untitled presentation'): PresentationDoc {
  return {
    schemaVersion: 1,
    kind: 'presentation',
    title,
    themeId: null,
    settings: DEFAULT_SETTINGS,
    slides: [textSlide('New slide')],
    song: null,
  }
}

export function updatePresentationDoc(
  doc: PresentationDoc,
  fields: PresentationFields,
): PresentationDoc {
  const texts = fields.slideTexts.length > 0 ? fields.slideTexts : ['New slide']
  return {
    ...doc,
    title: fields.title.trim() || 'Untitled presentation',
    slides: texts.map((text, index) => {
      const existing = doc.slides[index]
      const slide = existing ?? textSlide(text)
      return { ...setSlideText(slide, text), id: slide.id }
    }),
  }
}
