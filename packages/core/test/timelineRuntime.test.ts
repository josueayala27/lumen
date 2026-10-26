import { describe, expect, it } from 'vitest'
import type { Scene, SceneLayer, ShowTimeline, TimelineClip, TimelineDoc, TimelineTrack } from '@lumen/schema'
import { evaluateTimeline } from '../src/timelinePlayback'
import {
  activeMediaClips,
  applyKeyframeSamples,
  clipsStartingBetween,
  mediaClipSourceSeconds,
  showTimelineFromCueDoc,
  timelineActions,
} from '../src/timelineRuntime'

function clip(id: string, startFrame: number, durationFrames: number, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    kind: 'slide',
    label: id,
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

function track(id: string, overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id,
    kind: 'slide',
    name: id,
    muted: false,
    locked: false,
    presentationId: null,
    slideIndex: null,
    elementId: null,
    clips: [],
    properties: [],
    ...overrides,
  }
}

function timeline(overrides: Partial<ShowTimeline> = {}): ShowTimeline {
  return {
    schemaVersion: 1,
    id: 'timeline-1',
    name: 'Show',
    frameRate: '25',
    durationFrames: 500,
    tracks: [],
    markers: [],
    ...overrides,
  }
}

const linear = { kind: 'linear' as const, x1: 0.25, y1: 0, x2: 0.75, y2: 1 }

describe('showTimelineFromCueDoc', () => {
  it('keeps cue frame counts as markers', () => {
    const doc: TimelineDoc = {
      schemaVersion: 1,
      id: 'legacy',
      name: 'Service timeline',
      frameRate: '29.97df',
      cues: [
        { id: 'b', label: 'Chorus', atFrames: 900, action: { type: 'next' }, enabled: true },
        { id: 'a', label: 'Intro', atFrames: 30, action: { type: 'take' }, enabled: false },
      ],
    }
    const result = showTimelineFromCueDoc(doc)
    expect(result.markers.map((marker) => [marker.id, marker.frame, marker.enabled])).toEqual([
      ['a', 30, false],
      ['b', 900, true],
    ])
    expect(result.markers[1]?.action).toEqual({ type: 'next' })
    expect(result.durationFrames).toBeGreaterThan(900)
    expect(result.frameRate).toBe('29.97df')
  })
})

describe('timelineActions', () => {
  const doc = timeline({
    tracks: [
      track('slides', {
        clips: [
          clip('s1', 0, 50, { presentationId: 'p1', slideIndex: 0 }),
          clip('s2', 50, 50, { presentationId: 'p1', slideIndex: 1 }),
        ],
      }),
      track('macros', { kind: 'macro', clips: [clip('m1', 50, 10, { kind: 'macro', action: { type: 'setMode', mode: 'black' } })] }),
      track('audio', { kind: 'audio', clips: [clip('a1', 20, 200, { kind: 'audio', assetId: 'song', trimStartFrames: 25 })] }),
      track('muted', { muted: true, clips: [clip('x', 50, 10, { presentationId: 'p2', slideIndex: 4 })] }),
    ],
    markers: [{ id: 'mk', frame: 50, label: 'Go', action: { type: 'take' }, enabled: true }],
  })

  it('fires markers before clip starts crossed in one step', () => {
    const actions = timelineActions(doc, evaluateTimeline(doc, 52, 49))
    expect(actions.map((action) => action.kind)).toEqual(['command', 'slide', 'command'])
    expect(actions[0]).toMatchObject({ source: 'marker', command: { type: 'take' } })
    expect(actions[1]).toMatchObject({ kind: 'slide', presentationId: 'p1', slideIndex: 1 })
    expect(actions[2]).toMatchObject({ source: 'clip', command: { type: 'setMode', mode: 'black' } })
  })

  it('chases the active slide and media on resync without firing macros', () => {
    const actions = timelineActions(doc, evaluateTimeline(doc, 55, null))
    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({ kind: 'slide', slideIndex: 1 })
    expect(actions[1]).toMatchObject({ kind: 'media', assetId: 'song', offsetFrames: 35 })
  })

  it('ignores muted tracks', () => {
    expect(clipsStartingBetween(doc, 49, 50).map((entry) => entry.id)).toEqual(['s2', 'm1'])
  })

  it('reports media offsets including trim', () => {
    const evaluation = evaluateTimeline(doc, 70, 69)
    expect(activeMediaClips(evaluation)).toEqual([{ clip: doc.tracks[2]!.clips[0], offsetFrames: 75 }])
    expect(mediaClipSourceSeconds(doc, doc.tracks[2]!.clips[0]!, 70)).toBe(3)
  })
})

describe('applyKeyframeSamples', () => {
  const text: SceneLayer = {
    kind: 'text',
    id: 'title',
    frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.2, rotation: 0 },
    z: 0,
    opacity: 1,
    runs: [{ text: 'Hi', bold: false, italic: false, underline: false, color: null }],
    fontId: 'inter',
    fontSize: 64,
    weight: 400,
    color: '#ffffff',
    align: 'center',
    vAlign: 'middle',
    lineHeight: 1.2,
    letterSpacing: 0,
    fit: 'wrap',
    padding: 0,
    maxLines: null,
    shadow: null,
    outline: null,
  }
  const scene = { layers: [text] } as unknown as Scene
  const doc = timeline({
    tracks: [
      track('anim', {
        kind: 'layer',
        presentationId: 'p1',
        slideIndex: 0,
        elementId: 'title',
        properties: [
          {
            id: 'op',
            property: 'opacity',
            keyframes: [
              { id: 'k1', frame: 0, value: 0, easing: linear },
              { id: 'k2', frame: 10, value: 1, easing: linear },
            ],
          },
          { id: 'x', property: 'x', keyframes: [{ id: 'k3', frame: 0, value: 0.3, easing: linear }] },
        ],
      }),
    ],
  })

  it('overrides animated properties on the target slide', () => {
    const samples = evaluateTimeline(doc, 5, null).keyframes
    const result = applyKeyframeSamples(scene, doc, samples, { presentationId: 'p1', slideIndex: 0 })
    const layer = result.layers[0]!
    expect(layer.opacity).toBeCloseTo(0.5)
    expect(layer.frame.x).toBe(0.3)
    expect(layer.frame.y).toBe(0.1)
  })

  it('leaves other slides untouched', () => {
    const samples = evaluateTimeline(doc, 5, null).keyframes
    expect(applyKeyframeSamples(scene, doc, samples, { presentationId: 'p1', slideIndex: 1 })).toBe(scene)
  })
})
