import {
  activeMediaClips,
  advancePlayback,
  applyKeyframeSamples,
  createPlaybackState,
  evaluateTimeline,
  frameCount,
  mediaClipSourceSeconds,
  nominalFps,
  pause as pausePlayback,
  play as startPlayback,
  seek as seekPlayback,
  showTimelineFromCueDoc,
  stepFrame,
  stop as stopPlayback,
  syncExternalFrame,
  timelineActions,
  type PlaybackState,
  type TimelineAction,
  type TimelineEvaluation,
} from '@lumen/core'
import type { LiveCommand, ShowTimeline, TimecodeSnapshot } from '@lumen/schema'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import { toLiveCommand } from '~/control/commands'
import { loadTimeline as loadLegacyTimeline } from '~/control/timelineStore'
import {
  getTimeline,
  listTimelines,
  saveTimeline,
  type TimelineRecord,
  type TimelineSummary,
} from '~/data/timelines'
import { withTimelineMedia, type MediaAssetLike, type TimelineMediaLayer } from './liveScene'
import type { LiveItem } from './liveSession'
import type { LiveSceneTransform } from './useLiveOutput'

export type TimelineClock = 'internal' | 'external'

export interface ShowTimelineOptions {
  timecode: () => TimecodeSnapshot | null
  apply: (command: LiveCommand) => void
  items: Ref<LiveItem[]>
  media: Ref<MediaAssetLike[]>
}

export interface FiredAction {
  label: string
  frame: number
}

const SELECTED_KEY = 'lumen.live.timeline'
/** Audio drifting further than this from the timeline is reseeked. */
const AUDIO_DRIFT_SECONDS = 0.04

function readSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeSelected(id: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, id)
  } catch {
    // Preference only.
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function mediaUrl(path: string): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    return convertFileSrc(path)
  } catch {
    return null
  }
}

function actionLabel(action: TimelineAction): string {
  switch (action.kind) {
    case 'command':
      return action.label || action.command.type
    case 'slide':
      return action.label || `Slide ${action.slideIndex + 1}`
    case 'media':
      return action.clip.label || 'Media'
  }
}

/**
 * Runs a show timeline in the live view: an internal clock or an external
 * LTC/MTC lock moves the playhead, armed markers and clips drive live
 * commands, active media and keyframes feed the audience scene, and audio
 * clips play in the control window.
 */
export function useShowTimeline(options: ShowTimelineOptions) {
  const timelines = ref<TimelineSummary[]>([])
  const record = shallowRef<TimelineRecord | null>(null)
  const playback = ref<PlaybackState>(createPlaybackState())
  const evaluation = shallowRef<TimelineEvaluation | null>(null)
  const clock = ref<TimelineClock>('internal')
  const armed = ref(false)
  const loading = ref(true)
  const error = ref('')
  const lastFired = ref<FiredAction[]>([])
  const rateMismatch = ref(false)
  const legacyCueCount = ref(0)

  let previousFrame: number | null = null
  let frameHandle: number | null = null
  let lastTick = 0
  const audio = new Map<string, HTMLAudioElement>()

  const doc = computed<ShowTimeline | null>(() => record.value?.doc ?? null)
  const fps = computed(() => (doc.value ? nominalFps(doc.value.frameRate) : 30))

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      timelines.value = await listTimelines()
      const legacy = await loadLegacyTimeline()
      const migrated = legacy ? timelines.value.some((entry) => entry.id === legacy.id) : true
      legacyCueCount.value = legacy && !migrated ? legacy.cues.length : 0
      const wanted = readSelected()
      const id = timelines.value.some((entry) => entry.id === wanted) ? wanted : timelines.value[0]?.id ?? ''
      await select(id)
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
      loading.value = false
    }
  }

  async function select(id: string): Promise<void> {
    stopAll()
    record.value = id ? await getTimeline(id) : null
    writeSelected(record.value?.id ?? '')
    playback.value = createPlaybackState()
    previousFrame = null
    evaluate(false)
  }

  /** Imports the legacy LTC cue list as a show timeline, keeping its id and frame counts. */
  async function importLegacyCues(): Promise<void> {
    const legacy = await loadLegacyTimeline()
    if (!legacy) return
    const now = Date.now()
    const next: TimelineRecord = { id: legacy.id, doc: showTimelineFromCueDoc(legacy), createdAt: now, updatedAt: now }
    await saveTimeline(next)
    writeSelected(next.id)
    await refresh()
  }

  function itemIndexFor(presentationId: string): number {
    return options.items.value.findIndex((item) => item.doc !== null && item.presentationId === presentationId)
  }

  function run(action: TimelineAction): boolean {
    switch (action.kind) {
      case 'command':
        options.apply(toLiveCommand(action.command))
        return true
      case 'slide': {
        const itemIndex = itemIndexFor(action.presentationId)
        if (itemIndex < 0) return false
        options.apply({ type: 'previewGoTo', itemIndex, slideIndex: action.slideIndex })
        options.apply({ type: 'take' })
        return true
      }
      case 'media':
        // Media follows the evaluation reactively; nothing to dispatch.
        return false
    }
  }

  function evaluate(fire: boolean): void {
    const current = doc.value
    if (!current) {
      evaluation.value = null
      return
    }
    const result = evaluateTimeline(current, playback.value.frame, previousFrame)
    previousFrame = result.frame
    evaluation.value = result
    if (fire && armed.value) {
      const fired: FiredAction[] = []
      for (const action of timelineActions(current, result)) {
        if (run(action)) fired.push({ label: actionLabel(action), frame: result.frame })
      }
      if (fired.length > 0) lastFired.value = fired.slice(-4)
    }
    void syncAudio(result)
  }

  async function syncAudio(result: TimelineEvaluation): Promise<void> {
    const current = doc.value
    if (!current) return
    const wanted = new Set<string>()
    const playing = playback.value.playing || clock.value === 'external'
    for (const { clip } of activeMediaClips(result)) {
      const asset = options.media.value.find((entry) => entry.id === clip.assetId)
      if (!asset || asset.kind !== 'audio' || asset.missing) continue
      wanted.add(clip.id)
      let element = audio.get(clip.id)
      if (!element) {
        const url = await mediaUrl(asset.localPath)
        if (!url) continue
        element = new Audio(url)
        element.preload = 'auto'
        audio.set(clip.id, element)
      }
      element.volume = Math.min(1, Math.max(0, clip.gain))
      element.loop = clip.loop
      const target = mediaClipSourceSeconds(current, clip, result.frame)
      if (Math.abs(element.currentTime - target) > AUDIO_DRIFT_SECONDS && (!playing || element.paused)) {
        element.currentTime = target
      }
      if (playing && element.paused) void element.play().catch(() => undefined)
      if (!playing && !element.paused) element.pause()
    }
    for (const [id, element] of audio) {
      if (wanted.has(id)) continue
      element.pause()
      audio.delete(id)
    }
  }

  /** While an audio clip plays, its clock is the master and the playhead follows it. */
  function audioMasterFrame(): number | null {
    const current = doc.value
    const result = evaluation.value
    if (!current || !result) return null
    for (const { clip } of activeMediaClips(result)) {
      const element = audio.get(clip.id)
      if (!element || element.paused || clip.loop) continue
      const local = element.currentTime * fps.value - clip.trimStartFrames
      return Math.round(clip.startFrame + local)
    }
    return null
  }

  function tick(time: number): void {
    frameHandle = null
    const current = doc.value
    if (!current || !playback.value.playing || clock.value !== 'internal') return
    const elapsed = lastTick ? time - lastTick : 0
    lastTick = time
    const master = audioMasterFrame()
    const next =
      master !== null && master > playback.value.frame
        ? { ...playback.value, frame: master }
        : advancePlayback(current, playback.value, elapsed)
    if (next.frame !== playback.value.frame || next.playing !== playback.value.playing) {
      playback.value = next
      evaluate(true)
    }
    if (playback.value.playing) frameHandle = requestAnimationFrame(tick)
  }

  function schedule(): void {
    if (frameHandle !== null || typeof requestAnimationFrame === 'undefined') return
    lastTick = 0
    frameHandle = requestAnimationFrame(tick)
  }

  function cancel(): void {
    if (frameHandle !== null) cancelAnimationFrame(frameHandle)
    frameHandle = null
  }

  function play(): void {
    if (!doc.value || clock.value !== 'internal') return
    playback.value = startPlayback(playback.value)
    evaluate(false)
    schedule()
  }

  function pause(): void {
    cancel()
    playback.value = pausePlayback(playback.value)
    evaluate(false)
  }

  function togglePlay(): void {
    if (playback.value.playing) pause()
    else play()
  }

  function stop(): void {
    cancel()
    playback.value = stopPlayback(playback.value)
    previousFrame = null
    evaluate(false)
  }

  function seek(frame: number): void {
    if (!doc.value) return
    playback.value = seekPlayback(doc.value, playback.value, frame)
    previousFrame = null
    evaluate(true)
  }

  function step(delta: number): void {
    if (!doc.value) return
    playback.value = stepFrame(doc.value, playback.value, delta)
    evaluate(delta > 0)
  }

  function setLoop(value: boolean): void {
    playback.value = { ...playback.value, loop: value }
  }

  function setOffset(frames: number): void {
    playback.value = { ...playback.value, offsetFrames: Math.trunc(frames) }
    previousFrame = null
  }

  function setClock(value: TimelineClock): void {
    pause()
    clock.value = value
    previousFrame = null
    rateMismatch.value = false
  }

  function setArmed(value: boolean): void {
    armed.value = value
    lastFired.value = []
    previousFrame = null
    if (value) evaluate(true)
  }

  function stopAll(): void {
    cancel()
    for (const element of audio.values()) element.pause()
    audio.clear()
  }

  watch(options.timecode, (snapshot) => {
    const current = doc.value
    if (clock.value !== 'external' || !current) return
    if (!snapshot?.locked || !snapshot.timecode) {
      previousFrame = null
      rateMismatch.value = false
      void syncAudio(evaluation.value ?? evaluateTimeline(current, playback.value.frame, null))
      return
    }
    if (snapshot.timecode.rate !== current.frameRate) {
      previousFrame = null
      rateMismatch.value = true
      return
    }
    rateMismatch.value = false
    playback.value = syncExternalFrame(current, playback.value, frameCount(snapshot.timecode))
    evaluate(true)
  })

  const mediaLayers = computed<TimelineMediaLayer[]>(() => {
    const current = doc.value
    const result = evaluation.value
    if (!current || !result) return []
    const layers: TimelineMediaLayer[] = []
    for (const { clip } of activeMediaClips(result)) {
      if (clip.kind !== 'media') continue
      const asset = options.media.value.find((entry) => entry.id === clip.assetId)
      if (!asset || asset.missing) continue
      layers.push({
        clipId: clip.id,
        asset,
        // Fixed at the clip start so the decoder is not restarted every frame.
        startMs: (clip.trimStartFrames / fps.value) * 1000,
        loop: clip.loop,
        gain: clip.gain,
      })
    }
    return layers
  })

  /** Scene overrides for the audience output: media clips and sampled keyframes. */
  const sceneTransform = computed<LiveSceneTransform | null>(() => {
    const current = doc.value
    const result = evaluation.value
    if (!current || !result || !armed.value) return null
    const media = mediaLayers.value
    if (media.length === 0 && result.keyframes.length === 0) return null
    const key = JSON.stringify([media.map((entry) => entry.clipId), result.keyframes.map((sample) => sample.value)])
    return {
      key,
      apply: (scene, source) => {
        const target = {
          presentationId: source?.doc
            ? options.items.value.find((item) => item.doc === source.doc)?.presentationId ?? null
            : null,
          slideIndex: source?.slideIndex ?? null,
        }
        return withTimelineMedia(applyKeyframeSamples(scene, current, result.keyframes, target), media)
      },
    }
  })

  const durationFrames = computed(() => {
    const current = doc.value
    if (!current) return 0
    return Math.max(
      current.durationFrames,
      ...current.tracks.flatMap((track) => track.clips.map((clip) => clip.startFrame + clip.durationFrames)),
    )
  })

  onMounted(() => void refresh())
  onBeforeUnmount(stopAll)

  return {
    timelines,
    doc,
    playback,
    evaluation,
    clock,
    armed,
    loading,
    error,
    lastFired,
    rateMismatch,
    legacyCueCount,
    durationFrames,
    sceneTransform,
    refresh,
    select,
    importLegacyCues,
    play,
    pause,
    togglePlay,
    stop,
    seek,
    step,
    setLoop,
    setOffset,
    setClock,
    setArmed,
  }
}
