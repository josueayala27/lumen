import { describe, expect, it } from 'vitest'
import type { ShowTimeline, TimelineClip, TimelineMarker, TimelineTrack } from '@lumen/schema'
import {
  advancePlayback,
  createPlaybackState,
  evaluateTimeline,
  externalFrameFor,
  pause,
  play,
  seek,
  stepFrame,
  stepSecond,
  stop,
  syncExternalFrame,
  timelineFrameFromExternal,
} from '../src/timelinePlayback'

function clip(
  id: string,
  startFrame: number,
  durationFrames: number,
  overrides: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    kind: 'slide',
    label: '',
    startFrame,
    durationFrames,
    trimStartFrames: 0,
    presentationId: null,
    slideIndex: null,
    assetId: null,
    action: null,
    gain: 1,
    loop: false,
    ...overrides,
  }
}

function marker(id: string, frame: number, enabled = true): TimelineMarker {
  return { id, frame, label: id, action: null, enabled }
}

function track(
  id: string,
  clips: TimelineClip[] = [],
  properties: TimelineTrack['properties'] = [],
  muted = false,
): TimelineTrack {
  return {
    id,
    kind: 'slide',
    name: id,
    muted,
    locked: false,
    presentationId: null,
    slideIndex: null,
    elementId: null,
    clips,
    properties,
  }
}

function timeline(overrides: Partial<ShowTimeline> = {}): ShowTimeline {
  return {
    schemaVersion: 1,
    id: 'timeline-1',
    name: 'Show',
    frameRate: '25',
    durationFrames: 100,
    tracks: [],
    markers: [],
    ...overrides,
  }
}

const linear = {
  kind: 'linear' as const,
  x1: 0.25,
  y1: 0,
  x2: 0.75,
  y2: 1,
}

describe('transport', () => {
  it('plays, pauses and stops', () => {
    const doc = timeline()
    const playing = play(createPlaybackState())
    expect(playing.playing).toBe(true)
    expect(pause(playing).playing).toBe(false)
    expect(stop(playing)).toMatchObject({ playing: false, frame: 0 })
  })

  it('seeks with clamping while preserving playback flags', () => {
    const doc = timeline()
    const state = play(createPlaybackState({ frame: 10 }))
    expect(seek(doc, state, -5)).toMatchObject({ frame: 0, playing: true })
    expect(seek(doc, state, 500)).toMatchObject({ frame: 99, playing: true })
    expect(seek(doc, state, 42).frame).toBe(42)
  })

  it('steps frames and seconds with clamping', () => {
    const doc = timeline()
    const state = createPlaybackState({ frame: 50 })
    expect(stepFrame(doc, state, 10).frame).toBe(60)
    expect(stepFrame(doc, state, -60).frame).toBe(0)
    expect(stepSecond(doc, state, 2).frame).toBe(99)
    expect(stepSecond(doc, createPlaybackState(), 1).frame).toBe(25)
  })
})

describe('advancePlayback', () => {
  it('advances by elapsed milliseconds at the timeline frame rate', () => {
    const doc = timeline()
    const state = play(createPlaybackState())
    expect(advancePlayback(doc, state, 1000).frame).toBe(25)
    expect(advancePlayback(doc, { ...state, rate: 2 }, 1000).frame).toBe(50)
  })

  it('does not advance while paused', () => {
    const doc = timeline()
    const state = createPlaybackState({ frame: 10, playing: false })
    expect(advancePlayback(doc, state, 1000)).toEqual(state)
  })

  it('wraps when looping and pauses at the end otherwise', () => {
    const doc = timeline()
    const looping = play(createPlaybackState({ frame: 95, loop: true }))
    expect(advancePlayback(doc, looping, 400).frame).toBe(5)

    const reversing = play(createPlaybackState({ frame: 2, loop: true, rate: -1 }))
    expect(advancePlayback(doc, reversing, 200).frame).toBe(97)

    const ending = play(createPlaybackState({ frame: 95 }))
    expect(advancePlayback(doc, ending, 400)).toMatchObject({ frame: 99, playing: false })
  })
})

describe('evaluateTimeline', () => {
  it('fires crossed markers in order without duplicates', () => {
    const doc = timeline({
      markers: [
        marker('m2', 40),
        marker('m1', 20),
        marker('m1', 20),
        marker('m0', 10),
        marker('off', 30, false),
      ],
    })
    const result = evaluateTimeline(doc, 50, 10)
    expect(result.resynced).toBe(false)
    expect(result.markers.map((entry) => entry.id)).toEqual(['m1', 'm2'])
    expect(result.markers).toHaveLength(2)
  })

  it('resynchronizes after a gap larger than two seconds of frames', () => {
    const doc = timeline({ markers: [marker('m1', 30)] })
    const within = evaluateTimeline(doc, 60, 10)
    expect(within.resynced).toBe(false)
    expect(within.markers.map((entry) => entry.id)).toEqual(['m1'])

    const skipped = evaluateTimeline(doc, 61, 10)
    expect(skipped.resynced).toBe(true)
    expect(skipped.markers).toEqual([])

    const first = evaluateTimeline(doc, 10, null)
    expect(first.resynced).toBe(true)
    expect(first.markers).toEqual([])
  })

  it('reports visible clips and sampled keyframe values', () => {
    const doc = timeline({
      durationFrames: 120,
      tracks: [
        track('main', [clip('a', 10, 20), clip('b', 40, 10)], [
          {
            id: 'opacity',
            property: 'opacity',
            keyframes: [
              { id: 'k0', frame: 0, value: 0, easing: linear },
              { id: 'k1', frame: 20, value: 100, easing: linear },
            ],
          },
        ]),
        track('muted', [clip('c', 0, 120)], [], true),
      ],
    })

    const result = evaluateTimeline(doc, 15, 10)
    expect(result.clips.map((entry) => entry.id)).toEqual(['a'])
    expect(result.keyframes).toEqual([
      { trackId: 'main', property: 'opacity', frame: 15, value: 75 },
    ])

    expect(evaluateTimeline(doc, 10, 10).clips.map((entry) => entry.id)).toEqual(['a'])
    expect(evaluateTimeline(doc, 29, 20).clips.map((entry) => entry.id)).toEqual(['a'])
    expect(evaluateTimeline(doc, 30, 25).clips).toEqual([])
  })
})

describe('timecode offset', () => {
  it('maps external frames through offsetFrames', () => {
    const doc = timeline()
    const state = createPlaybackState({ frame: 25, offsetFrames: 100 })
    expect(externalFrameFor(state)).toBe(125)
    expect(timelineFrameFromExternal(doc, state, 140)).toBe(40)
    expect(timelineFrameFromExternal(doc, state, 125)).toBe(25)
  })

  it('wraps external frames when looping and clamps otherwise', () => {
    const doc = timeline()
    const looping = createPlaybackState({ offsetFrames: 100, loop: true })
    expect(timelineFrameFromExternal(doc, looping, 210)).toBe(10)
    expect(syncExternalFrame(doc, looping, 210).frame).toBe(10)

    const clamped = createPlaybackState({ offsetFrames: 100 })
    expect(timelineFrameFromExternal(doc, clamped, 210)).toBe(99)
  })
})
