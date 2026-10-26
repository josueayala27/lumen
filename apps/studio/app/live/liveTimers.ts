import { timerRemaining } from '@lumen/core'
import type { LiveCommand, Timer } from '@lumen/schema'

export const SERVICE_TIMER_ID = 'live_service_countdown'
export const ELAPSED_TIMER_ID = 'live_elapsed'

/** Eight hours; an elapsed timer is displayed as time since it started. */
const ELAPSED_DURATION_MS = 8 * 60 * 60 * 1000

/** The two timers the live page always offers. Returns fresh objects each call. */
export function defaultTimers(): Timer[] {
  return [
    {
      id: SERVICE_TIMER_ID,
      label: 'Service countdown',
      kind: 'countdown',
      durationMs: 5 * 60 * 1000,
      running: false,
      startedAt: null,
      remainingMs: null,
    },
    {
      id: ELAPSED_TIMER_ID,
      label: 'Elapsed',
      kind: 'elapsed',
      durationMs: ELAPSED_DURATION_MS,
      running: false,
      startedAt: null,
      remainingMs: null,
    },
  ]
}

/** Adds the default timers to sessions saved before timers existed. */
export function ensureTimers(timers: Timer[]): Timer[] {
  return timers.length > 0 ? timers : defaultTimers()
}

export type TimerAction = 'start' | 'stop' | 'reset'

/** Builds the reducer command for a timer button, stamping the wall clock. */
export function timerCommand(
  action: TimerAction,
  timerId: string,
  now = Date.now(),
): LiveCommand {
  switch (action) {
    case 'start':
      return { type: 'timerStart', timerId, now }
    case 'stop':
      return { type: 'timerStop', timerId, now }
    case 'reset':
      return { type: 'timerReset', timerId }
  }
}

/** `MM:SS`, or `H:MM:SS` past one hour. */
export function formatTimer(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

export interface LiveTimerView {
  id: string
  label: string
  kind: Timer['kind']
  running: boolean
  value: string
}

/**
 * View model for the live inspector. Countdowns report time remaining; elapsed
 * timers report time since their duration window started.
 */
export function liveTimerViews(timers: Timer[], now: number): LiveTimerView[] {
  return timers.map((timer) => {
    const remaining = timerRemaining(timer, now)
    const milliseconds =
      timer.kind === 'elapsed' ? Math.max(0, timer.durationMs - remaining) : remaining
    return {
      id: timer.id,
      label: timer.label,
      kind: timer.kind,
      running: timer.running,
      value: formatTimer(milliseconds),
    }
  })
}
