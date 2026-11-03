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
  /** Library presentation id for presentation items; timeline slide clips address it. */
  presentationId?: string
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
          presentationId: item.presentationId,
          doc: null,
          slides: [placeholderSlide(item.id, label)],
        }
      }
      return {
        id: item.id,
        label: item.label || doc.title,
        kind: item.kind,
        presentationId: item.presentationId,
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

/**
 * What stays on air while the session's items change under it: after the
 * operator picks another rundown, or when a reload removed the item on air.
 * Program shows it until a command moves program (`releasesHold`).
 */
export interface HeldProgram {
  item: LiveItem
  slideIndex: number
}

/**
 * Commands that move program off a held slide. `take` and `goTo` then apply
 * as usual; `next`, `prev`, `nextItem` and `prevItem` land on the session's
 * own program position (the first slide of a freshly picked rundown) instead
 * of stepping past it. Preview, mode, message and timer commands keep the hold.
 */
export function releasesHold(command: LiveCommand): boolean {
  switch (command.type) {
    case 'take':
    case 'goTo':
    case 'next':
    case 'prev':
    case 'nextItem':
    case 'prevItem':
      return true
    default:
      return false
  }
}

/** Whether a command still applies to the state after it released a hold. */
export function appliesAfterRelease(command: LiveCommand): boolean {
  return command.type === 'take' || command.type === 'goTo'
}

/** The program position of a state, or the held slide. */
export function programSlide(
  items: LiveItem[],
  state: LiveState,
  held: HeldProgram | null,
): { item: LiveItem; slide: LiveSlide } | null {
  if (held) {
    const slide = held.item.slides[held.slideIndex]
    return slide ? { item: held.item, slide } : null
  }
  return resolveLiveSlide(items, state.itemIndex, state.slideIndex)
}

/**
 * Picking another rundown loads it into the rundown panel and preview only:
 * the slide on air is held, and the output mode, stage message and timers
 * carry over. Returns no hold when nothing was on air.
 */
export function switchLiveSession(
  previous: { items: LiveItem[]; state: LiveState; held: HeldProgram | null },
  next: LiveState,
): { state: LiveState; held: HeldProgram | null } {
  const onAir = programSlide(previous.items, previous.state, previous.held)
  const held = onAir
    ? { item: onAir.item, slideIndex: onAir.item.slides.indexOf(onAir.slide) }
    : null
  return {
    state: {
      ...next,
      mode: previous.state.mode,
      stageMessage: previous.state.stageMessage,
      timers: previous.state.timers,
    },
    held,
  }
}

/**
 * Keeps the session on the same content after the current rundown reloads
 * (items added, removed or reordered): program and preview follow their item
 * ids to the new indexes. When the item on air is gone, it is held so the
 * output does not change until the operator moves on. An existing hold stays.
 */
export function reloadLiveSession(
  previous: { items: LiveItem[]; state: LiveState; held: HeldProgram | null },
  items: LiveItem[],
): { state: LiveState; held: HeldProgram | null } {
  const { state } = previous
  const find = (index: number) => {
    const id = previous.items[index]?.id
    return id === undefined ? -1 : items.findIndex((item) => item.id === id)
  }
  const programIndex = find(state.itemIndex)
  const previewIndex = find(state.previewItemIndex)
  let held = previous.held
  if (!held && programIndex < 0) {
    const onAir = resolveLiveSlide(previous.items, state.itemIndex, state.slideIndex)
    if (onAir) held = { item: onAir.item, slideIndex: state.slideIndex }
  }
  const moved: LiveState = {
    ...state,
    itemIndex: programIndex >= 0 ? programIndex : state.itemIndex,
    previewItemIndex: previewIndex >= 0 ? previewIndex : state.previewItemIndex,
  }
  return { state: clampLiveState(moved, liveContext(items)), held }
}
