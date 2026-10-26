import type { SongSection } from '@lumen/schema'

export interface SongSectionInput {
  label: string
  lyrics: string
}

export interface SplitOptions {
  maxLines?: number
  maxChars?: number
}

export interface SongSlide {
  sectionId: string
  sectionLabel: string
  lines: string[]
  text: string
}

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/
const DEFAULT_MAX_LINES = 4
const DEFAULT_MAX_CHARS = 42

export function parseSongSections(input: string): SongSectionInput[] {
  const sections: SongSectionInput[] = []
  let label = 'Verse 1'
  let lines: string[] = []

  const flush = () => {
    const lyrics = lines.join('\n').trim()
    if (lyrics) sections.push({ label, lyrics })
    lines = []
  }

  for (const raw of input.replace(/\r\n/g, '\n').split('\n')) {
    const match = SECTION_RE.exec(raw)
    if (match) {
      flush()
      label = match[1]!.trim()
      continue
    }
    lines.push(raw)
  }
  flush()
  return sections
}

function splitSection(section: SongSectionInput, maxLines: number, maxChars: number): SongSlide[] {
  const slides: SongSlide[] = []
  let current: string[] = []
  const sectionId = slug(section.label)

  const push = () => {
    if (!current.length) return
    slides.push({ sectionId, sectionLabel: section.label, lines: current, text: current.join('\n') })
    current = []
  }

  for (const rawLine of section.lyrics.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      push()
      continue
    }
    const chunks = wrapLine(line, maxChars)
    for (const chunk of chunks) {
      if (current.length >= maxLines) push()
      current.push(chunk)
    }
  }
  push()

  return slides.length
    ? slides
    : [{ sectionId, sectionLabel: section.label, lines: [], text: section.lyrics }]
}

export function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line]
  const words = line.split(/\s+/)
  const out: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      out.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) out.push(current)
  return out
}

export function splitSongLyrics(input: string, options: SplitOptions = {}): SongSlide[] {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  return parseSongSections(input).flatMap((section) => splitSection(section, maxLines, maxChars))
}

export function toSongSections(input: string): SongSection[] {
  return parseSongSections(input).map((section) => ({
    id: slug(section.label),
    label: section.label,
    lyrics: section.lyrics,
  }))
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section'
}
