import {
  clearLayer,
  createScreen,
  liveComposition,
  presentationSlideSource,
  type ShowLive,
  type ShowResolveContext,
} from '@lumen/core'
import type { Composition, Layer, OutputMode, PresentationDoc, Screen, ShowDoc, Source, Transition } from '@lumen/schema'
import {
  assetsForDoc,
  effectiveTransition,
  isCut,
  placeholderDoc,
  type LiveCompositionTransform,
  type SceneSlideSource,
} from '~/live/liveScene'
import { nextLivePosition, type LiveItem } from '~/live/liveSession'
import type { ScreenOutputStatus } from '~/output/api'

/**
 * Pure glue between the rundown live state (`packages/core/src/live.ts`) and
 * the v2 show: the slide on air becomes the `slide` source of the layer tagged
 * `content` or `lyrics` (doc 03 § Place in the v2 model), and output modes
 * apply per screen.
 */

/** Layer tags the rundown drives. */
export const CONTENT_TAGS: readonly string[] = ['content', 'lyrics']

/** One rundown position resolved to the document that renders it. */
export interface RundownCue {
  /** Changes whenever the position changes; used for transitions and keys. */
  key: string
  itemId: string
  presentationId: string | null
  doc: PresentationDoc | null
  slideIndex: number
  label: string
}

/** What a screen shows: the rundown cue on the content layer and the output mode. */
export interface ShowFrame {
  cue: RundownCue | null
  mode: OutputMode
}

export function cueAt(items: readonly LiveItem[], itemIndex: number, slideIndex: number): RundownCue | null {
  const item = items[itemIndex]
  const slide = item?.slides[slideIndex]
  if (!item || !slide) return null
  return {
    key: `${item.id}:${slideIndex}`,
    itemId: item.id,
    presentationId: item.presentationId ?? null,
    doc: item.doc,
    slideIndex,
    label: slide.label,
  }
}

/** The cue after a position, rolling into the next item. */
export function nextCue(items: LiveItem[], itemIndex: number, slideIndex: number): RundownCue | null {
  const next = nextLivePosition(items, itemIndex, slideIndex)
  return next ? cueAt(items, next.itemIndex, next.slideIndex) : null
}

export function isContentLayer(layer: Pick<Layer, 'tags'>): boolean {
  return layer.tags.some((tag) => CONTENT_TAGS.includes(tag))
}

/** The topmost layer tagged `content` or `lyrics`; the rundown drives its source. */
export function contentLayerId(composition: Pick<Composition, 'layers'>): string | null {
  for (let index = composition.layers.length - 1; index >= 0; index--) {
    const layer = composition.layers[index]!
    if (isContentLayer(layer)) return layer.id
  }
  return null
}

/** The cue as a `slide` source. Items without a document become a title card. */
export function cueSource(cue: RundownCue, theme: ShowResolveContext['theme']): Source | null {
  const doc = cue.doc ?? placeholderDoc(cue.label.trim() || 'No slide')
  return presentationSlideSource(`rundown-${cue.itemId}`, doc, cue.doc ? cue.slideIndex : 0, theme)
}

/** The slide source the timeline transform addresses for a cue. */
export function cueSlideSource(cue: RundownCue | null): SceneSlideSource | null {
  return cue ? { doc: cue.doc, slideIndex: cue.slideIndex, label: cue.label } : null
}

/**
 * Taking a rundown slide hands the content layer back to the rundown: a grid
 * clip playing there stops. The last action on the layer wins.
 */
export function releaseContentLayer(show: ShowDoc, live: ShowLive): ShowLive {
  const layerId = contentLayerId(show.composition)
  return layerId && live.active[layerId] ? clearLayer(live, layerId) : live
}

/**
 * The composition as it plays: grid clips on their layers, then the rundown
 * cue on the content layer when no clip plays there. `clear` hides every
 * content-tagged layer; other layers keep playing.
 */
export function programComposition(
  show: ShowDoc,
  live: ShowLive,
  frame: ShowFrame,
  context: ShowResolveContext,
): Composition {
  let composition = liveComposition(show, live, context)
  const layerId = contentLayerId(show.composition)
  if (frame.cue && layerId && !live.active[layerId]) {
    const source = cueSource(frame.cue, context.theme)
    if (source) {
      const known = new Set(composition.assets.map((asset) => asset.id))
      const assets = assetsForDoc(frame.cue.doc, [...context.media]).filter((asset) => !known.has(asset.id))
      composition = {
        ...composition,
        sources: [...composition.sources, source],
        layers: composition.layers.map((layer) => (layer.id === layerId ? { ...layer, sourceId: source.id } : layer)),
        assets: [...composition.assets, ...assets],
      }
    }
  }
  if (frame.mode === 'clear') {
    composition = {
      ...composition,
      layers: composition.layers.map((layer) => (isContentLayer(layer) ? { ...layer, sourceId: null } : layer)),
    }
  }
  return composition
}

/**
 * Runs the timeline transform (media clips and keyframes) on the program
 * composition. Keyframes address composition layers by id and the content
 * layer's slide elements by their bare element id.
 */
export function applyTimelineTransform(
  composition: Composition,
  transform: LiveCompositionTransform | null,
  cue: RundownCue | null,
  layerId: string | null,
): Composition {
  return transform ? transform.apply(composition, cueSlideSource(cue), layerId) : composition
}

/**
 * The composition a frame shows on every screen: `programComposition` (clips,
 * rundown cue, `clear`) plus the timeline transform. `black`, `logo` and test
 * patterns are per screen (`screenForMode`); `freeze` renders like `live` and
 * the output decides not to send it.
 */
export function showComposition(
  show: ShowDoc,
  live: ShowLive,
  frame: ShowFrame,
  context: ShowResolveContext,
  transform: LiveCompositionTransform | null = null,
): Composition {
  const composition = programComposition(show, live, frame, context)
  return applyTimelineTransform(composition, transform, frame.cue, contentLayerId(show.composition))
}

/**
 * The screen as the compositor should draw it for an output mode: `black` and
 * `logo` (no logo asset yet) set blackout, which Rust renders as a black
 * frame. Test patterns stay on the screen and win, as Rust draws them first.
 */
export function screenForMode(screen: Screen, mode: OutputMode): Screen {
  return (mode === 'black' || mode === 'logo') && !screen.blackout ? { ...screen, blackout: true } : screen
}

/** A virtual screen that shows the whole canvas, for the Preview and Program monitors. */
export function canvasScreen(show: ShowDoc): Screen {
  return createScreen({ id: 'show-canvas', name: 'Canvas', size: show.composition.canvas })
}

/** Transition for a cue: the slide's own, then the theme's, then the default. */
export function cueTransition(cue: RundownCue | null, theme: ShowResolveContext['theme']): Transition {
  const slide = cue?.doc ? cue.doc.slides[cue.slideIndex] ?? null : null
  return effectiveTransition(slide, theme)
}

/** What an output last received, per screen. */
export interface OutputMemory {
  label: string
  cueKey: string
  mode: OutputMode
  /** The transition last started on this output and when it ends (ms, `Date.now()` clock). */
  transition: Transition | null
  transitionEndsAt: number
}

export type OutputAction = 'skip' | 'apply' | 'transition'

/**
 * How to update one screen's output. Freeze holds the last frame (a new or
 * changed output gets one seed frame). A rundown cue change while live
 * crossfades with the cue transition; everything else is a cut.
 */
export function outputAction(
  previous: OutputMemory | null,
  next: { label: string; mode: OutputMode; cueKey: string; transition: Transition; testPattern: boolean },
): OutputAction {
  const sameOutput = previous !== null && previous.label === next.label
  if (next.mode === 'freeze') return sameOutput ? 'skip' : 'apply'
  if (
    sameOutput &&
    next.mode === 'live' &&
    previous.mode === 'live' &&
    previous.cueKey !== next.cueKey &&
    !next.testPattern &&
    !isCut(next.transition)
  ) {
    return 'transition'
  }
  return 'apply'
}

/**
 * The `transition` argument for `apply_composition`. A cue change starts the
 * cue transition. Updates on the same cue while that transition still runs
 * (timeline keyframes, clip changes) resend it, because a cut would end the
 * running fade at once. Everything else cuts.
 */
export function outputTransition(
  previous: OutputMemory | null,
  action: OutputAction,
  next: { cueKey: string; transition: Transition },
  now: number,
): Transition | null {
  if (action === 'transition') return next.transition
  if (action !== 'apply' || !previous?.transition) return null
  return previous.cueKey === next.cueKey && now < previous.transitionEndsAt ? previous.transition : null
}

/**
 * Per-screen errors from `apply_composition`, as `Screen name: error` lines.
 * Screens Rust reports without an error are left out.
 */
export function statusErrors(statuses: readonly ScreenOutputStatus[], screens: readonly Screen[]): string[] {
  const names = new Map(screens.map((screen) => [screen.id, screen.name]))
  return statuses.flatMap((status) =>
    status.error ? [`${names.get(status.screenId) ?? status.screenId}: ${status.error}`] : [],
  )
}

/** Keyboard map for the Show workspace. Returns null for keys it does not handle. */
export type ShowKeyAction =
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'take' }
  | { kind: 'nextItem' }
  | { kind: 'prevItem' }
  | { kind: 'mode'; mode: OutputMode }
  | { kind: 'toggleFreeze' }
  | { kind: 'launchColumn'; column: number }
  | { kind: 'clearClips' }

export function showKeyAction(key: string, columns: number): ShowKeyAction | null {
  switch (key) {
    case 'ArrowRight':
    case ' ':
      return { kind: 'next' }
    case 'ArrowLeft':
      return { kind: 'prev' }
    case 'Enter':
      return { kind: 'take' }
    case ']':
      return { kind: 'nextItem' }
    case '[':
      return { kind: 'prevItem' }
    case 'b':
    case 'B':
      return { kind: 'mode', mode: 'black' }
    case 'c':
    case 'C':
      return { kind: 'mode', mode: 'clear' }
    case 'l':
    case 'L':
      return { kind: 'mode', mode: 'logo' }
    case 'f':
    case 'F':
      return { kind: 'toggleFreeze' }
    case 'Escape':
      return { kind: 'clearClips' }
  }
  const column = Number(key) - 1
  if (/^[1-9]$/.test(key) && column < columns) return { kind: 'launchColumn', column }
  return null
}
