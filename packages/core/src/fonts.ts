import type { Composition, CompositionFont } from '@lumen/schema'

/**
 * Fonts a composition carries (render contract v2 § Fonts). Text elements
 * name a `fontId`; the composition lists one `CompositionFont` per id so the
 * renderer knows the family, the file and the fallbacks. There is no font
 * library yet: ids resolve through this catalog, and any other id is taken as
 * an installed family name. Paths starting with `builtin:` load nothing from
 * disk; the renderer looks the family up among installed fonts and otherwise
 * draws with its bundled default face (Inter).
 */

export const BUILTIN_FONT_PREFIX = 'builtin:'

/** Font id of the default text styles (`textSlide`, themes, the editor). */
export const DEFAULT_FONT_ID = 'inter'

const CATALOG: Record<string, { family: string; fallback: string[] }> = {
  // The renderer bundles Inter, so no system fallback is needed.
  inter: { family: 'Inter', fallback: [] },
}

/** The composition font for an id: a catalog entry, else the id as an installed family. */
export function fontForId(id: string): CompositionFont {
  const entry = CATALOG[id]
  return {
    id,
    family: entry?.family ?? id,
    path: `${BUILTIN_FONT_PREFIX}${id}`,
    hash: `${BUILTIN_FONT_PREFIX}${id}`,
    fallback: entry ? [...entry.fallback] : [],
  }
}

/** Font ids the composition's slide sources use, in first-use order. */
export function compositionFontIds(composition: Pick<Composition, 'sources'>): string[] {
  const ids = new Set<string>()
  for (const source of composition.sources) {
    if (source.kind !== 'slide') continue
    for (const element of source.elements) if (element.kind === 'text') ids.add(element.fontId)
  }
  return [...ids]
}

/**
 * The composition with a font entry for every font id its slides use. Fonts
 * already listed (a real file) are kept; unused entries stay too. Returns the
 * same object when nothing is missing.
 */
export function withCompositionFonts<T extends Composition>(composition: T): T {
  const known = new Set(composition.fonts.map((font) => font.id))
  const missing = compositionFontIds(composition).filter((id) => !known.has(id))
  if (missing.length === 0) return composition
  return { ...composition, fonts: [...composition.fonts, ...missing.map(fontForId)] }
}
