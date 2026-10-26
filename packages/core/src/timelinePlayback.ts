import type {
  ShowTimeline,
  TimelineClip,
  TimelineMarker,
  TimelineProperty,
  TimelineTrack,
} from '@lumen/schema'
import { nominalFps } from './timecode'
import { maxGapFrames } from './timeline'
import {
  clampFrame,
  sampleKeyframes,
  timelineClipsAt,
  timelineMarkersBetween,
  timelineTotalDurationFrames,
} from './showTimeline'

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
  return Math.max(0, timelineTotalDurationFrames(timeline) - 1)
}

/** Wraps a frame into range when looping, otherwise clamps it. */
export function wrapFrame(timeline: ShowTimeline, frame: number, loop: boolean): number {
  if (!loop) return clampFrame(timeline, frame)
  const duration = Math.max(1, timelineTotalDurationFrames(timeline))
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

function activeMarkers(
  timeline: ShowTimeline,
  previousFrame: number | null,
  frame: number,
): TimelineMarker[] {
  if (previousFrame === null || frame <= previousFrame) return []
  const seen = new Set<string>()
  const markers: TimelineMarker[] = []
  for (const marker of timelineMarkersBetween(timeline, previousFrame, frame)) {
    if (!marker.enabled || seen.has(marker.id)) continue
    seen.add(marker.id)
    markers.push(marker)
  }
  return markers
}

function sampleTrackKeyframes(track: TimelineTrack, frame: number): KeyframeSample[] {
  const samples: KeyframeSample[] = []
  for (const property of track.properties) {
    const value = sampleKeyframes(property, frame)
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
    previousFrame === null || current < previousFrame || current - previousFrame > gapLimit

  const keyframes: KeyframeSample[] = []
  for (const track of timeline.tracks) {
    if (track.muted) continue
    keyframes.push(...sampleTrackKeyframes(track, current))
  }

  return {
    frame: current,
    previousFrame,
    resynced,
    clips: timelineClipsAt(timeline, current)
      .filter((entry) => !entry.track.muted)
      .map((entry) => entry.clip),
    markers: resynced ? [] : activeMarkers(timeline, previousFrame, current),
    keyframes,
  }
}
