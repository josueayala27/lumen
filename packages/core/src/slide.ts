import type {
  Background,
  Composition,
  CompositionAsset,
  Element,
  Layer,
  Paint,
  PresentationDoc,
  Slide,
  SlideElement,
  SlideSource,
  Source,
  Theme,
} from '@lumen/schema'
import { createComposition, createLayer } from './composition'

/**
 * Presentation slides as render contract v2 content: a slide's text, shape and
 * image elements become one `slide` source; video backgrounds and video
 * elements become `video` sources on their own layers. See
 * docs/architecture/02-render-contract.md § Sources.
 */

/** Element id of a slide's solid, gradient or image background inside its slide source. */
export const SLIDE_BACKGROUND_ID = 'slide-background'

const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1, rotation: 0 }

export function paintToCss(paint: Paint): string {
  switch (paint.kind) {
    case 'solid':
      return paint.color
    case 'linear': {
      const stops = paint.stops.map((stop) => `${stop.color} ${Math.round(stop.at * 100)}%`).join(', ')
      return `linear-gradient(${paint.angle}deg, ${stops})`
    }
    case 'none':
      return 'transparent'
  }
}

/** The slide's own background, or the theme's when the slide has none. */
export function slideBackground(slide: Slide, theme: Theme | null): Background {
  return slide.background.kind === 'transparent' && theme ? theme.background : slide.background
}

/** A solid, gradient or image background as the bottom slide element; null otherwise. */
export function backgroundElement(background: Background): SlideElement | null {
  const base = { id: SLIDE_BACKGROUND_ID, frame: { ...FULL_FRAME }, z: -1000 }
  switch (background.kind) {
    case 'solid':
    case 'gradient':
      return {
        ...base,
        kind: 'shape',
        opacity: 1,
        fill: background.kind === 'solid' ? background.color : paintToCss(background.paint),
        stroke: null,
        strokeWidth: 0,
        radius: 0,
      }
    case 'image':
      return { ...base, kind: 'image', opacity: 1 - background.dim, source: background.source, fit: background.fit, radius: 0 }
    case 'transparent':
    case 'video':
      return null
  }
}

/** A presentation element as a slide element; videos return null (they are sources). */
export function slideElement(element: Element): SlideElement | null {
  const base = { id: element.id, frame: element.frame, z: element.z, opacity: element.opacity }
  switch (element.kind) {
    case 'text':
      return {
        ...base,
        kind: 'text',
        runs: element.runs,
        fontId: element.style.fontId,
        fontSize: element.style.fontSize,
        weight: element.style.weight,
        color: element.style.color,
        align: element.style.align,
        vAlign: element.layout.vAlign,
        lineHeight: element.style.lineHeight,
        letterSpacing: element.style.letterSpacing,
        fit: element.layout.fit,
        padding: element.layout.padding,
        maxLines: element.layout.maxLines,
        shadow: element.effects.shadow,
        outline: element.effects.outline,
      }
    case 'shape':
      return {
        ...base,
        kind: 'shape',
        fill: paintToCss(element.fill),
        stroke: element.stroke ? paintToCss(element.stroke) : null,
        strokeWidth: element.strokeWidth,
        radius: element.radius,
      }
    case 'image':
      return { ...base, kind: 'image', source: element.source, fit: element.fit, radius: element.radius }
    case 'video':
      return null
  }
}

/** Elements bottom to top; equal `z` keeps document order. */
function orderedElements(slide: Slide): Element[] {
  return slide.elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
    .map(({ element }) => element)
}

function clampIndex(doc: PresentationDoc, slideIndex: number): number {
  return Math.min(Math.max(0, slideIndex), doc.slides.length - 1)
}

function slideSize(doc: PresentationDoc): { width: number; height: number } {
  return { width: doc.settings.width, height: doc.settings.height }
}

function safeArea(doc: PresentationDoc) {
  const safe = doc.settings.safeArea
  return { top: safe, right: safe, bottom: safe, left: safe }
}

/**
 * The slide at `slideIndex` (clamped) as one `slide` source: its background
 * (or the theme's) and every text, shape and image element. Video backgrounds
 * and video elements are left out; `slideComposition` places them.
 */
export function presentationSlideSource(
  id: string,
  doc: PresentationDoc,
  slideIndex: number,
  theme: Theme | null,
  revision = slideIndex,
): SlideSource | null {
  if (doc.slides.length === 0) return null
  const slide = doc.slides[clampIndex(doc, slideIndex)]!
  const background = backgroundElement(slideBackground(slide, theme))
  const elements = orderedElements(slide)
    .map(slideElement)
    .filter((element): element is SlideElement => element !== null)
  return {
    id,
    name: doc.title,
    kind: 'slide',
    revision,
    elements: background ? [background, ...elements] : elements,
    safeArea: safeArea(doc),
    size: slideSize(doc),
  }
}

export interface SlideCompositionOptions {
  /** Media the document references, resolved (see `assetsForDoc` in the studio). */
  assets?: CompositionAsset[]
  revision?: number
  /** Tag on the slide content layers. Defaults to `content`. */
  contentTag?: string
}

/** Id of the full-canvas layer (and its source) that draws slide elements group `index`. */
export function slideContentLayerId(index: number): string {
  return `slide-content-${index}`
}

/**
 * One slide as a whole composition on a canvas the size of the document, for
 * the editor and the stage display. Bottom to top: a video background layer,
 * then the elements in `z` order. Runs of text, shape and image elements share
 * one `slide` source on a full-canvas layer (`slide-content-<n>`, tagged
 * `content`); each video element is a `video` source on a layer whose id is
 * the element id, placed at the element frame. Element ids stay element ids in
 * the preview bounds: slide elements by `elementId`, videos by `layerId`.
 */
export function slideComposition(
  doc: PresentationDoc,
  slideIndex: number,
  theme: Theme | null,
  options: SlideCompositionOptions = {},
): Composition {
  const revision = options.revision ?? 0
  const composition = createComposition(slideSize(doc))
  composition.revision = revision
  composition.assets = [...(options.assets ?? [])]
  if (doc.slides.length === 0) return composition

  const slide = doc.slides[clampIndex(doc, slideIndex)]!
  const tag = options.contentTag ?? 'content'
  const sources: Source[] = []
  const layers: Layer[] = []
  const background = slideBackground(slide, theme)
  if (background.kind === 'video') {
    sources.push({
      id: SLIDE_BACKGROUND_ID,
      name: 'Background',
      kind: 'video',
      asset: background.source,
      loop: background.loop,
      inMs: 0,
      outMs: null,
      rate: 1,
      reverse: false,
      muted: background.muted,
      volume: background.volume,
    })
    layers.push(createLayer({ id: SLIDE_BACKGROUND_ID, name: 'Background', sourceId: SLIDE_BACKGROUND_ID, fit: background.fit, tags: ['background'] }))
  }

  let group: SlideElement[] = []
  const first = backgroundElement(background)
  if (first) group.push(first)
  const flush = (): void => {
    if (group.length === 0) return
    const id = slideContentLayerId(layers.filter((layer) => layer.id.startsWith('slide-content-')).length)
    sources.push({ id, name: doc.title, kind: 'slide', revision, elements: group, safeArea: safeArea(doc), size: slideSize(doc) })
    layers.push(createLayer({ id, name: 'Slide', sourceId: id, fit: 'stretch', tags: [tag] }))
    group = []
  }
  for (const element of orderedElements(slide)) {
    if (element.kind !== 'video') {
      const converted = slideElement(element)
      if (converted) group.push(converted)
      continue
    }
    flush()
    const id = `video-${element.id}`
    sources.push({
      id,
      name: 'Video',
      kind: 'video',
      asset: element.source,
      loop: element.loop,
      inMs: element.startMs,
      outMs: null,
      rate: 1,
      reverse: false,
      muted: element.muted,
      volume: element.volume,
    })
    const { x, y, w, h, rotation } = element.frame
    layers.push(
      createLayer({ id: element.id, name: 'Video', sourceId: id, fit: element.fit, opacity: element.opacity, transform: { x, y, w, h, rotation }, tags: [tag] }),
    )
  }
  flush()
  return { ...composition, sources, layers }
}
