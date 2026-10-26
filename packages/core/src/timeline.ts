import type { FrameRate, TimelineCue, TimelineDoc } from '@lumen/schema'
import { nominalFps } from './timecode'

export interface TimelineState {
  /** Last frame the runner acknowledged. `null` means no lock has been established. */
  frame: number | null
}

export interface TimelineAdvance {
  cues: TimelineCue[]
  state: TimelineState
  /** True when the runner jumped instead of advancing one source frame at a time. */
  resynced: boolean
}

export interface AdvanceOptions {
  /** Skip cues when the source advances more than this many frames in one update. */
  maxGapFrames?: number
}

export function maxGapFrames(rate: FrameRate): number {
  return Math.max(1, Math.round(nominalFps(rate) * 2))
}

/**
 * Advances the timeline cursor. A first lock, a backward jump or a gap larger
 * than `maxGapFrames` resynchronizes without firing missed cues.
 */
export function advanceTimeline(
  state: TimelineState,
  timeline: TimelineDoc,
  frame: number,
  options: AdvanceOptions = {},
): TimelineAdvance {
  const next = Math.max(0, Math.trunc(frame))
  const resync = (): TimelineAdvance => ({ cues: [], state: { frame: next }, resynced: true })

  if (state.frame === null) return resync()
  if (next < state.frame) return resync()
  if (next === state.frame) return { cues: [], state: { frame: next }, resynced: false }

  const gap = next - state.frame
  const limit = options.maxGapFrames ?? maxGapFrames(timeline.frameRate)
  if (gap > limit) return resync()

  const cues = timeline.cues
    .filter((cue) => cue.enabled && cue.atFrames > state.frame! && cue.atFrames <= next)
    .sort((a, b) => a.atFrames - b.atFrames)

  return { cues, state: { frame: next }, resynced: false }
}
