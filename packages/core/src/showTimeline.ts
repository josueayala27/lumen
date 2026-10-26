import {
  showTimelineSchema,
  timelineClipSchema,
  timelineKeyframeSchema,
  timelineMarkerSchema,
  timelinePropertySchema,
  timelineTrackSchema,
} from '@lumen/schema'
import type {
  ControlCommand,
  FrameRate,
  ShowTimeline,
  TimelineClip,
  TimelineEasing,
  TimelineKeyframe,
  TimelineMarker,
  TimelineProperty,
  TimelineTrack,
} from '@lumen/schema'

export type TimelineClipInput = {
  id?: string
  kind: TimelineClip['kind']
  label?: string
  startFrame: number
  durationFrames: number
  trimStartFrames?: number
  presentationId?: string | null
  slideIndex?: number | null
  assetId?: string | null
  action?: ControlCommand | null
  gain?: number
  loop?: boolean
}

export type TimelineKeyframeInput = {
  id?: string
  frame: number
  value: number | string
  easing?: Partial<TimelineEasing>
}

export type TimelinePropertyInput = {
  id?: string
  property: TimelineProperty['property']
  keyframes?: TimelineKeyframeInput[]
}

export type TimelineTrackInput = {
  id?: string
  kind: TimelineTrack['kind']
  name?: string
  muted?: boolean
  locked?: boolean
  presentationId?: string | null
  slideIndex?: number | null
  elementId?: string | null
  clips?: TimelineClipInput[]
  properties?: TimelinePropertyInput[]
}

export type TimelineMarkerInput = {
  id?: string
  frame: number
  label?: string
  action?: ControlCommand | null
  enabled?: boolean
}

export type TimelineActiveClip = {
  track: TimelineTrack
  clip: TimelineClip
}

let fallbackId = 0

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  fallbackId += 1
  return `${prefix}-${fallbackId}`
}

function nonNegativeFrame(frame: number): number {
  const value = Math.trunc(Number(frame))
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function clampDurationFrames(durationFrames: number): number {
  const value = Math.trunc(Number(durationFrames))
  return Number.isFinite(value) ? Math.max(1, value) : 1
}

/** Parses and normalizes a timeline against the shared schema. */
export function parseShowTimeline(input: unknown): ShowTimeline {
  return showTimelineSchema.parse(input)
}

export function createShowTimeline(
  name: string,
  frameRate: FrameRate,
  durationFrames: number,
): ShowTimeline {
  return showTimelineSchema.parse({
    schemaVersion: 1,
    id: makeId('timeline'),
    name,
    frameRate,
    durationFrames: clampDurationFrames(durationFrames),
    tracks: [],
    markers: [],
  })
}

export function clipEndFrame(clip: TimelineClip): number {
  return clip.startFrame + clip.durationFrames
}

/**
 * Clips occupy a half-open range: `[startFrame, startFrame + durationFrames)`.
 * Touching edges do not overlap.
 */
export function clipsOverlap(a: TimelineClip, b: TimelineClip): boolean {
  return a.startFrame < clipEndFrame(b) && b.startFrame < clipEndFrame(a)
}

export function sortClips(clips: readonly TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
}

export function sortMarkers(markers: readonly TimelineMarker[]): TimelineMarker[] {
  return [...markers].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id))
}

function sortKeyframes(keyframes: readonly TimelineKeyframe[]): TimelineKeyframe[] {
  return [...keyframes].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id))
}

/** Total length in frames, extended by clips that run past the declared duration. */
export function timelineTotalDurationFrames(timeline: ShowTimeline): number {
  let total = clampDurationFrames(timeline.durationFrames)
  for (const track of timeline.tracks) {
    for (const clip of track.clips) total = Math.max(total, clipEndFrame(clip))
  }
  return total
}

/** Clamps a frame into `[0, totalDurationFrames - 1]`. */
export function clampFrame(timeline: ShowTimeline, frame: number): number {
  const total = timelineTotalDurationFrames(timeline)
  return Math.min(nonNegativeFrame(frame), Math.max(0, total - 1))
}

function mapTrack(
  timeline: ShowTimeline,
  trackId: string,
  update: (track: TimelineTrack) => TimelineTrack,
): ShowTimeline {
  let found = false
  const tracks = timeline.tracks.map((track) => {
    if (track.id !== trackId) return track
    found = true
    return update(track)
  })
  if (!found) throw new Error(`Unknown track: ${trackId}`)
  return { ...timeline, tracks }
}

type LocatedClip = {
  trackIndex: number
  clipIndex: number
  track: TimelineTrack
  clip: TimelineClip
}

function locateClip(timeline: ShowTimeline, clipId: string): LocatedClip {
  for (let trackIndex = 0; trackIndex < timeline.tracks.length; trackIndex += 1) {
    const track = timeline.tracks[trackIndex]!
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId)
    if (clipIndex !== -1) {
      return { trackIndex, clipIndex, track, clip: track.clips[clipIndex]! }
    }
  }
  throw new Error(`Unknown clip: ${clipId}`)
}

function replaceClip(
  timeline: ShowTimeline,
  trackIndex: number,
  clipIndex: number,
  update: (clip: TimelineClip) => TimelineClip,
): ShowTimeline {
  const tracks = timeline.tracks.slice()
  const track = tracks[trackIndex]!
  const clips = track.clips.slice()
  clips[clipIndex] = update(clips[clipIndex]!)
  tracks[trackIndex] = { ...track, clips: sortClips(clips) }
  return { ...timeline, tracks }
}

function assertNoOverlap(track: TimelineTrack, clip: TimelineClip): void {
  const conflict = track.clips.find(
    (existing) => existing.id !== clip.id && clipsOverlap(existing, clip),
  )
  if (conflict) {
    throw new Error(`Clip ${clip.id} overlaps ${conflict.id} on track ${track.id}`)
  }
}

export function addTrack(timeline: ShowTimeline, input: TimelineTrackInput): ShowTimeline {
  const track = timelineTrackSchema.parse({ ...input, id: input.id ?? makeId('track') })
  if (timeline.tracks.some((existing) => existing.id === track.id)) {
    throw new Error(`Duplicate track id: ${track.id}`)
  }
  return { ...timeline, tracks: [...timeline.tracks, track] }
}

export function removeTrack(timeline: ShowTimeline, trackId: string): ShowTimeline {
  const tracks = timeline.tracks.filter((track) => track.id !== trackId)
  if (tracks.length === timeline.tracks.length) throw new Error(`Unknown track: ${trackId}`)
  return { ...timeline, tracks }
}

export function addClip(
  timeline: ShowTimeline,
  trackId: string,
  input: TimelineClipInput,
): ShowTimeline {
  const clip = timelineClipSchema.parse({ ...input, id: input.id ?? makeId('clip') })
  return mapTrack(timeline, trackId, (track) => {
    assertNoOverlap(track, clip)
    return { ...track, clips: sortClips([...track.clips, clip]) }
  })
}

export function moveClip(
  timeline: ShowTimeline,
  clipId: string,
  startFrame: number,
): ShowTimeline {
  const { trackIndex, clipIndex, track, clip } = locateClip(timeline, clipId)
  const moved: TimelineClip = { ...clip, startFrame: nonNegativeFrame(startFrame) }
  assertNoOverlap(track, moved)
  return replaceClip(timeline, trackIndex, clipIndex, () => moved)
}

/**
 * Trims a clip edge by a frame delta. A positive start delta moves the start
 * later (and advances `trimStartFrames`); a positive end delta extends the end.
 */
export function trimClip(
  timeline: ShowTimeline,
  clipId: string,
  edge: 'start' | 'end',
  deltaFrames: number,
): ShowTimeline {
  const { trackIndex, clipIndex, track, clip } = locateClip(timeline, clipId)
  const delta = Math.trunc(Number(deltaFrames)) || 0
  const end = clipEndFrame(clip)

  let next: TimelineClip
  if (edge === 'start') {
    const minStart = Math.max(0, clip.startFrame - clip.trimStartFrames)
    const startFrame = Math.min(Math.max(clip.startFrame + delta, minStart), end - 1)
    const shift = startFrame - clip.startFrame
    next = {
      ...clip,
      startFrame,
      durationFrames: clip.durationFrames - shift,
      trimStartFrames: clip.trimStartFrames + shift,
    }
  } else {
    const nextEnd = Math.max(clip.startFrame + 1, end + delta)
    next = { ...clip, durationFrames: nextEnd - clip.startFrame }
  }

  assertNoOverlap(track, next)
  return replaceClip(timeline, trackIndex, clipIndex, () => next)
}

/** Splits a clip at an interior frame. Frames on the edges are a no-op. */
export function splitClip(
  timeline: ShowTimeline,
  clipId: string,
  frame: number,
): ShowTimeline {
  const { trackIndex, clipIndex, track, clip } = locateClip(timeline, clipId)
  const at = Math.trunc(Number(frame))
  const start = clip.startFrame
  const end = clipEndFrame(clip)
  if (!Number.isFinite(at) || at <= start || at >= end) return timeline

  const firstDuration = at - start
  const first: TimelineClip = { ...clip, durationFrames: firstDuration }
  const second: TimelineClip = {
    ...clip,
    id: makeId('clip'),
    startFrame: at,
    durationFrames: end - at,
    trimStartFrames: clip.trimStartFrames + firstDuration,
  }

  const tracks = timeline.tracks.slice()
  const clips = track.clips.slice()
  clips.splice(clipIndex, 1, first, second)
  tracks[trackIndex] = { ...track, clips: sortClips(clips) }
  return { ...timeline, tracks }
}

export function removeClip(timeline: ShowTimeline, clipId: string): ShowTimeline {
  const { trackIndex, clipIndex, track } = locateClip(timeline, clipId)
  const tracks = timeline.tracks.slice()
  const clips = track.clips.filter((_, index) => index !== clipIndex)
  tracks[trackIndex] = { ...track, clips }
  return { ...timeline, tracks }
}

export function addMarker(timeline: ShowTimeline, input: TimelineMarkerInput): ShowTimeline {
  const marker = timelineMarkerSchema.parse({
    ...input,
    id: input.id ?? makeId('marker'),
    frame: clampFrame(timeline, input.frame),
  })
  return { ...timeline, markers: sortMarkers([...timeline.markers, marker]) }
}

export function removeMarker(timeline: ShowTimeline, markerId: string): ShowTimeline {
  const markers = timeline.markers.filter((marker) => marker.id !== markerId)
  if (markers.length === timeline.markers.length) throw new Error(`Unknown marker: ${markerId}`)
  return { ...timeline, markers }
}

export function moveMarker(
  timeline: ShowTimeline,
  markerId: string,
  frame: number,
): ShowTimeline {
  if (!timeline.markers.some((marker) => marker.id === markerId)) {
    throw new Error(`Unknown marker: ${markerId}`)
  }
  const next = clampFrame(timeline, frame)
  const markers = timeline.markers.map((marker) =>
    marker.id === markerId ? { ...marker, frame: next } : marker,
  )
  return { ...timeline, markers: sortMarkers(markers) }
}

export function addProperty(
  timeline: ShowTimeline,
  trackId: string,
  input: TimelinePropertyInput,
): ShowTimeline {
  const property = timelinePropertySchema.parse({ ...input, id: input.id ?? makeId('property') })
  return mapTrack(timeline, trackId, (track) => ({
    ...track,
    properties: [...track.properties, property],
  }))
}

function mapProperty(
  timeline: ShowTimeline,
  trackId: string,
  propertyId: string,
  update: (property: TimelineProperty) => TimelineProperty,
): ShowTimeline {
  let found = false
  const next = mapTrack(timeline, trackId, (track) => {
    const properties = track.properties.map((property) => {
      if (property.id !== propertyId) return property
      found = true
      return update(property)
    })
    return { ...track, properties }
  })
  if (!found) throw new Error(`Unknown property: ${propertyId}`)
  return next
}

export function addKeyframe(
  timeline: ShowTimeline,
  trackId: string,
  propertyId: string,
  input: TimelineKeyframeInput,
): ShowTimeline {
  const keyframe = timelineKeyframeSchema.parse({
    ...input,
    id: input.id ?? makeId('keyframe'),
    easing: { kind: 'linear', ...input.easing },
  })
  return mapProperty(timeline, trackId, propertyId, (property) => ({
    ...property,
    keyframes: sortKeyframes([
      ...property.keyframes.filter((existing) => existing.frame !== keyframe.frame),
      keyframe,
    ]),
  }))
}

export function removeKeyframe(
  timeline: ShowTimeline,
  trackId: string,
  propertyId: string,
  keyframeId: string,
): ShowTimeline {
  return mapProperty(timeline, trackId, propertyId, (property) => ({
    ...property,
    keyframes: property.keyframes.filter((keyframe) => keyframe.id !== keyframeId),
  }))
}

/** Active clips across all tracks at `frame`, in track order then start order. */
export function timelineClipsAt(timeline: ShowTimeline, frame: number): TimelineActiveClip[] {
  const at = Math.trunc(Number(frame))
  if (!Number.isFinite(at)) return []
  const active: TimelineActiveClip[] = []
  for (const track of timeline.tracks) {
    for (const clip of sortClips(track.clips)) {
      if (clip.startFrame <= at && at < clipEndFrame(clip)) active.push({ track, clip })
    }
  }
  return active
}

/** Markers in `(fromExclusive, toInclusive]`, sorted by frame. */
export function timelineMarkersBetween(
  timeline: ShowTimeline,
  fromExclusive: number,
  toInclusive: number,
): TimelineMarker[] {
  return sortMarkers(timeline.markers).filter(
    (marker) => marker.frame > fromExclusive && marker.frame <= toInclusive,
  )
}

function cubicCoordinate(t: number, p1: number, p2: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t
}

function cubicBezierEase(progress: number, x1: number, y1: number, x2: number, y2: number): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  let low = 0
  let high = 1
  let t = progress
  for (let i = 0; i < 30; i += 1) {
    const x = cubicCoordinate(t, x1, x2)
    if (Math.abs(x - progress) < 1e-6) break
    if (x < progress) low = t
    else high = t
    t = (low + high) / 2
  }
  return cubicCoordinate(t, y1, y2)
}

function easeNumber(easing: TimelineEasing, progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress))
  switch (easing.kind) {
    case 'linear':
      return clamped
    case 'easeIn':
      return cubicBezierEase(clamped, 0.42, 0, 1, 1)
    case 'easeOut':
      return cubicBezierEase(clamped, 0, 0, 0.58, 1)
    case 'easeInOut':
      return cubicBezierEase(clamped, 0.42, 0, 0.58, 1)
    case 'bezier':
      return cubicBezierEase(clamped, easing.x1, easing.y1, easing.x2, easing.y2)
    default:
      return clamped
  }
}

/**
 * Samples an animated property at `frame`.
 *
 * Numeric pairs interpolate using the start keyframe's easing. String pairs
 * step to the next value. Frames outside the keyframe range clamp to the
 * nearest keyframe. Returns `null` when the property has no keyframes.
 */
export function sampleKeyframes(
  property: TimelineProperty,
  frame: number,
): number | string | null {
  const keyframes = sortKeyframes(property.keyframes)
  if (keyframes.length === 0) return null

  const first = keyframes[0]!
  const last = keyframes[keyframes.length - 1]!
  if (keyframes.length === 1 || frame <= first.frame) return first.value
  if (frame >= last.frame) return last.value

  let previous = first
  for (const keyframe of keyframes) {
    if (keyframe.frame === frame) return keyframe.value
    if (keyframe.frame > frame) {
      if (typeof previous.value !== 'number' || typeof keyframe.value !== 'number') {
        return previous.value
      }
      const span = keyframe.frame - previous.frame
      const progress = span === 0 ? 1 : (frame - previous.frame) / span
      return previous.value + (keyframe.value - previous.value) * easeNumber(previous.easing, progress)
    }
    previous = keyframe
  }
  return last.value
}
