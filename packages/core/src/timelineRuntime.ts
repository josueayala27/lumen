import type {
  ControlCommand,
  Scene,
  SceneLayer,
  ShowTimeline,
  TimelineClip,
  TimelineDoc,
  TimelineTrack,
} from '@lumen/schema'
import { showTimelineSchema } from '@lumen/schema'
import { nominalFps } from './timecode'
import { clipEndFrame } from './showTimeline'
import type { KeyframeSample, TimelineEvaluation } from './timelinePlayback'

/** Something the live runner must do because the cursor reached a frame. */
export type TimelineAction =
  | { kind: 'command'; command: ControlCommand; source: 'marker' | 'clip'; id: string; label: string }
  | { kind: 'slide'; presentationId: string; slideIndex: number; clipId: string; label: string }
  | { kind: 'media'; assetId: string; clip: TimelineClip; offsetFrames: number }

/** Where the live output currently is, used to scope layer keyframes. */
export interface KeyframeTarget {
  presentationId: string | null
  slideIndex: number | null
}

const DEFAULT_MIGRATED_SECONDS = 600

/**
 * Converts a legacy LTC cue timeline into a show timeline. Cue frame counts are
 * kept as marker frames so LTC/MTC positions stay identical.
 */
export function showTimelineFromCueDoc(doc: TimelineDoc): ShowTimeline {
  const lastCue = doc.cues.reduce((max, cue) => Math.max(max, cue.atFrames), 0)
  const minimum = Math.round(DEFAULT_MIGRATED_SECONDS * nominalFps(doc.frameRate))
  return showTimelineSchema.parse({
    schemaVersion: 1,
    id: doc.id,
    name: doc.name,
    frameRate: doc.frameRate,
    durationFrames: Math.max(minimum, lastCue + 1),
    tracks: [],
    markers: [...doc.cues]
      .sort((a, b) => a.atFrames - b.atFrames)
      .map((cue) => ({
        id: cue.id,
        frame: cue.atFrames,
        label: cue.label,
        action: cue.action,
        enabled: cue.enabled,
      })),
  })
}

function activeTracks(timeline: ShowTimeline): TimelineTrack[] {
  return timeline.tracks.filter((track) => !track.muted)
}

function clipAction(clip: TimelineClip, offsetFrames: number): TimelineAction | null {
  switch (clip.kind) {
    case 'slide':
      if (clip.presentationId === null || clip.slideIndex === null) return null
      return {
        kind: 'slide',
        presentationId: clip.presentationId,
        slideIndex: clip.slideIndex,
        clipId: clip.id,
        label: clip.label,
      }
    case 'macro':
      if (!clip.action) return null
      return { kind: 'command', command: clip.action, source: 'clip', id: clip.id, label: clip.label }
    case 'media':
    case 'audio':
      if (!clip.assetId) return null
      return { kind: 'media', assetId: clip.assetId, clip, offsetFrames }
    default:
      return null
  }
}

/**
 * Clips on unmuted tracks whose start lies in `(fromExclusive, toInclusive]`,
 * by start frame, then track order for clips starting together.
 */
export function clipsStartingBetween(
  timeline: ShowTimeline,
  fromExclusive: number,
  toInclusive: number,
): TimelineClip[] {
  const clips: TimelineClip[] = []
  for (const track of activeTracks(timeline)) {
    for (const clip of track.clips) {
      if (clip.startFrame > fromExclusive && clip.startFrame <= toInclusive) clips.push(clip)
    }
  }
  return clips.sort((a, b) => a.startFrame - b.startFrame)
}

/**
 * Actions for one evaluation step. Moving forward fires markers and clip
 * starts crossed since the previous frame. A resync (first lock, seek or jump)
 * fires no markers or macros; it chases the state at the new frame instead: the
 * latest active slide clip and every active media clip, with its offset.
 */
export function timelineActions(
  timeline: ShowTimeline,
  evaluation: TimelineEvaluation,
): TimelineAction[] {
  const actions: TimelineAction[] = []

  if (evaluation.resynced) {
    const slides = evaluation.clips.filter((clip) => clip.kind === 'slide')
    const latest = slides.reduce<TimelineClip | null>(
      (best, clip) => (best === null || clip.startFrame >= best.startFrame ? clip : best),
      null,
    )
    if (latest) {
      const action = clipAction(latest, evaluation.frame - latest.startFrame)
      if (action) actions.push(action)
    }
    for (const clip of evaluation.clips) {
      if (clip.kind !== 'media' && clip.kind !== 'audio') continue
      const action = clipAction(clip, evaluation.frame - clip.startFrame)
      if (action) actions.push(action)
    }
    return actions
  }

  const from = evaluation.previousFrame ?? evaluation.frame
  type Timed = { frame: number; order: number; action: TimelineAction }
  const timed: Timed[] = []
  for (const marker of evaluation.markers) {
    if (!marker.action) continue
    timed.push({
      frame: marker.frame,
      order: 0,
      action: { kind: 'command', command: marker.action, source: 'marker', id: marker.id, label: marker.label },
    })
  }
  for (const clip of clipsStartingBetween(timeline, from, evaluation.frame)) {
    const action = clipAction(clip, evaluation.frame - clip.startFrame)
    if (action) timed.push({ frame: clip.startFrame, order: 1, action })
  }
  timed.sort((a, b) => a.frame - b.frame || a.order - b.order)
  return timed.map((entry) => entry.action)
}

/** Media and audio clips active at the evaluation frame, with their source offset in frames. */
export function activeMediaClips(
  evaluation: TimelineEvaluation,
): { clip: TimelineClip; offsetFrames: number }[] {
  return evaluation.clips
    .filter((clip) => (clip.kind === 'media' || clip.kind === 'audio') && clip.assetId)
    .map((clip) => ({ clip, offsetFrames: clip.trimStartFrames + evaluation.frame - clip.startFrame }))
}

/** Seconds into the source file for a media clip at a timeline frame. */
export function mediaClipSourceSeconds(
  timeline: ShowTimeline,
  clip: TimelineClip,
  frame: number,
): number {
  const fps = nominalFps(timeline.frameRate)
  const local = Math.min(Math.max(0, frame - clip.startFrame), clip.durationFrames)
  return (clip.trimStartFrames + local) / fps
}

/** True when `frame` lies inside `clip`. */
export function clipContains(clip: TimelineClip, frame: number): boolean {
  return clip.startFrame <= frame && frame < clipEndFrame(clip)
}

function tracksFor(timeline: ShowTimeline, target: KeyframeTarget): Map<string, TimelineTrack> {
  const byId = new Map<string, TimelineTrack>()
  for (const track of activeTracks(timeline)) {
    if (track.kind !== 'layer' || !track.elementId) continue
    if (track.presentationId !== null && track.presentationId !== target.presentationId) continue
    if (track.slideIndex !== null && track.slideIndex !== target.slideIndex) continue
    byId.set(track.id, track)
  }
  return byId
}

function finite(value: number | string, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function applySample(layer: SceneLayer, sample: KeyframeSample): SceneLayer {
  const { value } = sample
  switch (sample.property) {
    case 'x':
      return { ...layer, frame: { ...layer.frame, x: finite(value, layer.frame.x) } }
    case 'y':
      return { ...layer, frame: { ...layer.frame, y: finite(value, layer.frame.y) } }
    case 'width':
      return { ...layer, frame: { ...layer.frame, w: Math.max(0, finite(value, layer.frame.w)) } }
    case 'height':
      return { ...layer, frame: { ...layer.frame, h: Math.max(0, finite(value, layer.frame.h)) } }
    case 'rotation':
      return { ...layer, frame: { ...layer.frame, rotation: finite(value, layer.frame.rotation) } }
    case 'opacity':
      return { ...layer, opacity: Math.min(1, Math.max(0, finite(value, layer.opacity))) }
    case 'color':
      if (typeof value !== 'string') return layer
      if (layer.kind === 'text') return { ...layer, color: value }
      if (layer.kind === 'shape') return { ...layer, fill: value }
      return layer
    case 'fontSize':
      if (layer.kind !== 'text') return layer
      return { ...layer, fontSize: Math.max(1, finite(value, layer.fontSize)) }
    case 'letterSpacing':
      if (layer.kind !== 'text') return layer
      return { ...layer, letterSpacing: finite(value, layer.letterSpacing) }
    case 'lineHeight':
      if (layer.kind !== 'text') return layer
      return { ...layer, lineHeight: Math.max(0.1, finite(value, layer.lineHeight)) }
    default:
      return layer
  }
}

/**
 * Applies sampled keyframe values to a scene. Only layer tracks bound to an
 * element on the target slide apply; layers keep their authored values for
 * every property without keyframes. Returns the same scene when nothing applies.
 */
export function applyKeyframeSamples(
  scene: Scene,
  timeline: ShowTimeline,
  samples: readonly KeyframeSample[],
  target: KeyframeTarget,
): Scene {
  if (samples.length === 0) return scene
  const tracks = tracksFor(timeline, target)
  if (tracks.size === 0) return scene

  const byElement = new Map<string, KeyframeSample[]>()
  for (const sample of samples) {
    const track = tracks.get(sample.trackId)
    if (!track?.elementId) continue
    const list = byElement.get(track.elementId) ?? []
    list.push(sample)
    byElement.set(track.elementId, list)
  }
  if (byElement.size === 0) return scene

  let changed = false
  const layers = scene.layers.map((layer) => {
    const list = byElement.get(layer.id)
    if (!list) return layer
    changed = true
    return list.reduce(applySample, layer)
  })
  return changed ? { ...scene, layers } : scene
}
