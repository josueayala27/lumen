import type { LiveCommand, LiveState, Timer } from '@lumen/schema'

export interface LiveContext {
  /** Number of slides in each playlist item, by item index. Headers and media count as 1. */
  slideCounts: number[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function slideCount(context: LiveContext, itemIndex: number): number {
  return Math.max(1, context.slideCounts[itemIndex] ?? 1)
}

function moveItem(state: LiveState, context: LiveContext, delta: number): LiveState {
  const next = clamp(state.itemIndex + delta, 0, Math.max(0, context.slideCounts.length - 1))
  return { ...state, itemIndex: next, slideIndex: 0, buildIndex: 0 }
}

function moveSlide(state: LiveState, context: LiveContext, delta: number): LiveState {
  const count = slideCount(context, state.itemIndex)
  const next = state.slideIndex + delta
  if (next >= 0 && next < count) {
    return { ...state, slideIndex: next, buildIndex: 0 }
  }
  if (delta > 0) {
    return moveItem(state, context, 1)
  }
  const item = clamp(state.itemIndex - 1, 0, Math.max(0, context.slideCounts.length - 1))
  if (item === state.itemIndex) return state
  return { ...state, itemIndex: item, slideIndex: slideCount(context, item) - 1, buildIndex: 0 }
}

function updateTimer(timers: Timer[], timerId: string, update: (timer: Timer) => Timer): Timer[] {
  return timers.map((timer) => (timer.id === timerId ? update(timer) : timer))
}

export function liveReducer(state: LiveState, command: LiveCommand, context: LiveContext): LiveState {
  switch (command.type) {
    case 'next':
      return moveSlide(state, context, 1)
    case 'prev':
      return moveSlide(state, context, -1)
    case 'goTo':
      return { ...state, slideIndex: clamp(command.slideIndex, 0, slideCount(context, state.itemIndex) - 1), buildIndex: 0 }
    case 'nextItem':
      return moveItem(state, context, 1)
    case 'prevItem':
      return moveItem(state, context, -1)
    case 'previewNext': {
      const count = slideCount(context, state.previewItemIndex)
      if (state.previewSlideIndex + 1 < count) return { ...state, previewSlideIndex: state.previewSlideIndex + 1 }
      const nextItem = clamp(state.previewItemIndex + 1, 0, Math.max(0, context.slideCounts.length - 1))
      return { ...state, previewItemIndex: nextItem, previewSlideIndex: 0 }
    }
    case 'previewPrev': {
      if (state.previewSlideIndex > 0) return { ...state, previewSlideIndex: state.previewSlideIndex - 1 }
      const prevItem = clamp(state.previewItemIndex - 1, 0, Math.max(0, context.slideCounts.length - 1))
      return { ...state, previewItemIndex: prevItem, previewSlideIndex: slideCount(context, prevItem) - 1 }
    }
    case 'previewGoTo':
      return {
        ...state,
        previewItemIndex: clamp(command.itemIndex, 0, Math.max(0, context.slideCounts.length - 1)),
        previewSlideIndex: Math.max(0, command.slideIndex),
      }
    case 'take':
      return {
        ...state,
        itemIndex: state.previewItemIndex,
        slideIndex: state.previewSlideIndex,
        buildIndex: 0,
        mode: 'live',
      }
    case 'setMode':
      return { ...state, mode: command.mode }
    case 'setMessage':
      return { ...state, stageMessage: command.message }
    case 'timerStart':
      return {
        ...state,
        timers: updateTimer(state.timers, command.timerId, (timer) => ({
          ...timer,
          running: true,
          startedAt: command.now,
          remainingMs: timer.remainingMs ?? timer.durationMs,
        })),
      }
    case 'timerStop':
      return {
        ...state,
        timers: updateTimer(state.timers, command.timerId, (timer) => {
          if (!timer.running || timer.startedAt === null) return { ...timer, running: false }
          const elapsed = command.now - timer.startedAt
          const remaining = Math.max(0, (timer.remainingMs ?? timer.durationMs) - elapsed)
          return { ...timer, running: false, startedAt: null, remainingMs: remaining }
        }),
      }
    case 'timerReset':
      return {
        ...state,
        timers: updateTimer(state.timers, command.timerId, (timer) => ({
          ...timer,
          running: false,
          startedAt: null,
          remainingMs: timer.durationMs,
        })),
      }
  }
}

export function timerRemaining(timer: Timer, now: number): number {
  if (!timer.running || timer.startedAt === null) return timer.remainingMs ?? timer.durationMs
  return Math.max(0, (timer.remainingMs ?? timer.durationMs) - (now - timer.startedAt))
}
