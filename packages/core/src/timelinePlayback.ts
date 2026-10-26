import type {
  ShowTimeline,
  TimelineClip,
  TimelineEasing,
  TimelineMarker,
  TimelineProperty,
  TimelineTrack,
} from '@lumen/schema'
import { nominalFps } from './timecode'
import { maxGapFrames } from './timeline'

/**
 * Transport state for the show timeline. `frame` is always a timeline frame;
 * `offsetFrames` maps external LTC/MTC frames onto it (external = frame + offset).
 * `rate` is a playback multiplier (1 = realtime, negative reverses).
 */
export interface PlaybackState {
  frame: number
  playing: boolean
  rate: number
  loop: boolean
  offsetFrames: number
}

export interface KeyframeSample {
  trackId: string
  property: TimelineProperty['property']
  /** Timeline frame the value was sampled at. */
  frame: number
  value: number | string
}

export interface TimelineEvaluation {
  frame: number
  previousFrame: number | null
  /** True when markers were skipped because the cursor jumped. */
  resynced: boolean
  clips: TimelineClip[]
  markers: TimelineMarker[]
  keyframes: KeyframeSample[]
}

export function createPlaybackState(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return { frame: 0, playing: false, rate: 1, loop: false, offsetFrames: 0, ...overrides }
}

export function lastFrame(timeline: ShowTimeline): number {
  return Math.max(0, timeline.durationFrames - 1)
}

/** Clamps a frame into the timeline's playable range. */
export function clampFrame(timeline: ShowTimeline, frame: number): number {
  if (!Number.isFinite(frame)) return 0
  return Math.min(lastFrame(timeline), Math.max(0, Math.trunc(frame)))
}

/** Wraps a frame into range when looping, otherwise clamps it. */
export function wrapFrame(timeline: ShowTimeline, frame: number, loop: boolean): number {
  const duration = Math.max(1, timeline.durationFrames)
  if (!loop) return clampFrame(timeline, frame)
  const wrapped = Math.trunc(frame) % duration
  return wrapped < 0 ? wrapped + duration : wrapped
}

export function play(state: PlaybackState): PlaybackState {
  return { ...state, playing: true }
}

export function pause(state: PlaybackState): PlaybackState {
  return { ...state, playing: false }
}

export function stop(state: PlaybackState): PlaybackState {
  return { ...state, playing: false, frame: 0 }
}

export function seek(timeline: ShowTimeline, state: PlaybackState, frame: number): PlaybackState {
  return { ...state, frame: clampFrame(timeline, frame) }
}

export function stepFrame(timeline: ShowTimeline, state: PlaybackState, delta = 1): PlaybackState {
  return { ...state, frame: clampFrame(timeline, state.frame + Math.trunc(delta)) }
}

export function stepSecond(timeline: ShowTimeline, state: PlaybackState, seconds = 1): PlaybackState {
  const frames = Math.round(seconds * nominalFps(timeline.frameRate))
  return stepFrame(timeline, state, frames)
}

/**
 * Advances by elapsed milliseconds. Pure: the caller owns the wall clock.
 * At the end of a non-looping timeline playback pauses on the last frame.
 */
export function advancePlayback(
  timeline: ShowTimeline,
  state: PlaybackState,
  elapsedMs: number,
): PlaybackState {
  if (!state.playing || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || state.rate === 0) {
    return state
  }

  const fps = nominalFps(timeline.frameRate)
  const delta = Math.round((elapsedMs / 1000) * fps * state.rate)
  if (delta === 0) return state

  const next = state.frame + delta
  if (state.loop) {
    return { ...state, frame: wrapFrame(timeline, next, true) }
  }

  const clamped = clampFrame(timeline, next)
  const reachedEnd = delta > 0 ? clamped === lastFrame(timeline) && next > clamped : clamped === 0 && next < 0
  return { ...state, frame: clamped, playing: reachedEnd ? false : state.playing }
}

/** External LTC/MTC frame corresponding to the current timeline frame. */
export function externalFrameFor(state: PlaybackState): number {
  return state.frame + state.offsetFrames
}

/** Timeline frame implied by an external LTC/MTC frame, honouring loop mode. */
export function timelineFrameFromExternal(
  timeline: ShowTimeline,
  state: PlaybackState,
  externalFrame: number,
): number {
  return wrapFrame(timeline, externalFrame - state.offsetFrames, state.loop)
}

/** Applies an external LTC/MTC frame without touching playback flags. */
export function syncExternalFrame(
  timeline: ShowTimeline,
  state: PlaybackState,
  externalFrame: number,
): PlaybackState {
  return { ...state, frame: timelineFrameFromExternal(timeline, state, externalFrame) }
}

/** Clips on unmuted tracks visible at `frame`. */
export function timelineClipsAt(timeline: ShowTimeline, frame: number): TimelineClip[] {
  const clips: TimelineClip[] = []
  for (const track of timeline.tracks) {
    if (track.muted) continue
    for (const clip of track.clips) {
      if (frame >= clip.startFrame && frame < clip.startFrame + clip.durationFrames) {
        clips.push(clip)
      }
    }
  }
  return clips.sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
}

/**
 * Enabled markers crossed between frames. A forward move uses `(previous, frame]`;
 * a same-frame evaluation reports markers exactly at `frame`.
 */
export function timelineMarkersBetween(
  timeline: ShowTimeline,
  previousFrame: number,
  frame: number,
): TimelineMarker[] {
  const forward = frame > previousFrame
  const candidates = timeline.markers.filter((marker) => {
    if (!marker.enabled) return false
    return forward ? marker.frame > previousFrame && marker.frame <= frame : marker.frame === frame
  })

  const seen = new Set<string>()
  const markers: TimelineMarker[] = []
  for (const marker of candidates) {
    if (seen.has(marker.id)) continue
    seen.add(marker.id)
    markers.push(marker)
  }
  return markers.sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id))
}

function cubicBezierEase(t: number, easing: TimelineEasing): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const sample = (a: number, b: number, u: number): number => {
    const inverse = 1 - u
    return 3 * inverse * inverse * u * a + 3 * inverse * u * u * b + u * u * u
  }
  let low = 0
  let high = 1
  let u = t
  for (let index = 0; index < 20; index += 1) {
    u = (low + high) / 2
    if (sample(easing.x1, easing.x2, u) < t) low = u
    else high = u
  }
  return sample(easing.y1, easing.y2, (low + high) / 2)
}

function easeValue(t: number, easing: TimelineEasing): number {
  switch (easing.kind) {
    case 'easeIn':
      return t * t
    case 'easeOut':
      return 1 - (1 - t) * (1 - t)
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) * (-2 * t + 2) / 2
    case 'bezier':
      return cubicBezierEase(t, easing)
    default:
      return t
  }
}

function sampleProperty(property: TimelineProperty, frame: number): number | string | null {
  const keyframes = [...property.keyframes].sort((a, b) => a.frame - b.frame)
  const first = keyframes[0]
  const last = keyframes[keyframes.length - 1]
  if (!first || !last) return null
  if (frame <= first.frame) return first.value
  if (frame >= last.frame) return last.value

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index]
    const to = keyframes[index + 1]
    if (!from || !to || frame < from.frame || frame > to.frame) continue
    const span = to.frame - from.frame
    if (span <= 0) return to.value
    const t = easeValue((frame - from.frame) / span, to.easing)
    if (typeof from.value === 'number' && typeof to.value === 'number') {
      return from.value + (to.value - from.value) * t
    }
    return from.value
  }
  return last.value
}

/** Samples each animated property on a track at `frame`. */
export function sampleKeyframes(track: TimelineTrack, frame: number): KeyframeSample[] {
  const samples: KeyframeSample[] = []
  for (const property of track.properties) {
    const value = sampleProperty(property, frame)
    if (value === null) continue
    samples.push({ trackId: track.id, property: property.property, frame, value })
  }
  return samples
}

/**
 * Evaluates the timeline at `frame`. A backward jump, a gap larger than two
 * seconds of frames, or a first evaluation resynchronizes and fires no markers.
 */
export function evaluateTimeline(
  timeline: ShowTimeline,
  frame: number,
  previousFrame: number | null,
): TimelineEvaluation {
  const current = clampFrame(timeline, frame)
  const gapLimit = maxGapFrames(timeline.frameRate)
  const resynced =
    previousFrame === null ||
    current < previousFrame ||
    current - previousFrame > gapLimit

  const markers = resynced ? [] : timelineMarkersBetween(timeline, previousFrame, current)
  const keyframes: KeyframeSample[] = []
  for (const track of timeline.tracks) {
    if (track.muted) continue
    keyframes.push(...sampleKeyframes(track, current))
  }

  return {
    frame: current,
    previousFrame,
    resynced,
    clips: timelineClipsAt(timeline, current),
    markers,
    keyframes,
  }
}
