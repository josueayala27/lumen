import {
  themeSchema,
  type Background,
  type Paint,
  type PresentationDoc,
  type Slide,
  type TextStyle,
  type Theme,
  type Transition,
} from '@lumen/schema'

/** A theme with the persisted row id attached. */
export type ThemeWithId = Theme & { id: string }

export interface ThemeInput {
  name?: string
  background?: Background
  /** Partial overrides merged over the default title style. */
  title?: Partial<TextStyle>
  /** Partial overrides merged over the default body style. */
  body?: Partial<TextStyle>
  transition?: Partial<Transition>
}

export const DEFAULT_THEME_NAME = 'Default dark'
export const DEFAULT_BACKGROUND = '#101828'
export const DEFAULT_TEXT_COLOR = '#ffffff'

const TITLE_STYLE: TextStyle = {
  fontId: 'inter',
  fontSize: 96,
  weight: 700,
  italic: false,
  color: DEFAULT_TEXT_COLOR,
  align: 'center',
  lineHeight: 1.05,
  letterSpacing: 0,
}

const BODY_STYLE: TextStyle = {
  fontId: 'inter',
  fontSize: 64,
  weight: 600,
  italic: false,
  color: DEFAULT_TEXT_COLOR,
  align: 'center',
  lineHeight: 1.15,
  letterSpacing: 0,
}

const DEFAULT_TRANSITION: Transition = {
  kind: 'fade',
  durationMs: 300,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
}

function solidBackground(color: string): Background {
  return { kind: 'solid', color }
}

/** Deep clones a background so slides never share arrays/objects with the theme. */
function cloneBackground(background: Background): Background {
  switch (background.kind) {
    case 'transparent':
      return { kind: 'transparent' }
    case 'solid':
      return { kind: 'solid', color: background.color }
    case 'gradient':
      return { kind: 'gradient', paint: clonePaint(background.paint) }
    case 'image':
      return { ...background, source: { ...background.source } }
    case 'video':
      return { ...background, source: { ...background.source } }
  }
}

function clonePaint(paint: Paint): Paint {
  switch (paint.kind) {
    case 'solid':
      return { kind: 'solid', color: paint.color }
    case 'linear':
      return { kind: 'linear', angle: paint.angle, stops: paint.stops.map((stop) => ({ ...stop })) }
    case 'none':
      return { kind: 'none' }
  }
}

/**
 * Builds a complete theme from the dark defaults. Nested style overrides merge
 * over the defaults, so callers can change one property without restating the rest.
 */
export function buildTheme(input: ThemeInput = {}): Theme {
  return themeSchema.parse({
    schemaVersion: 1,
    name: input.name?.trim() || DEFAULT_THEME_NAME,
    background: input.background ?? solidBackground(DEFAULT_BACKGROUND),
    textStyles: {
      title: { ...TITLE_STYLE, ...input.title },
      body: { ...BODY_STYLE, ...input.body },
    },
    transition: { ...DEFAULT_TRANSITION, ...input.transition },
  })
}

/** The default dark theme. Returns a fresh object on every call. */
export function defaultTheme(name = DEFAULT_THEME_NAME): Theme {
  return buildTheme({ name })
}

/** Built-in themes offered when the theme list is empty. */
export function defaultThemes(): Theme[] {
  return [
    defaultTheme(),
    buildTheme({
      name: 'Default light',
      background: solidBackground('#f8fafc'),
      title: { color: '#0f172a' },
      body: { color: '#1d2939' },
      transition: { kind: 'dissolve', durationMs: 400 },
    }),
  ]
}

/** Parses and fully defaults an unknown theme value. Corrupt values return `null`. */
export function validateTheme(value: unknown): Theme | null {
  const parsed = themeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Title slides do not exist as an element kind yet. Slides explicitly labelled
 * "Title" preview the theme title style; every other slide uses the body style.
 */
export function themeTextStyleForSlide(theme: Theme, slide: Slide): TextStyle {
  return slide.label?.trim().toLowerCase() === 'title'
    ? theme.textStyles.title
    : theme.textStyles.body
}

/**
 * Applies a theme to a document: sets the theme id, replaces every slide
 * background and restyles every text element. Shape, image and video elements,
 * notes, runs and slide ids are preserved. The input document is not mutated.
 *
 * The theme id comes from the optional third argument, then from `theme.id`
 * when a {@link ThemeWithId} is passed, then from the document's current id.
 */
export function applyThemeToDoc(
  doc: PresentationDoc,
  theme: Theme | ThemeWithId,
  themeId?: string | null,
): PresentationDoc {
  const embeddedId = (theme as ThemeWithId).id
  const nextThemeId =
    themeId !== undefined
      ? themeId
      : typeof embeddedId === 'string' && embeddedId.length > 0
        ? embeddedId
        : doc.themeId

  return {
    ...doc,
    themeId: nextThemeId,
    slides: doc.slides.map((slide) => {
      const style = themeTextStyleForSlide(theme, slide)
      return {
        ...slide,
        background: cloneBackground(theme.background),
        elements: slide.elements.map((element) =>
          element.kind === 'text'
            ? {
                ...element,
                style: { ...style },
                layout: {
                  ...element.layout,
                  align: style.align,
                  lineHeight: style.lineHeight,
                  letterSpacing: style.letterSpacing,
                },
              }
            : element,
        ),
      }
    }),
  }
}
