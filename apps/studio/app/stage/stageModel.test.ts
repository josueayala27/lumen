import type { Timer } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatDuration,
  safeAreaPercent,
  stageNextSlide,
  stageSlideAt,
  timerValue,
  timerViews,
  type StageSourceItem,
} from './stageModel'

function timer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 't1',
    label: 'Countdown',
    kind: 'countdown',
    durationMs: 300_000,
    running: false,
    startedAt: null,
    remainingMs: null,
    ...overrides,
  }
}

const items: StageSourceItem[] = [
  {
    id: 'a',
    label: 'Opening',
    slides: [
      { label: 'Slide 1', lines: ['One'], notes: 'Welcome' },
      { label: 'Slide 2', lines: ['Two'], notes: 'Greet' },
    ],
  },
  {
    id: 'b',
    label: 'Message',
    slides: [{ label: 'Slide 1', lines: ['Three'], notes: 'Point' }],
  },
]

describe('stage slide resolution', () => {
  it('resolves current and next cues across items', () => {
    expect(stageSlideAt(items, 0, 1)?.slide.notes).toBe('Greet')
    expect(stageSlideAt(items, 9, 9)).toBeNull()

    const next = stageNextSlide(items, 0, 1)
    expect(next?.item.label).toBe('Message')
    expect(next?.slideIndex).toBe(0)
    expect(next?.slide.lines).toEqual(['Three'])
  })

  it('does not roll past the last cue', () => {
    expect(stageNextSlide(items, 1, 0)).toBeNull()
    expect(stageNextSlide(items, 4, 0)).toBeNull()
  })
})

describe('stage clock and duration', () => {
  it('formats the wall clock and short durations', () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5, 7))).toBe('09:05:07')
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(65_000)).toBe('01:05')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
    expect(formatDuration(-1)).toBe('00:00')
  })
})

describe('stage timers', () => {
  it('shows countdown remaining and elapsed counted up', () => {
    const now = 10_000
    expect(timerValue(timer({ running: true, startedAt: 0 }), now)).toBe('04:50')
    expect(
      timerValue(
        timer({ kind: 'elapsed', running: true, startedAt: 0, durationMs: 300_000 }),
        now,
      ),
    ).toBe('00:10')
  })

  it('keeps paused values and falls back to the duration', () => {
    expect(timerValue(timer({ remainingMs: 90_000 }), 5_000)).toBe('01:30')
    expect(timerViews([timer({ label: 'Service' })], 0)).toEqual([
      { id: 't1', label: 'Service', kind: 'countdown', running: false, value: '05:00' },
    ])
  })
})

describe('safe area marker', () => {
  it('clamps the inset percentage', () => {
    expect(safeAreaPercent(0.05)).toBe('5%')
    expect(safeAreaPercent(0.125)).toBe('12.5%')
    expect(safeAreaPercent(-1)).toBe('0%')
    expect(safeAreaPercent(1)).toBe('25%')
  })
})
