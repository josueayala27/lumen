import { describe, expect, it } from 'vitest'
import type { TimelineDoc } from '@lumen/schema'
import { advanceTimeline, maxGapFrames } from './timeline'

function timeline(cues: TimelineDoc['cues']): TimelineDoc {
  return { schemaVersion: 1, id: 'timeline-1', name: 'Service', frameRate: '25', cues }
}

function cue(atFrames: number, label: string, enabled = true): TimelineDoc['cues'][number] {
  return { id: `cue-${atFrames}`, label, atFrames, action: { type: 'next' }, enabled }
}

describe('advanceTimeline', () => {
  it('resynchronizes on the first lock without firing past cues', () => {
    const doc = timeline([cue(105, 'late')])
    const result = advanceTimeline({ frame: null }, doc, 105)
    expect(result.resynced).toBe(true)
    expect(result.cues).toEqual([])
    expect(result.state.frame).toBe(105)
  })

  it('fires crossed cues once', () => {
    const doc = timeline([cue(105, 'a'), cue(110, 'b'), cue(120, 'c')])
    const first = advanceTimeline({ frame: 100 }, doc, 110)
    expect(first.resynced).toBe(false)
    expect(first.cues.map((entry) => entry.label)).toEqual(['a', 'b'])

    const second = advanceTimeline(first.state, doc, 110)
    expect(second.cues).toEqual([])

    const third = advanceTimeline(second.state, doc, 125)
    expect(third.cues.map((entry) => entry.label)).toEqual(['c'])
  })

  it('skips disabled cues', () => {
    const doc = timeline([cue(105, 'off', false)])
    const result = advanceTimeline({ frame: 100 }, doc, 110)
    expect(result.cues).toEqual([])
  })

  it('resynchronizes after a backward jump or a large gap', () => {
    const doc = timeline([cue(105, 'a')])
    const backward = advanceTimeline({ frame: 200 }, doc, 100)
    expect(backward.resynced).toBe(true)
    expect(backward.cues).toEqual([])

    const gap = maxGapFrames('25') + 10
    const jumped = advanceTimeline({ frame: 100 }, doc, 100 + gap)
    expect(jumped.resynced).toBe(true)
    expect(jumped.cues).toEqual([])
    expect(jumped.state.frame).toBe(100 + gap)
  })

  it('sorts cues that share a window', () => {
    const doc = timeline([cue(110, 'second'), cue(105, 'first')])
    const result = advanceTimeline({ frame: 100 }, doc, 115)
    expect(result.cues.map((entry) => entry.label)).toEqual(['first', 'second'])
  })
})
