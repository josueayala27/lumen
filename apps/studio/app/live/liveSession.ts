import { liveReducer, newId, slideText, type LiveContext } from '@lumen/core'
import type {
  LiveCommand,
  LiveState,
  PlaylistDoc,
  PresentationDoc,
} from '@lumen/schema'
import { defaultTimers } from './liveTimers'

export interface LiveSlide {
  id: string
  label: string
  lines: string[]
}

export interface LiveItem {
  id: string
  label: string
  kind: 'presentation' | 'media' | 'header'
  presentationKind?: PresentationDoc['kind']
  /** Source document for presentation items; null for media and headers. */
  doc: PresentationDoc | null
  slides: LiveSlide[]
}

export function toLiveSlides(doc: PresentationDoc): LiveSlide[] {
  return doc.slides.map((slide, index) => ({
    id: slide.id,
    label: slide.label || `Slide ${index + 1}`,
    lines: slideText(slide)
      .split('\n')
      .filter((line) => line.length > 0),
  }))
}

export function presentationLiveItem(doc: PresentationDoc, id = newId('item')): LiveItem {
  return {
    id,
    label: doc.title,
    kind: 'presentation',
    presentationKind: doc.kind,
    doc,
    slides: toLiveSlides(doc),
  }
}

function placeholderSlide(id: string, label: string): LiveSlide {
  return { id: `${id}_slide`, label, lines: [label] }
}

export function buildLiveItems(
  playlist: PlaylistDoc,
  resolve: (presentationId: string) => PresentationDoc | null,
): LiveItem[] {
  return playlist.items.map((item) => {
    if (item.kind === 'presentation') {
      const doc = resolve(item.presentationId)
      if (!doc) {
        const label = item.label || 'Missing presentation'
        return {
          id: item.id,
          label,
          kind: item.kind,
          doc: null,
          slides: [placeholderSlide(item.id, label)],
        }
      }
      return {
        id: item.id,
        label: item.label || doc.title,
        kind: item.kind,
        presentationKind: doc.kind,
        doc,
        slides: toLiveSlides(doc),
      }
    }
    const label = item.label || (item.kind === 'media' ? 'Media' : 'Header')
    return {
      id: item.id,
      label,
      kind: item.kind,
      doc: null,
      slides: [placeholderSlide(item.id, label)],
    }
  })
}

export function liveContext(items: LiveItem[]): LiveContext {
  return { slideCounts: items.map((item) => Math.max(1, item.slides.length)) }
}

export function newLiveState(
  playlistId: string | null,
  sessionId = newId('session'),
): LiveState {
  return {
    schemaVersion: 1,
    sessionId,
    playlistId,
    itemIndex: 0,
    slideIndex: 0,
    buildIndex: 0,
    previewItemIndex: 0,
    previewSlideIndex: 0,
    mode: 'live',
    stageMessage: '',
    timers: defaultTimers(),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function slideCount(context: LiveContext, itemIndex: number): number {
  return Math.max(1, context.slideCounts[itemIndex] ?? 1)
}

/** Keeps a restored state inside the loaded playlist. */
export function clampLiveState(state: LiveState, context: LiveContext): LiveState {
  const count = context.slideCounts.length
  if (count === 0) {
    return { ...state, itemIndex: 0, slideIndex: 0, previewItemIndex: 0, previewSlideIndex: 0 }
  }
  const itemIndex = clamp(state.itemIndex, 0, count - 1)
  const previewItemIndex = clamp(state.previewItemIndex, 0, count - 1)
  return {
    ...state,
    itemIndex,
    slideIndex: clamp(state.slideIndex, 0, slideCount(context, itemIndex) - 1),
    previewItemIndex,
    previewSlideIndex: clamp(
      state.previewSlideIndex,
      0,
      slideCount(context, previewItemIndex) - 1,
    ),
  }
}

export function resolveLiveSlide(
  items: LiveItem[],
  itemIndex: number,
  slideIndex: number,
): { item: LiveItem; slide: LiveSlide } | null {
  const item = items[itemIndex]
  const slide = item?.slides[slideIndex]
  return item && slide ? { item, slide } : null
}

export function applyLiveCommand(
  state: LiveState,
  command: LiveCommand,
  context: LiveContext,
): LiveState {
  return liveReducer(state, command, context)
}

export interface LivePosition {
  item: LiveItem
  itemIndex: number
  slideIndex: number
  slide: LiveSlide
}

/** Next cue, rolling into the next item after the last slide. */
export function nextLivePosition(
  items: LiveItem[],
  itemIndex: number,
  slideIndex: number,
): LivePosition | null {
  const item = items[itemIndex]
  if (!item) return null
  const next = item.slides[slideIndex + 1]
  if (next) return { item, itemIndex, slideIndex: slideIndex + 1, slide: next }
  const nextItem = items[itemIndex + 1]
  const first = nextItem?.slides[0]
  return nextItem && first ? { item: nextItem, itemIndex: itemIndex + 1, slideIndex: 0, slide: first } : null
}

export function nextLiveSlide(items: LiveItem[], itemIndex: number, slideIndex: number): LiveSlide | null {
  return nextLivePosition(items, itemIndex, slideIndex)?.slide ?? null
}
