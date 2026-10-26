import type { LiveState } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import { liveReducer, timerRemaining } from '../src/live'

const base: LiveState = {
  schemaVersion: 1,
  sessionId: 's1',
  playlistId: 'p1',
  itemIndex: 0,
  slideIndex: 0,
  buildIndex: 0,
  previewItemIndex: 0,
  previewSlideIndex: 0,
  mode: 'live',
  stageMessage: '',
  timers: [],
}
const context = { slideCounts: [3, 2] }

describe('live reducer', () => {
  it('advances slides and rolls into the next item', () => {
    let state = base
    state = liveReducer(state, { type: 'next' }, context)
    state = liveReducer(state, { type: 'next' }, context)
    expect(state).toMatchObject({ itemIndex: 0, slideIndex: 2 })
    state = liveReducer(state, { type: 'next' }, context)
    expect(state).toMatchObject({ itemIndex: 1, slideIndex: 0 })
  })

  it('takes the preview live', () => {
    const previewed = liveReducer(base, { type: 'previewGoTo', itemIndex: 1, slideIndex: 1 }, context)
    const taken = liveReducer(previewed, { type: 'take' }, context)
    expect(taken).toMatchObject({ itemIndex: 1, slideIndex: 1, mode: 'live' })
  })

  it('tracks timer remaining time', () => {
    const started = liveReducer(
      { ...base, timers: [{ id: 't', label: 'Timer', kind: 'countdown', durationMs: 10_000, running: false, startedAt: null, remainingMs: 10_000 }] },
      { type: 'timerStart', timerId: 't', now: 1_000 },
      context,
    )
    expect(timerRemaining(started.timers[0]!, 4_000)).toBe(7_000)
    const stopped = liveReducer(started, { type: 'timerStop', timerId: 't', now: 4_000 }, context)
    expect(stopped.timers[0]?.remainingMs).toBe(7_000)
  })
})
