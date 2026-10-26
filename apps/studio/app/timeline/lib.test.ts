import type { TimelineClip, TimelineMarker, TimelineTrack } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import {
  TIMELINE_MAX_PX_PER_FRAME,
  TIMELINE_MIN_PX_PER_FRAME,
  clampClipStart,
  clipEndFrame,
  fitPixelsPerFrame,
  frameAtPixel,
  frameToPixel,
  pixelToFrame,
  rulerStepFrames,
  rulerTicks,
  snapClipStart,
  snapFrame,
  snapTargets,
  snapThresholdFrames,
  splitClipAtFrame,
  timecodeLabel,
  trimClipFromEnd,
  actionKey,
  commandForKey,
  commitHistory,
  createHistory,
  exportTimelineJson,
  importTimelineJson,
  pastedClip,
  redoHistory,
  undoHistory,
  trimClipFromStart,
  zoomBy,
} from './lib'

function clip(id: string, startFrame: number, durationFrames: number, trimStartFrames = 0): TimelineClip {
  return {
    id,
    kind: 'slide',
    label: id,
    startFrame,
    durationFrames,
    trimStartFrames,
    presentationId: null,
    slideIndex: null,
    assetId: null,
    action: null,
    gain: 1,
    loop: false,
  }
}

function track(id: string, clips: TimelineClip[]): TimelineTrack {
  return {
    id,
    kind: 'slide',
    name: id,
    muted: false,
    locked: false,
    presentationId: null,
    slideIndex: null,
    elementId: null,
    clips,
    properties: [],
  }
}

function marker(id: string, frame: number): TimelineMarker {
  return { id, frame, label: id, action: null, enabled: true }
}

describe('pixel and frame conversion', () => {
  it('maps frames to pixels at the current zoom', () => {
    expect(frameToPixel(120, 2.5)).toBe(300)
    expect(pixelToFrame(300, 2.5)).toBe(120)
  })

  it('rounds pointer positions and clamps them to the timeline', () => {
    expect(frameAtPixel(101, 2, 1000)).toBe(51)
    expect(frameAtPixel(-40, 2, 1000)).toBe(0)
    expect(frameAtPixel(4000, 2, 1000)).toBe(1000)
  })

  it('guards against a zero zoom', () => {
    expect(pixelToFrame(10, 0)).toBe(0)
    expect(frameAtPixel(10, 0, 100)).toBe(0)
  })

  it('formats frame positions as timecode', () => {
    expect(timecodeLabel(0, '30')).toBe('00:00:00:00')
    expect(timecodeLabel(90, '30')).toBe('00:00:03:00')
    expect(timecodeLabel(25, '25')).toBe('00:00:01:00')
  })
})

describe('snapping', () => {
  it('converts the pixel threshold into frames', () => {
    expect(snapThresholdFrames(4)).toBe(2)
    expect(snapThresholdFrames(2, 16)).toBe(8)
  })

  it('snaps a frame to the nearest target within the threshold', () => {
    expect(snapFrame(100, [90, 104], 5)).toEqual({ frame: 104, target: 104, snapped: true })
    expect(snapFrame(100, [90], 5)).toEqual({ frame: 100, target: null, snapped: false })
    expect(snapFrame(100, [], 5)).toEqual({ frame: 100, target: null, snapped: false })
  })

  it('snaps a clip by its leading or trailing edge, whichever is nearer', () => {
    expect(snapClipStart(100, 30, [99, 131], 3)).toEqual({
      startFrame: 99,
      target: 99,
      snapped: true,
    })
    expect(snapClipStart(100, 30, [131], 3)).toEqual({
      startFrame: 101,
      target: 131,
      snapped: true,
    })
    expect(snapClipStart(100, 30, [200], 3)).toEqual({
      startFrame: 100,
      target: null,
      snapped: false,
    })
  })

  it('collects clip edges and markers, excluding the dragged clip', () => {
    const targets = snapTargets(
      [track('a', [clip('one', 0, 30), clip('two', 60, 15)])],
      [marker('m', 90)],
      'one',
    )
    expect(targets).toEqual([60, 75, 90])
  })

  it('clamps a moved clip inside the timeline', () => {
    expect(clampClipStart(-10, 30, 300)).toBe(0)
    expect(clampClipStart(290, 30, 300)).toBe(270)
    expect(clipEndFrame({ startFrame: 270, durationFrames: 30 })).toBe(300)
  })
})

describe('trim and split', () => {
  it('trims the leading edge without revealing source before the in-point', () => {
    expect(trimClipFromStart({ startFrame: 100, durationFrames: 30, trimStartFrames: 0 }, 90)).toEqual(
      { startFrame: 100, durationFrames: 30, trimStartFrames: 0 },
    )
    expect(trimClipFromStart({ startFrame: 100, durationFrames: 30, trimStartFrames: 10 }, 90)).toEqual(
      { startFrame: 90, durationFrames: 40, trimStartFrames: 0 },
    )
    expect(trimClipFromStart({ startFrame: 100, durationFrames: 30, trimStartFrames: 10 }, 120)).toEqual(
      { startFrame: 120, durationFrames: 10, trimStartFrames: 30 },
    )
  })

  it('trims the trailing edge within the timeline and keeps at least one frame', () => {
    expect(trimClipFromEnd({ startFrame: 100, durationFrames: 30, trimStartFrames: 5 }, 150, 300)).toEqual(
      { startFrame: 100, durationFrames: 50, trimStartFrames: 5 },
    )
    expect(trimClipFromEnd({ startFrame: 100, durationFrames: 30, trimStartFrames: 5 }, 90, 300)).toEqual(
      { startFrame: 100, durationFrames: 1, trimStartFrames: 5 },
    )
    expect(trimClipFromEnd({ startFrame: 100, durationFrames: 30, trimStartFrames: 5 }, 400, 300)).toEqual(
      { startFrame: 100, durationFrames: 200, trimStartFrames: 5 },
    )
  })

  it('splits a clip strictly inside it', () => {
    const [left, right] = splitClipAtFrame(clip('one', 30, 90, 10), 60) ?? []
    expect(left?.startFrame).toBe(30)
    expect(left?.durationFrames).toBe(30)
    expect(left?.trimStartFrames).toBe(10)
    expect(right?.startFrame).toBe(60)
    expect(right?.durationFrames).toBe(60)
    expect(right?.trimStartFrames).toBe(40)
    expect(splitClipAtFrame(clip('one', 30, 90), 30)).toBeNull()
    expect(splitClipAtFrame(clip('one', 30, 90), 120)).toBeNull()
  })
})

describe('zoom and ruler', () => {
  it('clamps zoom to the supported range', () => {
    expect(zoomBy(2, 2)).toBe(4)
    expect(zoomBy(TIMELINE_MAX_PX_PER_FRAME, 2)).toBe(TIMELINE_MAX_PX_PER_FRAME)
    expect(zoomBy(TIMELINE_MIN_PX_PER_FRAME, 0.5)).toBe(TIMELINE_MIN_PX_PER_FRAME)
  })

  it('fits the timeline into the viewport', () => {
    expect(fitPixelsPerFrame(1000, 1000, 20)).toBeCloseTo(0.98)
    expect(fitPixelsPerFrame(100, 10_000, 20)).toBe(TIMELINE_MIN_PX_PER_FRAME)
    expect(fitPixelsPerFrame(0, 100)).toBe(3)
  })

  it('keeps ruler labels at least 64 pixels apart', () => {
    expect(rulerStepFrames(3, '30')).toBe(30)
    expect(rulerStepFrames(10, '30')).toBe(10)
    expect(rulerStepFrames(0.5, '30')).toBe(150)
  })

  it('generates labelled ticks over the timeline duration', () => {
    const ticks = rulerTicks(3, '30', 120)
    expect(ticks.map((tick) => tick.frame)).toEqual([0, 30, 60, 90, 120])
    expect(ticks[1]?.label).toBe('00:00:01:00')
  })
})

describe('edit history', () => {
  it('undoes and redoes committed snapshots', () => {
    let history = createHistory('a')
    history = commitHistory(history, 'b')
    history = commitHistory(history, 'b')
    history = commitHistory(history, 'c')
    expect(history.past).toEqual(['a', 'b'])
    history = undoHistory(history)
    expect(history.present).toBe('b')
    history = redoHistory(history)
    expect(history.present).toBe('c')
    history = undoHistory(undoHistory(history))
    history = commitHistory(history, 'd')
    expect(history.future).toEqual([])
    expect(undoHistory(createHistory('x')).present).toBe('x')
  })

  it('caps the undo stack', () => {
    let history = createHistory('0')
    for (let index = 1; index <= 5; index += 1) history = commitHistory(history, String(index), 3)
    expect(history.past).toEqual(['2', '3', '4'])
  })
})

describe('clipboard and json', () => {
  it('pastes a clip with a new id inside the timeline', () => {
    const source = clip('c1', 0, 50)
    const pasted = pastedClip(source, 90, 100, 'c2')
    expect(pasted).toMatchObject({ id: 'c2', startFrame: 50, durationFrames: 50 })
  })

  it('round-trips a timeline with fresh ids', () => {
    let counter = 0
    const doc = {
      schemaVersion: 1 as const,
      id: 'tl',
      name: 'Show',
      frameRate: '25' as const,
      durationFrames: 100,
      tracks: [{ id: 't', kind: 'slide' as const, name: 'S', muted: false, locked: false, presentationId: null, slideIndex: null, elementId: null, clips: [clip('c', 0, 10)], properties: [] }],
      markers: [{ id: 'm', frame: 5, label: 'Go', action: { type: 'take' as const }, enabled: true }],
    }
    const imported = importTimelineJson(exportTimelineJson(doc), (prefix) => `${prefix}-${++counter}`)
    expect(imported.id).toBe('timeline-1')
    expect(imported.tracks[0]?.clips[0]?.id).toMatch(/^clip-/)
    expect(imported.markers[0]).toMatchObject({ frame: 5, action: { type: 'take' } })
    expect(() => importTimelineJson('{')).toThrow('not valid JSON')
    expect(() => importTimelineJson('{"name":1}')).toThrow('Not a Lumen timeline')
  })

  it('maps actions to commands and back', () => {
    expect(commandForKey('mode:black')).toEqual({ type: 'setMode', mode: 'black' })
    expect(actionKey({ type: 'setMode', mode: 'logo' })).toBe('mode:logo')
    expect(actionKey({ type: 'nextItem' })).toBe('nextItem')
    expect(commandForKey('none')).toBeNull()
  })
})
