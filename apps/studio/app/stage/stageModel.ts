import { createScreen, timerRemaining } from '@lumen/core'
import { STAGE_PARTS, type Screen, type Size, type StagePart, type Timer } from '@lumen/schema'

export interface StageSourceSlide {
  label: string
  lines: string[]
  notes: string
}

export interface StageSourceItem<S extends StageSourceSlide = StageSourceSlide> {
  id: string
  label: string
  slides: S[]
}

export interface StageResolvedSlide<
  S extends StageSourceSlide = StageSourceSlide,
  I extends StageSourceItem<S> = StageSourceItem<S>,
> {
  itemIndex: number
  slideIndex: number
  item: I
  slide: S
}

/** Resolves the live position, ignoring stale indexes in a restored session. */
export function stageSlideAt<S extends StageSourceSlide, I extends StageSourceItem<S>>(
  items: I[],
  itemIndex: number,
  slideIndex: number,
): StageResolvedSlide<S, I> | null {
  const item = items[itemIndex]
  const slide = item?.slides[slideIndex]
  return item && slide ? { itemIndex, slideIndex, item, slide } : null
}

/** Next cue, rolling into the next item after the last slide. */
export function stageNextSlide<S extends StageSourceSlide, I extends StageSourceItem<S>>(
  items: I[],
  itemIndex: number,
  slideIndex: number,
): StageResolvedSlide<S, I> | null {
  const item = items[itemIndex]
  if (!item) return null
  const slide = item.slides[slideIndex + 1]
  if (slide) return { itemIndex, slideIndex: slideIndex + 1, item, slide }
  for (let index = itemIndex + 1; index < items.length; index += 1) {
    const nextItem = items[index]
    const first = nextItem?.slides[0]
    if (nextItem && first) return { itemIndex: index, slideIndex: 0, item: nextItem, slide: first }
  }
  return null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 24-hour wall clock, `HH:MM:SS`. */
export function formatClock(now: number | Date): string {
  const date = now instanceof Date ? now : new Date(now)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** `MM:SS`, or `H:MM:SS` past one hour. */
export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/**
 * Countdown timers report time remaining; elapsed timers report time since their
 * duration window started. Running values follow the desktop clock.
 */
export function timerValue(timer: Timer, now: number): string {
  const remaining = timerRemaining(timer, now)
  const milliseconds = timer.kind === 'elapsed' ? Math.max(0, timer.durationMs - remaining) : remaining
  return formatDuration(milliseconds)
}

export interface StageTimerView {
  id: string
  label: string
  kind: Timer['kind']
  running: boolean
  value: string
}

export function timerViews(timers: Timer[], now: number): StageTimerView[] {
  return timers.map((timer) => ({
    id: timer.id,
    label: timer.label,
    kind: timer.kind,
    running: timer.running,
    value: timerValue(timer, now),
  }))
}

/** Safe-area marker inset as a CSS percentage of the frame. */
export function safeAreaPercent(fraction: number): string {
  const clamped = Math.min(0.25, Math.max(0, fraction))
  return `${round(clamped * 100)}%`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The stage screen the window follows: the one named by id, else the first
 * enabled screen with the `stage` role. Null when the show has none.
 */
export function stageScreen(screens: readonly Screen[], screenId: string | null = null): Screen | null {
  if (screenId) {
    const named = screens.find((screen) => screen.id === screenId)
    if (named) return named
  }
  return screens.find((screen) => screen.role === 'stage' && screen.enabled) ?? null
}

/** Which stage parts to show: the screen's `layout.stage`, or every part without one. */
export function stageParts(screen: Screen | null): ReadonlySet<StagePart> {
  return new Set(screen?.layout.stage?.show ?? STAGE_PARTS)
}

/**
 * The screen a stage slide image renders through: the stage screen's text
 * override, background and safe area over the whole slide. Its layer filter,
 * region and mapping are for the show canvas, not a single slide, so they are
 * left out.
 */
export function stageSlideScreen(screen: Screen | null, size: Size): Screen | null {
  if (!screen) return null
  return createScreen({
    id: screen.id,
    name: screen.name,
    role: 'stage',
    size,
    layout: {
      text: screen.layout.text,
      background: screen.layout.background,
      safeArea: { ...screen.layout.safeArea },
      stage: screen.layout.stage,
    },
  })
}
