import { describe, expect, it } from 'vitest'
import { showTimelineSchema } from '@lumen/schema'
import type { ShowTimeline, TimelineProperty } from '@lumen/schema'
import {
  addClip,
  addKeyframe,
  addMarker,
  addProperty,
  addTrack,
  clampDurationFrames,
  clampFrame,
  clipEndFrame,
  clipsOverlap,
  createShowTimeline,
  moveClip,
  moveMarker,
  parseShowTimeline,
  removeClip,
  removeKeyframe,
  removeMarker,
  removeTrack,
  sampleKeyframes,
  splitClip,
  timelineClipsAt,
  timelineMarkersBetween,
  timelineTotalDurationFrames,
  trimClip,
} from '../src/index'
import type { TimelineKeyframeInput } from '../src/index'

function emptyShow(durationFrames = 100): ShowTimeline {
  return createShowTimeline('Show', '25', durationFrames)
}

function withTrack(): ShowTimeline {
  return addTrack(emptyShow(), { id: 'track-1', kind: 'slide', name: 'Slides' })
}

function withClip(input: Partial<Parameters<typeof addClip>[2]> = {}): ShowTimeline {
  return addClip(withTrack(), 'track-1', {
    id: 'clip-1',
    kind: 'slide',
    startFrame: 10,
    durationFrames: 20,
    ...input,
  })
}

function withProperty(keyframes: TimelineKeyframeInput[]): {
  timeline: ShowTimeline
  property: TimelineProperty
} {
  let timeline = addProperty(withTrack(), 'track-1', { id: 'property-x', property: 'x' })
  for (const keyframe of keyframes) {
    timeline = addKeyframe(timeline, 'track-1', 'property-x', keyframe)
  }
  const property = timeline.tracks[0]!.properties.find((entry) => entry.id === 'property-x')!
  return { timeline, property }
}

describe('createShowTimeline', () => {
  it('creates a schema-valid empty timeline', () => {
    const timeline = createShowTimeline('Service', '29.97df', 300)
    expect(showTimelineSchema.parse(timeline)).toEqual(timeline)
    expect(timeline.name).toBe('Service')
    expect(timeline.frameRate).toBe('29.97df')
    expect(timeline.durationFrames).toBe(300)
    expect(timeline.tracks).toEqual([])
    expect(timeline.markers).toEqual([])
  })

  it('clamps duration to at least one frame and validates names', () => {
    expect(clampDurationFrames(0)).toBe(1)
    expect(createShowTimeline('Show', '25', -4).durationFrames).toBe(1)
    expect(() => createShowTimeline('', '25', 100)).toThrow()
    expect(() => parseShowTimeline({})).toThrow()
  })
})

describe('tracks and clips', () => {
  it('adds tracks with schema defaults', () => {
    const timeline = withTrack()
    const track = timeline.tracks[0]!
    expect(track.name).toBe('Slides')
    expect(track.muted).toBe(false)
    expect(track.locked).toBe(false)
    expect(track.clips).toEqual([])
    expect(track.properties).toEqual([])
  })

  it('adds clips with defaults and keeps them sorted', () => {
    let timeline = withClip()
    timeline = addClip(timeline, 'track-1', {
      id: 'clip-2',
      kind: 'media',
      startFrame: 50,
      durationFrames: 10,
    })
    timeline = addClip(timeline, 'track-1', {
      id: 'clip-0',
      kind: 'macro',
      startFrame: 0,
      durationFrames: 5,
    })

    const clips = timeline.tracks[0]!.clips
    expect(clips.map((clip) => clip.id)).toEqual(['clip-0', 'clip-1', 'clip-2'])
    expect(clips[1]!.label).toBe('')
    expect(clips[1]!.trimStartFrames).toBe(0)
    expect(clips[1]!.gain).toBe(1)
    expect(clips[1]!.loop).toBe(false)
    expect(clips[1]!.action).toBeNull()
  })

  it('rejects overlapping clips but allows touching edges', () => {
    const timeline = withClip({ startFrame: 10, durationFrames: 20 })
    expect(() =>
      addClip(timeline, 'track-1', { id: 'overlap', kind: 'slide', startFrame: 25, durationFrames: 10 }),
    ).toThrow(/overlaps/)
    expect(() =>
      addClip(timeline, 'track-1', { id: 'later', kind: 'slide', startFrame: 30, durationFrames: 10 }),
    ).not.toThrow()
    expect(clipsOverlap(timeline.tracks[0]!.clips[0]!, timeline.tracks[0]!.clips[0]!)).toBe(true)
  })

  it('moves a clip without mutating the original timeline', () => {
    let timeline = withClip()
    timeline = addClip(timeline, 'track-1', {
      id: 'clip-2',
      kind: 'slide',
      startFrame: 50,
      durationFrames: 10,
    })

    const moved = moveClip(timeline, 'clip-2', 0)
    expect(moved.tracks[0]!.clips.map((clip) => clip.id)).toEqual(['clip-2', 'clip-1'])
    expect(moved.tracks).not.toBe(timeline.tracks)
    expect(timeline.tracks[0]!.clips.map((clip) => clip.id)).toEqual(['clip-1', 'clip-2'])
    expect(moveClip(timeline, 'clip-1', -20).tracks[0]!.clips[0]!.startFrame).toBe(0)
    expect(() => moveClip(timeline, 'clip-1', 45)).toThrow(/overlaps/)
  })

  it('trims both edges and respects trim start limits', () => {
    const timeline = withClip({ startFrame: 10, durationFrames: 20, trimStartFrames: 5 })

    const startTrimmed = trimClip(timeline, 'clip-1', 'start', 5)
    expect(startTrimmed.tracks[0]!.clips[0]!.startFrame).toBe(15)
    expect(startTrimmed.tracks[0]!.clips[0]!.durationFrames).toBe(15)
    expect(startTrimmed.tracks[0]!.clips[0]!.trimStartFrames).toBe(10)

    const extended = trimClip(timeline, 'clip-1', 'start', -5)
    expect(extended.tracks[0]!.clips[0]!.startFrame).toBe(5)
    expect(extended.tracks[0]!.clips[0]!.durationFrames).toBe(25)
    expect(extended.tracks[0]!.clips[0]!.trimStartFrames).toBe(0)

    const endTrimmed = trimClip(timeline, 'clip-1', 'end', -5)
    expect(endTrimmed.tracks[0]!.clips[0]!.durationFrames).toBe(15)
    expect(endTrimmed.tracks[0]!.clips[0]!.startFrame).toBe(10)
  })

  it('rejects trims that would overlap a neighbouring clip', () => {
    let timeline = withClip({ id: 'a', startFrame: 10, durationFrames: 20 })
    timeline = addClip(timeline, 'track-1', {
      id: 'b',
      kind: 'slide',
      startFrame: 30,
      durationFrames: 20,
    })
    expect(() => trimClip(timeline, 'a', 'end', 1)).toThrow(/overlaps/)
  })

  it('splits a clip at an interior frame', () => {
    const timeline = withClip({ startFrame: 10, durationFrames: 20, trimStartFrames: 3 })
    const split = splitClip(timeline, 'clip-1', 20)
    const clips = split.tracks[0]!.clips

    expect(clips).toHaveLength(2)
    expect(clips[0]!.id).toBe('clip-1')
    expect(clips[0]!.startFrame).toBe(10)
    expect(clips[0]!.durationFrames).toBe(10)
    expect(clips[0]!.trimStartFrames).toBe(3)
    expect(clips[1]!.startFrame).toBe(20)
    expect(clips[1]!.durationFrames).toBe(10)
    expect(clips[1]!.trimStartFrames).toBe(13)
    expect(clipEndFrame(clips[1]!)).toBe(30)

    expect(splitClip(timeline, 'clip-1', 10)).toBe(timeline)
    expect(splitClip(timeline, 'clip-1', 30)).toBe(timeline)
  })

  it('removes clips and tracks', () => {
    const timeline = withClip()
    expect(removeClip(timeline, 'clip-1').tracks[0]!.clips).toEqual([])
    expect(removeTrack(timeline, 'track-1').tracks).toEqual([])
    expect(() => removeClip(timeline, 'missing')).toThrow()
    expect(() => removeTrack(timeline, 'missing')).toThrow()
  })
})

describe('markers', () => {
  it('adds, sorts, moves and removes markers', () => {
    let timeline = emptyShow()
    timeline = addMarker(timeline, { id: 'm-30', frame: 30 })
    timeline = addMarker(timeline, { id: 'm-10', frame: 10 })
    timeline = addMarker(timeline, { id: 'm-20', frame: 20 })
    expect(timeline.markers.map((marker) => marker.id)).toEqual(['m-10', 'm-20', 'm-30'])
    expect(timeline.markers[1]!.label).toBe('')
    expect(timeline.markers[1]!.enabled).toBe(true)

    const moved = moveMarker(timeline, 'm-20', 5)
    expect(moved.markers.map((marker) => marker.frame)).toEqual([5, 10, 30])
    expect(moveMarker(timeline, 'm-20', -5).markers[0]!.frame).toBe(0)
    expect(removeMarker(timeline, 'm-10').markers.map((marker) => marker.id)).toEqual([
      'm-20',
      'm-30',
    ])
    expect(() => removeMarker(timeline, 'missing')).toThrow()
  })

  it('selects markers in an exclusive-inclusive window', () => {
    let timeline = emptyShow()
    for (const [id, frame] of [
      ['m-0', 0],
      ['m-10', 10],
      ['m-20', 20],
      ['m-30', 30],
    ] as const) {
      timeline = addMarker(timeline, { id, frame })
    }
    const between = timelineMarkersBetween(timeline, 10, 30)
    expect(between.map((marker) => marker.frame)).toEqual([20, 30])
    expect(timelineMarkersBetween(timeline, 30, 30)).toEqual([])
  })
})

describe('properties and keyframes', () => {
  it('adds properties and replaces a keyframe on the same frame', () => {
    const { timeline, property } = withProperty([
      { id: 'k-0', frame: 0, value: 0 },
      { id: 'k-10', frame: 10, value: 100 },
      { id: 'k-replacement', frame: 10, value: 40 },
    ])

    expect(property.keyframes).toHaveLength(2)
    expect(property.keyframes[1]!.value).toBe(40)
    expect(property.keyframes[0]!.easing.kind).toBe('linear')
    expect(removeKeyframe(timeline, 'track-1', 'property-x', 'k-0')).toBeDefined()
    expect(
      removeKeyframe(timeline, 'track-1', 'property-x', 'k-0').tracks[0]!.properties[0]!.keyframes,
    ).toHaveLength(1)
    expect(() => removeKeyframe(timeline, 'track-1', 'missing', 'k-0')).toThrow()
  })

  it('interpolates numeric keyframes linearly and clamps outside the range', () => {
    const { property } = withProperty([
      { id: 'k-0', frame: 0, value: 0 },
      { id: 'k-10', frame: 10, value: 100 },
    ])

    expect(sampleKeyframes(property, 5)).toBe(50)
    expect(sampleKeyframes(property, -5)).toBe(0)
    expect(sampleKeyframes(property, 0)).toBe(0)
    expect(sampleKeyframes(property, 10)).toBe(100)
    expect(sampleKeyframes(property, 50)).toBe(100)
  })

  it('applies named and custom bezier easing', () => {
    const easeIn = withProperty([
      { id: 'k-0', frame: 0, value: 0, easing: { kind: 'easeIn' } },
      { id: 'k-10', frame: 10, value: 100 },
    ])
    const easeOut = withProperty([
      { id: 'k-0', frame: 0, value: 0, easing: { kind: 'easeOut' } },
      { id: 'k-10', frame: 10, value: 100 },
    ])
    const bezier = withProperty([
      {
        id: 'k-0',
        frame: 0,
        value: 0,
        easing: { kind: 'bezier', x1: 0.42, y1: 0, x2: 1, y2: 1 },
      },
      { id: 'k-10', frame: 10, value: 100 },
    ])

    const easedIn = sampleKeyframes(easeIn.property, 5) as number
    const easedOut = sampleKeyframes(easeOut.property, 5) as number
    const bespoke = sampleKeyframes(bezier.property, 5) as number

    expect(easedIn).toBeLessThan(50)
    expect(easedOut).toBeGreaterThan(50)
    expect(bespoke).toBeLessThan(50)
    expect(easedIn).toBeCloseTo(bespoke, 4)
    expect(sampleKeyframes(easeIn.property, 0)).toBe(0)
    expect(sampleKeyframes(easeIn.property, 10)).toBe(100)
  })

  it('steps string values and handles empty or single keyframes', () => {
    const stepped = withProperty([
      { id: 'k-0', frame: 0, value: 'red' },
      { id: 'k-10', frame: 10, value: 'blue' },
    ])
    expect(sampleKeyframes(stepped.property, 5)).toBe('red')
    expect(sampleKeyframes(stepped.property, 10)).toBe('blue')

    const single = withProperty([{ id: 'k-0', frame: 0, value: 7 }])
    expect(sampleKeyframes(single.property, 99)).toBe(7)

    const empty = withProperty([])
    expect(sampleKeyframes(empty.property, 0)).toBeNull()
  })
})

describe('timeline queries', () => {
  it('returns active clips in track then start order', () => {
    let timeline = addTrack(emptyShow(), { id: 'track-1', kind: 'slide' })
    timeline = addTrack(timeline, { id: 'track-2', kind: 'layer' })
    timeline = addClip(timeline, 'track-1', {
      id: 'a',
      kind: 'slide',
      startFrame: 10,
      durationFrames: 20,
    })
    timeline = addClip(timeline, 'track-2', {
      id: 'b',
      kind: 'media',
      startFrame: 0,
      durationFrames: 10,
    })

    expect(timelineClipsAt(timeline, 9).map((entry) => entry.clip.id)).toEqual(['b'])
    expect(timelineClipsAt(timeline, 10).map((entry) => entry.clip.id)).toEqual(['a'])
    expect(timelineClipsAt(timeline, 29).map((entry) => entry.clip.id)).toEqual(['a'])
    expect(timelineClipsAt(timeline, 30)).toEqual([])
    expect(timelineClipsAt(timeline, 10)[0]!.track.id).toBe('track-1')
  })

  it('clamps frames and measures total duration including overflow clips', () => {
    let timeline = withClip({ startFrame: 90, durationFrames: 20 })
    expect(timelineTotalDurationFrames(timeline)).toBe(110)
    expect(clampFrame(timeline, 500)).toBe(109)
    expect(clampFrame(timeline, -5)).toBe(0)

    const empty = emptyShow(100)
    expect(timelineTotalDurationFrames(empty)).toBe(100)
    expect(clampFrame(empty, 200)).toBe(99)
  })
})
