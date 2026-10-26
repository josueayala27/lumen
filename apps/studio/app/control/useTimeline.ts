import { advanceTimeline, frameCount, timecodeFromFrames, type TimelineState } from '@lumen/core'
import type { LiveCommand, TimecodeSnapshot, TimelineCue, TimelineDoc } from '@lumen/schema'
import { computed, onMounted, ref, watch } from 'vue'
import { toLiveCommand } from './commands'
import { loadTimeline, newTimeline, saveTimeline } from './timelineStore'

/** Runs timeline cues against the incoming LTC/MTC frame count. */
export function useTimeline(
  timecode: () => TimecodeSnapshot | null,
  apply: (command: LiveCommand) => void,
) {
  const timeline = ref<TimelineDoc | null>(null)
  const armed = ref(false)
  const state = ref<TimelineState>({ frame: null })
  const lastFired = ref<TimelineCue[]>([])
  const rateMismatch = ref(false)
  const ready = ref(false)

  onMounted(async () => {
    timeline.value = (await loadTimeline()) ?? newTimeline()
    ready.value = true
  })

  watch(timecode, (snapshot) => {
    if (!armed.value || !timeline.value) return

    if (!snapshot?.locked || !snapshot.timecode) {
      state.value = { frame: null }
      rateMismatch.value = false
      return
    }
    if (snapshot.timecode.rate !== timeline.value.frameRate) {
      state.value = { frame: null }
      rateMismatch.value = true
      return
    }

    rateMismatch.value = false
    const result = advanceTimeline(
      state.value,
      timeline.value,
      frameCount(snapshot.timecode),
    )
    state.value = result.state
    if (result.cues.length > 0) {
      lastFired.value = result.cues
      for (const cue of result.cues) apply(toLiveCommand(cue.action))
    }
  })

  watch(
    () => timeline.value?.frameRate,
    () => {
      state.value = { frame: null }
      rateMismatch.value = false
    },
  )

  const playhead = computed(() => {
    const frame = state.value.frame
    if (frame === null || !timeline.value) return null
    return timecodeFromFrames(frame, timeline.value.frameRate)
  })

  function setArmed(value: boolean): void {
    armed.value = value
    state.value = { frame: null }
    lastFired.value = []
    rateMismatch.value = false
  }

  async function save(): Promise<void> {
    if (timeline.value) await saveTimeline(timeline.value)
  }

  return { timeline, armed, playhead, lastFired, rateMismatch, ready, setArmed, save }
}
