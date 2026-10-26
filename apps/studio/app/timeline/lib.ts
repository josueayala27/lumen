import { formatTimecode, newId, nominalFps, timecodeFromFrames } from '@lumen/core'
import type {
  ControlCommand,
  FrameRate,
  ShowTimeline,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
} from '@lumen/schema'
import { showTimelineSchema } from '@lumen/schema'

/**
 * Pure geometry and editing helpers for the timeline editor.
 *
 * Everything here works in integer frames and pixels-per-frame. The editor
 * converts pointer positions with `frameAtPixel` and renders with
 * `frameToPixel`, so a change of zoom never changes the document.
 */

export const TIMELINE_MIN_PX_PER_FRAME = 0.25
export const TIMELINE_MAX_PX_PER_FRAME = 24
export const TIMELINE_DEFAULT_PX_PER_FRAME = 3
/** Pointer distance, in pixels, at which a dragged edge sticks to a target. */
export const SNAP_THRESHOLD_PX = 8

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function frameToPixel(frame: number, pixelsPerFrame: number): number {
  return frame * pixelsPerFrame
}

export function pixelToFrame(pixel: number, pixelsPerFrame: number): number {
  if (!Number.isFinite(pixelsPerFrame) || pixelsPerFrame <= 0) return 0
  return pixel / pixelsPerFrame
}

/** Rounded, non-negative frame under a pixel position, clamped to the timeline. */
export function frameAtPixel(
  pixel: number,
  pixelsPerFrame: number,
  durationFrames: number,
): number {
  const frame = Math.round(pixelToFrame(pixel, pixelsPerFrame))
  return clampNumber(frame, 0, Math.max(0, Math.round(durationFrames)))
}

/** How many frames a pointer must travel for snapping to engage at this zoom. */
export function snapThresholdFrames(
  pixelsPerFrame: number,
  thresholdPx = SNAP_THRESHOLD_PX,
): number {
  return pixelToFrame(thresholdPx, pixelsPerFrame)
}

export interface SnapResult {
  frame: number
  /** The target the frame stuck to, or null when no target was close enough. */
  target: number | null
  snapped: boolean
}

/** Snap one frame to the closest target inside the threshold. */
export function snapFrame(
  frame: number,
  targets: readonly number[],
  thresholdFrames: number,
): SnapResult {
  let closest: number | null = null
  let distance = Infinity
  for (const target of targets) {
    const candidate = Math.abs(target - frame)
    if (candidate < distance) {
      closest = target
      distance = candidate
    }
  }
  if (closest !== null && distance <= thresholdFrames) {
    return { frame: closest, target: closest, snapped: true }
  }
  return { frame, target: null, snapped: false }
}

export interface ClipSnapResult {
  startFrame: number
  target: number | null
  snapped: boolean
}

/**
 * Snap a moving clip by either edge: the leading edge to a target, or the
 * trailing edge to a target (keeping the duration). The nearer one wins.
 */
export function snapClipStart(
  startFrame: number,
  durationFrames: number,
  targets: readonly number[],
  thresholdFrames: number,
): ClipSnapResult {
  const leading = snapFrame(startFrame, targets, thresholdFrames)
  const trailing = snapFrame(startFrame + durationFrames, targets, thresholdFrames)
  const leadingDistance =
    leading.snapped && leading.target !== null ? Math.abs(leading.target - startFrame) : Infinity
  const trailingDistance =
    trailing.snapped && trailing.target !== null
      ? Math.abs(trailing.target - (startFrame + durationFrames))
      : Infinity
  if (leadingDistance <= trailingDistance && leading.target !== null) {
    return { startFrame: leading.frame, target: leading.target, snapped: true }
  }
  if (trailing.target !== null) {
    return { startFrame: trailing.target - durationFrames, target: trailing.target, snapped: true }
  }
  return { startFrame, target: null, snapped: false }
}

/** Clip starts and ends, plus markers, excluding the clip being dragged. */
export function snapTargets(
  tracks: readonly TimelineTrack[],
  markers: readonly TimelineMarker[],
  excludeClipId?: string,
): number[] {
  const targets = new Set<number>()
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue
      targets.add(clip.startFrame)
      targets.add(clip.startFrame + clip.durationFrames)
    }
  }
  for (const marker of markers) targets.add(marker.frame)
  return [...targets].sort((a, b) => a - b)
}

export function clampClipStart(
  startFrame: number,
  durationFrames: number,
  timelineDurationFrames: number,
): number {
  const maxStart = Math.max(0, timelineDurationFrames - durationFrames)
  return clampNumber(Math.round(startFrame), 0, maxStart)
}

export function clipEndFrame(clip: Pick<TimelineClip, 'startFrame' | 'durationFrames'>): number {
  return clip.startFrame + clip.durationFrames
}

export interface ClipExtent {
  startFrame: number
  durationFrames: number
  trimStartFrames: number
}

/**
 * Move the leading edge while the trailing edge stays put. The trim offset
 * cannot go below zero, so a clip never reveals source material before its
 * in-point; otherwise it could grow left without limit.
 */
export function trimClipFromStart(clip: ClipExtent, desiredStartFrame: number): ClipExtent {
  const end = clip.startFrame + clip.durationFrames
  const minStart = Math.max(0, clip.startFrame - clip.trimStartFrames)
  const startFrame = clampNumber(Math.round(desiredStartFrame), minStart, end - 1)
  return {
    startFrame,
    durationFrames: end - startFrame,
    trimStartFrames: clip.trimStartFrames + (startFrame - clip.startFrame),
  }
}

/** Move the trailing edge. The leading edge and in-point stay put. */
export function trimClipFromEnd(
  clip: ClipExtent,
  desiredEndFrame: number,
  timelineDurationFrames: number,
): ClipExtent {
  const end = clampNumber(
    Math.round(desiredEndFrame),
    clip.startFrame + 1,
    Math.max(clip.startFrame + 1, Math.round(timelineDurationFrames)),
  )
  return {
    startFrame: clip.startFrame,
    durationFrames: end - clip.startFrame,
    trimStartFrames: clip.trimStartFrames,
  }
}

/** Split a clip at a frame strictly inside it. Returns `[left, right]`. */
export function splitClipAtFrame(
  clip: TimelineClip,
  frame: number,
): [TimelineClip, TimelineClip] | null {
  const at = Math.round(frame)
  const start = clip.startFrame
  const end = clip.startFrame + clip.durationFrames
  if (at <= start || at >= end) return null
  return [
    { ...clip, id: newId('clip'), durationFrames: at - start },
    {
      ...clip,
      id: newId('clip'),
      startFrame: at,
      durationFrames: end - at,
      trimStartFrames: clip.trimStartFrames + (at - start),
    },
  ]
}

export function zoomBy(
  pixelsPerFrame: number,
  factor: number,
  min = TIMELINE_MIN_PX_PER_FRAME,
  max = TIMELINE_MAX_PX_PER_FRAME,
): number {
  return clampNumber(pixelsPerFrame * factor, min, max)
}

/** Zoom that fits the whole timeline (minus padding) into the viewport. */
export function fitPixelsPerFrame(
  viewportWidth: number,
  durationFrames: number,
  paddingPx = 24,
  min = TIMELINE_MIN_PX_PER_FRAME,
  max = TIMELINE_MAX_PX_PER_FRAME,
): number {
  if (durationFrames <= 0 || viewportWidth <= 0) return TIMELINE_DEFAULT_PX_PER_FRAME
  const fit = Math.max(0, viewportWidth - paddingPx) / durationFrames
  return clampNumber(fit, min, max)
}

export function timecodeLabel(frame: number, rate: FrameRate): string {
  return formatTimecode(timecodeFromFrames(Math.max(0, Math.round(frame)), rate))
}

export interface RulerTick {
  frame: number
  label: string
}

/**
 * Label spacing: the smallest step whose labels stay at least ~64px apart,
 * so labels never overlap at any zoom.
 */
export function rulerStepFrames(pixelsPerFrame: number, rate: FrameRate): number {
  const fps = nominalFps(rate)
  const candidates = [
    1,
    2,
    5,
    10,
    15,
    30,
    Math.round(fps / 2),
    fps,
    fps * 2,
    fps * 5,
    fps * 10,
    fps * 15,
    fps * 30,
    fps * 60,
    fps * 120,
  ]
    .filter((value) => value > 0)
    .sort((a, b) => a - b)
  for (const frames of candidates) {
    if (frames * pixelsPerFrame >= 64) return frames
  }
  return candidates[candidates.length - 1] ?? fps
}

export function rulerTicks(
  pixelsPerFrame: number,
  rate: FrameRate,
  durationFrames: number,
): RulerTick[] {
  const step = rulerStepFrames(pixelsPerFrame, rate)
  const ticks: RulerTick[] = []
  for (let frame = 0; frame <= durationFrames; frame += step) {
    ticks.push({ frame, label: timecodeLabel(frame, rate) })
  }
  return ticks
}

export function trackKindForClip(kind: TimelineClip['kind']): TimelineTrack['kind'] {
  return kind
}

export function clipKindLabel(kind: TimelineClip['kind']): string {
  switch (kind) {
    case 'slide':
      return 'Slide'
    case 'media':
      return 'Media'
    case 'audio':
      return 'Audio'
    case 'macro':
      return 'Macro'
  }
}

export function trackKindLabel(kind: TimelineTrack['kind']): string {
  switch (kind) {
    case 'slide':
      return 'Slides'
    case 'layer':
      return 'Layers'
    case 'media':
      return 'Media'
    case 'audio':
      return 'Audio'
    case 'macro':
      return 'Macros'
  }
}

// --- Undo history ------------------------------------------------------------

/** Snapshot history of serialized documents. `present` is the committed state. */
export interface EditHistory {
  past: string[]
  present: string
  future: string[]
}

export const HISTORY_LIMIT = 100

export function createHistory(present: string): EditHistory {
  return { past: [], present, future: [] }
}

/** Records a new state. Equal snapshots are ignored; a new edit drops the redo stack. */
export function commitHistory(history: EditHistory, next: string, limit = HISTORY_LIMIT): EditHistory {
  if (next === history.present) return history
  const past = [...history.past, history.present]
  return { past: past.slice(Math.max(0, past.length - limit)), present: next, future: [] }
}

export function undoHistory(history: EditHistory): EditHistory {
  const previous = history.past[history.past.length - 1]
  if (previous === undefined) return history
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
}

export function redoHistory(history: EditHistory): EditHistory {
  const [next, ...future] = history.future
  if (next === undefined) return history
  return { past: [...history.past, history.present], present: next, future }
}

// --- Clipboard ---------------------------------------------------------------

/** Copy of a clip placed at `startFrame` with a fresh id, clamped into the timeline. */
export function pastedClip(
  clip: TimelineClip,
  startFrame: number,
  durationFrames: number,
  id = newId('clip'),
): TimelineClip {
  const length = clampNumber(clip.durationFrames, 1, Math.max(1, durationFrames))
  return {
    ...JSON.parse(JSON.stringify(clip)) as TimelineClip,
    id,
    durationFrames: length,
    startFrame: clampClipStart(startFrame, length, durationFrames),
  }
}

// --- Import / export ---------------------------------------------------------

export function exportTimelineJson(doc: ShowTimeline): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * Parses exported timeline JSON. Ids are regenerated so an import never
 * overwrites the timeline it came from.
 */
export function importTimelineJson(text: string, makeId: (prefix: string) => string = newId): ShowTimeline {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  const parsed = showTimelineSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Not a Lumen timeline: ${issue ? `${issue.path.join('.') || 'root'} ${issue.message}` : 'invalid shape'}.`)
  }
  const doc = parsed.data
  return {
    ...doc,
    id: makeId('timeline'),
    tracks: doc.tracks.map((track) => ({
      ...track,
      id: makeId('track'),
      clips: track.clips.map((clip) => ({ ...clip, id: makeId('clip') })),
      properties: track.properties.map((property) => ({
        ...property,
        id: makeId('property'),
        keyframes: property.keyframes.map((keyframe) => ({ ...keyframe, id: makeId('keyframe') })),
      })),
    })),
    markers: doc.markers.map((marker) => ({ ...marker, id: makeId('marker') })),
  }
}

// --- Actions -----------------------------------------------------------------

/** Command choices for macro clips and markers, keyed for select inputs. */
export const TIMELINE_ACTIONS = [
  { value: 'none', label: 'No action' },
  { value: 'next', label: 'Next slide' },
  { value: 'prev', label: 'Previous slide' },
  { value: 'nextItem', label: 'Next item' },
  { value: 'prevItem', label: 'Previous item' },
  { value: 'take', label: 'Take preview' },
  { value: 'mode:live', label: 'Output: live' },
  { value: 'mode:black', label: 'Output: black' },
  { value: 'mode:clear', label: 'Output: clear' },
  { value: 'mode:logo', label: 'Output: logo' },
  { value: 'mode:freeze', label: 'Output: freeze' },
] as const

export type TimelineActionKey = (typeof TIMELINE_ACTIONS)[number]['value']

export function actionKey(command: ControlCommand | null): TimelineActionKey {
  if (!command) return 'none'
  if (command.type === 'setMode') return `mode:${command.mode}`
  const found = TIMELINE_ACTIONS.find((entry) => entry.value === command.type)
  return found ? found.value : 'none'
}

export function commandForKey(key: TimelineActionKey): ControlCommand | null {
  if (key === 'none') return null
  if (key.startsWith('mode:')) {
    return { type: 'setMode', mode: key.slice(5) as Extract<ControlCommand, { type: 'setMode' }>['mode'] }
  }
  return { type: key } as ControlCommand
}

// --- Keyframes ---------------------------------------------------------------

export const KEYFRAME_PROPERTIES = [
  { value: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, fallback: 1 },
  { value: 'x', label: 'X', min: -1, max: 2, step: 0.001, fallback: 0 },
  { value: 'y', label: 'Y', min: -1, max: 2, step: 0.001, fallback: 0 },
  { value: 'width', label: 'Width', min: 0, max: 2, step: 0.001, fallback: 1 },
  { value: 'height', label: 'Height', min: 0, max: 2, step: 0.001, fallback: 1 },
  { value: 'rotation', label: 'Rotation', min: -360, max: 360, step: 1, fallback: 0 },
  { value: 'fontSize', label: 'Font size', min: 1, max: 400, step: 1, fallback: 64 },
  { value: 'letterSpacing', label: 'Letter spacing', min: -20, max: 50, step: 0.1, fallback: 0 },
  { value: 'lineHeight', label: 'Line height', min: 0.5, max: 3, step: 0.01, fallback: 1.2 },
  { value: 'color', label: 'Color', min: 0, max: 0, step: 0, fallback: '#ffffff' },
] as const

export type KeyframePropertyName = (typeof KEYFRAME_PROPERTIES)[number]['value']

export function keyframePropertySpec(name: string) {
  return KEYFRAME_PROPERTIES.find((entry) => entry.value === name) ?? KEYFRAME_PROPERTIES[0]
}
