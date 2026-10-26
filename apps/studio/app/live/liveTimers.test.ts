import type { Timer } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import {
  defaultTimers,
  ELAPSED_TIMER_ID,
  ensureTimers,
  formatTimer,
  liveTimerViews,
  SERVICE_TIMER_ID,
  timerCommand,
} from './liveTimers'

const countdown: Timer = {
  id: 'timer_1',
  label: 'Countdown',
  kind: 'countdown',
  durationMs: 60_000,
  running: false,
  startedAt: null,
  remainingMs: null,
}

describe('timer view model', () => {
  it('shows a paused countdown at its remaining time', () => {
    expect(liveTimerViews([countdown], 0)[0]?.value).toBe('01:00')
    expect(liveTimerViews([{ ...countdown, remainingMs: 30_000 }], 999_999)[0]?.value).toBe('00:30')
  })

  it('counts a running countdown down from the start time', () => {
    const running: Timer = {
      ...countdown,
      running: true,
      startedAt: 1_000,
      remainingMs: 60_000,
    }
    const view = liveTimerViews([running], 11_000)[0]
    expect(view?.running).toBe(true)
    expect(view?.value).toBe('00:50')
  })

  it('counts an elapsed timer up from zero', () => {
    const elapsed: Timer = {
      ...countdown,
      id: 'timer_2',
      kind: 'elapsed',
      durationMs: 3_600_000,
      running: true,
      startedAt: 0,
      remainingMs: 3_600_000,
    }
    expect(liveTimerViews([elapsed], 65_000)[0]?.value).toBe('01:05')
  })

  it('formats minutes and hours', () => {
    expect(formatTimer(0)).toBe('00:00')
    expect(formatTimer(3_599_000)).toBe('59:59')
    expect(formatTimer(3_600_000)).toBe('1:00:00')
    expect(formatTimer(-50)).toBe('00:00')
  })
})

describe('timer defaults and commands', () => {
  it('provides a countdown and an elapsed timer', () => {
    const timers = defaultTimers()
    expect(timers.map((timer) => timer.id)).toEqual([SERVICE_TIMER_ID, ELAPSED_TIMER_ID])
    expect(timers.map((timer) => timer.kind)).toEqual(['countdown', 'elapsed'])
    expect(liveTimerViews(timers, 0).map((view) => view.value)).toEqual(['05:00', '00:00'])
  })

  it('adds defaults to restored sessions without timers', () => {
    expect(ensureTimers([])).toHaveLength(2)
    const existing = defaultTimers()
    expect(ensureTimers(existing)).toBe(existing)
  })

  it('stamps timer commands with the wall clock', () => {
    expect(timerCommand('start', 'timer_1', 123)).toEqual({
      type: 'timerStart',
      timerId: 'timer_1',
      now: 123,
    })
    expect(timerCommand('stop', 'timer_1', 456)).toEqual({
      type: 'timerStop',
      timerId: 'timer_1',
      now: 456,
    })
    expect(timerCommand('reset', 'timer_1', 789)).toEqual({
      type: 'timerReset',
      timerId: 'timer_1',
    })
  })
})
