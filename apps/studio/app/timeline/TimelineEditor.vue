<script setup lang="ts">
import { newId, nominalFps } from '@lumen/core'
import type {
  ControlCommand,
  FrameRate,
  ShowTimeline,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
} from '@lumen/schema'
import { showTimelineSchema } from '@lumen/schema'
import { Icon } from '#components'
import { css } from 'styled-system/css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { newTrack, saveTimeline, type TimelineRecord } from '~/data/timelines'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
  NumberField,
  Panel,
  PanelSection,
  PropertyRow,
  Select,
  Slider,
  Switch,
  type SelectOption,
  type Unit,
} from '~/ui'
import {
  TIMELINE_DEFAULT_PX_PER_FRAME,
  clampClipStart,
  clampNumber,
  clipEndFrame,
  clipKindLabel,
  fitPixelsPerFrame,
  frameAtPixel,
  frameToPixel,
  pixelToFrame,
  rulerTicks,
  snapClipStart,
  snapFrame,
  snapTargets,
  snapThresholdFrames,
  splitClipAtFrame,
  timecodeLabel,
  trackKindForClip,
  trackKindLabel,
  trimClipFromEnd,
  trimClipFromStart,
  zoomBy,
  type ClipExtent,
} from './lib'

const props = defineProps<{ record: TimelineRecord }>()
const emit = defineEmits<{ close: []; saved: [record: TimelineRecord] }>()

const state = ref<ShowTimeline>(cloneDoc(props.record.doc))
const playhead = ref(0)
const pixelsPerFrame = ref(TIMELINE_DEFAULT_PX_PER_FRAME)
const snapEnabled = ref(true)
const selectedClipKey = ref<{ trackId: string; clipId: string } | null>(null)
const selectedMarkerId = ref<string | null>(null)
const snapGuide = ref<number | null>(null)
const dirty = ref(false)
const saving = ref(false)
const error = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const contentEl = ref<HTMLElement | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | undefined
let hydrating = false
let scrubCleanup: (() => void) | null = null
let markerDrag: { up: () => void } | null = null

interface DragState {
  mode: 'move' | 'trim-start' | 'trim-end'
  track: TimelineTrack
  clip: TimelineClip
  startX: number
  initial: ClipExtent
}

let drag: DragState | null = null

function cloneDoc(doc: ShowTimeline): ShowTimeline {
  return JSON.parse(JSON.stringify(doc)) as ShowTimeline
}

const doc = state

const rateOptions: SelectOption<FrameRate>[] = [
  { value: '23.976', label: '23.976 fps' },
  { value: '24', label: '24 fps' },
  { value: '25', label: '25 fps' },
  { value: '29.97', label: '29.97 fps' },
  { value: '29.97df', label: '29.97 drop-frame' },
  { value: '30', label: '30 fps' },
]

const clipKindOptions: SelectOption<TimelineClip['kind']>[] = [
  { value: 'slide', label: 'Slide' },
  { value: 'media', label: 'Media' },
  { value: 'audio', label: 'Audio' },
  { value: 'macro', label: 'Macro' },
]
const newClipKind = ref<TimelineClip['kind']>('slide')

type MacroAction = 'none' | 'next' | 'prev' | 'take'
const macroActionOptions: SelectOption<MacroAction>[] = [
  { value: 'none', label: 'No action' },
  { value: 'next', label: 'Next slide' },
  { value: 'prev', label: 'Previous slide' },
  { value: 'take', label: 'Take preview' },
]

const unitless: Unit[] = ['']

const contentWidth = computed(() =>
  Math.max(1, Math.ceil(doc.value.durationFrames * pixelsPerFrame.value)),
)
const playheadTimecode = computed(() => timecodeLabel(playhead.value, doc.value.frameRate))
const ticks = computed(() =>
  rulerTicks(pixelsPerFrame.value, doc.value.frameRate, doc.value.durationFrames),
)
const zoomPercent = computed(() =>
  Math.max(1, Math.round((pixelsPerFrame.value / TIMELINE_DEFAULT_PX_PER_FRAME) * 100)),
)
const durationLabel = computed(() => timecodeLabel(doc.value.durationFrames, doc.value.frameRate))
const clipCount = computed(() =>
  doc.value.tracks.reduce((count, track) => count + track.clips.length, 0),
)

interface LocatedClip {
  track: TimelineTrack
  clip: TimelineClip
}

const selectedClip = computed<LocatedClip | null>(() => {
  const key = selectedClipKey.value
  if (!key) return null
  const track = doc.value.tracks.find((entry) => entry.id === key.trackId)
  const clip = track?.clips.find((entry) => entry.id === key.clipId)
  return track && clip ? { track, clip } : null
})

const selectedMarker = computed<TimelineMarker | null>(() => {
  const id = selectedMarkerId.value
  return id ? (doc.value.markers.find((marker) => marker.id === id) ?? null) : null
})

const selectedLocked = computed(() => selectedClip.value?.track.locked ?? false)

const nameField = computed({
  get: () => doc.value.name,
  set: (value: string) => {
    doc.value.name = value
  },
})

const frameRateField = computed({
  get: () => doc.value.frameRate,
  set: (value: FrameRate) => {
    doc.value.frameRate = value
  },
})

const durationField = computed({
  get: () => String(doc.value.durationFrames),
  set: (value: string) => {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed) || parsed < 1) return
    setTimelineDuration(parsed)
  },
})

const clipLabelField = computed({
  get: () => selectedClip.value?.clip.label ?? '',
  set: (value: string) => patchSelectedClip({ label: value }),
})

const clipStartField = computed({
  get: () => String(selectedClip.value?.clip.startFrame ?? 0),
  set: (value: string) => {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return
    const current = selectedClip.value
    if (!current) return
    patchSelectedClip({ startFrame: clampClipStart(parsed, current.clip.durationFrames, doc.value.durationFrames) })
  },
})

const clipDurationField = computed({
  get: () => String(selectedClip.value?.clip.durationFrames ?? 1),
  set: (value: string) => {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed) || parsed < 1) return
    const current = selectedClip.value
    if (!current) return
    const maximum = Math.max(1, doc.value.durationFrames - current.clip.startFrame)
    patchSelectedClip({ durationFrames: clampNumber(parsed, 1, maximum) })
  },
})

const clipTrimField = computed({
  get: () => String(selectedClip.value?.clip.trimStartFrames ?? 0),
  set: (value: string) => {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed) || parsed < 0) return
    patchSelectedClip({ trimStartFrames: parsed })
  },
})

const clipGainField = computed({
  get: () => String(selectedClip.value?.clip.gain ?? 1),
  set: (value: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    patchSelectedClip({ gain: clampNumber(parsed, 0, 1) })
  },
})

const clipLoopField = computed({
  get: () => selectedClip.value?.clip.loop ?? false,
  set: (value: boolean) => patchSelectedClip({ loop: value }),
})

const macroAction = computed({
  get: (): MacroAction => {
    const action = selectedClip.value?.clip.action
    if (!action) return 'none'
    if (action.type === 'next' || action.type === 'prev' || action.type === 'take') return action.type
    return 'none'
  },
  set: (value: MacroAction) => {
    patchSelectedClip({ action: commandForAction(value) })
  },
})

const markerLabelField = computed({
  get: () => selectedMarker.value?.label ?? '',
  set: (value: string) => {
    if (selectedMarker.value) selectedMarker.value.label = value
  },
})

const markerFrameField = computed({
  get: () => String(selectedMarker.value?.frame ?? 0),
  set: (value: string) => {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed) || !selectedMarker.value) return
    selectedMarker.value.frame = clampNumber(parsed, 0, doc.value.durationFrames)
  },
})

const markerEnabledField = computed({
  get: () => selectedMarker.value?.enabled ?? true,
  set: (value: boolean) => {
    if (selectedMarker.value) selectedMarker.value.enabled = value
  },
})

function commandForAction(value: MacroAction): ControlCommand | null {
  switch (value) {
    case 'next':
      return { type: 'next' }
    case 'prev':
      return { type: 'prev' }
    case 'take':
      return { type: 'take' }
    default:
      return null
  }
}

function setTimelineDuration(frames: number): void {
  const next = Math.max(1, Math.round(frames))
  doc.value.durationFrames = next
  for (const track of doc.value.tracks) {
    for (const clip of track.clips) {
      if (clip.startFrame >= next) clip.startFrame = Math.max(0, next - 1)
      const maximum = Math.max(1, next - clip.startFrame)
      if (clip.durationFrames > maximum) clip.durationFrames = maximum
    }
  }
  for (const marker of doc.value.markers) marker.frame = Math.min(marker.frame, next)
  playhead.value = Math.min(playhead.value, next)
}

function patchSelectedClip(patch: Partial<TimelineClip>): void {
  const current = selectedClip.value
  if (!current || current.track.locked) return
  Object.assign(current.clip, patch)
  error.value = ''
}

function selectClip(track: TimelineTrack, clip: TimelineClip): void {
  selectedClipKey.value = { trackId: track.id, clipId: clip.id }
  selectedMarkerId.value = null
}

function selectMarker(marker: TimelineMarker): void {
  selectedMarkerId.value = marker.id
  selectedClipKey.value = null
}

function clearSelection(): void {
  selectedClipKey.value = null
  selectedMarkerId.value = null
}

function defaultClipDuration(): number {
  return Math.max(1, Math.round(nominalFps(doc.value.frameRate) * 3))
}

function addClip(kind: TimelineClip['kind']): void {
  const trackKind = trackKindForClip(kind)
  let track = doc.value.tracks.find((entry) => entry.kind === trackKind && !entry.locked)
  if (!track) {
    track = newTrack(trackKind)
    doc.value.tracks.push(track)
  }
  const durationFrames = defaultClipDuration()
  const startFrame = clampClipStart(playhead.value, durationFrames, doc.value.durationFrames)
  const clip: TimelineClip = {
    id: newId('clip'),
    kind,
    label: `${clipKindLabel(kind)} clip`,
    startFrame,
    durationFrames,
    trimStartFrames: 0,
    presentationId: null,
    slideIndex: null,
    assetId: null,
    action: kind === 'macro' ? { type: 'next' } : null,
    gain: 1,
    loop: false,
  }
  track.clips.push(clip)
  selectClip(track, clip)
  error.value = ''
}

function addMarker(): void {
  const marker: TimelineMarker = {
    id: newId('marker'),
    frame: clampNumber(Math.round(playhead.value), 0, doc.value.durationFrames),
    label: `Marker ${doc.value.markers.length + 1}`,
    action: null,
    enabled: true,
  }
  doc.value.markers.push(marker)
  selectMarker(marker)
}

function splitSelected(): void {
  const current = selectedClip.value
  if (!current || current.track.locked) {
    error.value = 'Select an unlocked clip to split.'
    return
  }
  const parts = splitClipAtFrame(current.clip, playhead.value)
  if (!parts) {
    error.value = 'Place the playhead inside the selected clip.'
    return
  }
  const index = current.track.clips.findIndex((clip) => clip.id === current.clip.id)
  if (index === -1) return
  current.track.clips.splice(index, 1, parts[0], parts[1])
  selectClip(current.track, parts[1])
  error.value = ''
}

function deleteSelection(): void {
  const marker = selectedMarker.value
  if (marker) {
    doc.value.markers = doc.value.markers.filter((entry) => entry.id !== marker.id)
    selectedMarkerId.value = null
    return
  }
  const current = selectedClip.value
  if (!current || current.track.locked) return
  current.track.clips = current.track.clips.filter((clip) => clip.id !== current.clip.id)
  selectedClipKey.value = null
}

function toggleTrackMuted(track: TimelineTrack): void {
  track.muted = !track.muted
}

function toggleTrackLocked(track: TimelineTrack): void {
  track.locked = !track.locked
}

function trackIcon(kind: TimelineTrack['kind']): string {
  switch (kind) {
    case 'slide':
      return 'lucide:presentation'
    case 'layer':
      return 'lucide:layers'
    case 'media':
      return 'lucide:film'
    case 'audio':
      return 'lucide:audio-lines'
    case 'macro':
      return 'lucide:zap'
  }
}

function clipRangeLabel(clip: TimelineClip): string {
  const start = timecodeLabel(clip.startFrame, doc.value.frameRate)
  const end = timecodeLabel(clipEndFrame(clip), doc.value.frameRate)
  return `${start} – ${end}`
}

function clipStyle(clip: TimelineClip): Record<string, string> {
  return {
    left: `${frameToPixel(clip.startFrame, pixelsPerFrame.value)}px`,
    width: `${Math.max(12, frameToPixel(clip.durationFrames, pixelsPerFrame.value))}px`,
  }
}

function markerStyle(marker: TimelineMarker): Record<string, string> {
  return { left: `${frameToPixel(marker.frame, pixelsPerFrame.value)}px` }
}

function tickStyle(frame: number): Record<string, string> {
  return { left: `${frameToPixel(frame, pixelsPerFrame.value)}px` }
}

function playheadStyle(): Record<string, string> {
  return { left: `${frameToPixel(playhead.value, pixelsPerFrame.value)}px` }
}

function guideStyle(): Record<string, string> {
  return { left: `${frameToPixel(snapGuide.value ?? 0, pixelsPerFrame.value)}px` }
}

// --- Saving ---------------------------------------------------------------

function scheduleSave(): void {
  dirty.value = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 700)
}

async function save(): Promise<boolean> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }
  if (!dirty.value) return true
  const parsed = showTimelineSchema.safeParse(doc.value)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Timeline is invalid.'
    return false
  }
  saving.value = true
  error.value = ''
  try {
    const next: TimelineRecord = {
      id: parsed.data.id,
      doc: parsed.data,
      createdAt: props.record.createdAt,
      updatedAt: Date.now(),
    }
    await saveTimeline(next)
    dirty.value = false
    emit('saved', next)
    return true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
    return false
  } finally {
    saving.value = false
  }
}

async function closeEditor(): Promise<void> {
  if (!(await save())) return
  emit('close')
}

async function reset(): Promise<void> {
  hydrating = true
  state.value = cloneDoc(props.record.doc)
  playhead.value = 0
  pixelsPerFrame.value = TIMELINE_DEFAULT_PX_PER_FRAME
  clearSelection()
  error.value = ''
  dirty.value = false
  await nextTick()
  hydrating = false
}

watch(
  () => props.record.id,
  () => void reset(),
  { immediate: true },
)

watch(
  doc,
  () => {
    if (hydrating) return
    error.value = ''
    scheduleSave()
  },
  { deep: true },
)

// --- Pointer interactions -------------------------------------------------

function beginScrub(event: PointerEvent): void {
  if (event.button !== 0) return
  const content = contentEl.value
  if (!content) return
  event.preventDefault()
  const update = (clientX: number): void => {
    const rect = content.getBoundingClientRect()
    playhead.value = frameAtPixel(
      clientX - rect.left,
      pixelsPerFrame.value,
      doc.value.durationFrames,
    )
  }
  update(event.clientX)
  const move = (moveEvent: PointerEvent): void => update(moveEvent.clientX)
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    scrubCleanup = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
  scrubCleanup = up
}

function beginLanePointer(event: PointerEvent): void {
  clearSelection()
  beginScrub(event)
}

function clipTargets(excludeClipId: string): number[] {
  return snapTargets(doc.value.tracks, doc.value.markers, excludeClipId)
}

function beginClipDrag(
  event: PointerEvent,
  track: TimelineTrack,
  clip: TimelineClip,
  mode: DragState['mode'],
): void {
  if (event.button !== 0) return
  selectClip(track, clip)
  if (track.locked) return
  event.preventDefault()
  drag = {
    mode,
    track,
    clip,
    startX: event.clientX,
    initial: {
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
      trimStartFrames: clip.trimStartFrames,
    },
  }
  window.addEventListener('pointermove', onClipDragMove)
  window.addEventListener('pointerup', endClipDrag, { once: true })
}

function onClipDragMove(event: PointerEvent): void {
  if (!drag) return
  const deltaFrames = Math.round((event.clientX - drag.startX) / pixelsPerFrame.value)
  const threshold = snapThresholdFrames(pixelsPerFrame.value)
  const targets = snapEnabled.value ? clipTargets(drag.clip.id) : []
  const initial = drag.initial
  snapGuide.value = null

  if (drag.mode === 'move') {
    let start = initial.startFrame + deltaFrames
    if (targets.length) {
      const snapped = snapClipStart(start, initial.durationFrames, targets, threshold)
      start = snapped.startFrame
      snapGuide.value = snapped.target
    }
    drag.clip.startFrame = clampClipStart(start, initial.durationFrames, doc.value.durationFrames)
    return
  }

  if (drag.mode === 'trim-start') {
    let desired = initial.startFrame + deltaFrames
    if (targets.length) {
      const snapped = snapFrame(desired, targets, threshold)
      desired = snapped.frame
      snapGuide.value = snapped.target
    }
    Object.assign(drag.clip, trimClipFromStart(initial, desired))
    return
  }

  let desired = initial.startFrame + initial.durationFrames + deltaFrames
  if (targets.length) {
    const snapped = snapFrame(desired, targets, threshold)
    desired = snapped.frame
    snapGuide.value = snapped.target
  }
  Object.assign(drag.clip, trimClipFromEnd(initial, desired, doc.value.durationFrames))
}

function endClipDrag(): void {
  window.removeEventListener('pointermove', onClipDragMove)
  drag = null
  snapGuide.value = null
}

function beginMarkerDrag(event: PointerEvent, marker: TimelineMarker): void {
  if (event.button !== 0) return
  event.preventDefault()
  selectMarker(marker)
  const content = contentEl.value
  if (!content) return
  const move = (moveEvent: PointerEvent): void => {
    const rect = content.getBoundingClientRect()
    let frame = frameAtPixel(
      moveEvent.clientX - rect.left,
      pixelsPerFrame.value,
      doc.value.durationFrames,
    )
    if (snapEnabled.value) {
      const targets = snapTargets(
        doc.value.tracks,
        doc.value.markers.filter((entry) => entry.id !== marker.id),
      )
      const snapped = snapFrame(frame, targets, snapThresholdFrames(pixelsPerFrame.value))
      frame = snapped.frame
      snapGuide.value = snapped.target
    } else {
      snapGuide.value = null
    }
    marker.frame = frame
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    markerDrag = null
    snapGuide.value = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
  markerDrag = { up }
}

// --- Zoom, pan and transport ---------------------------------------------

function setZoom(next: number): void {
  pixelsPerFrame.value = clampNumber(next, 0.25, 24)
}

function zoomIn(): void {
  setZoom(zoomBy(pixelsPerFrame.value, 1.5))
}

function zoomOut(): void {
  setZoom(zoomBy(pixelsPerFrame.value, 1 / 1.5))
}

function zoomFit(): void {
  const scroll = scrollEl.value
  const width = scroll?.clientWidth ?? 800
  pixelsPerFrame.value = fitPixelsPerFrame(width, doc.value.durationFrames)
  nextTick(() => {
    if (scroll) scroll.scrollLeft = 0
  })
}

function zoomAt(clientX: number, factor: number): void {
  const scroll = scrollEl.value
  const content = contentEl.value
  if (!scroll || !content) {
    setZoom(zoomBy(pixelsPerFrame.value, factor))
    return
  }
  const scrollRect = scroll.getBoundingClientRect()
  const localX = clientX - scrollRect.left + scroll.scrollLeft
  const anchorFrame = pixelToFrame(localX, pixelsPerFrame.value)
  pixelsPerFrame.value = zoomBy(pixelsPerFrame.value, factor)
  const offset = clientX - scrollRect.left
  nextTick(() => {
    scroll.scrollLeft = Math.max(0, frameToPixel(anchorFrame, pixelsPerFrame.value) - offset)
  })
}

function onWheel(event: WheelEvent): void {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    zoomAt(event.clientX, event.deltaY < 0 ? 1.15 : 1 / 1.15)
    return
  }
  if (event.shiftKey) {
    const scroll = scrollEl.value
    if (scroll) {
      event.preventDefault()
      scroll.scrollLeft += event.deltaY
    }
  }
}

function stepPlayhead(frames: number): void {
  playhead.value = clampNumber(
    Math.round(playhead.value) + frames,
    0,
    doc.value.durationFrames,
  )
}

function goToStart(): void {
  playhead.value = 0
}

function goToEnd(): void {
  playhead.value = doc.value.durationFrames
}

// --- Keyboard -------------------------------------------------------------

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function onKeydown(event: KeyboardEvent): void {
  if (isEditableTarget(event.target)) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      stepPlayhead(event.shiftKey ? -10 : -1)
      break
    case 'ArrowRight':
      event.preventDefault()
      stepPlayhead(event.shiftKey ? 10 : 1)
      break
    case 'Delete':
    case 'Backspace':
      event.preventDefault()
      deleteSelection()
      break
    case 's':
    case 'S':
      event.preventDefault()
      splitSelected()
      break
    case 'm':
    case 'M':
      event.preventDefault()
      addMarker()
      break
    case '+':
    case '=':
      event.preventDefault()
      zoomIn()
      break
    case '-':
      event.preventDefault()
      zoomOut()
      break
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (saveTimer) clearTimeout(saveTimer)
  if (scrubCleanup) scrubCleanup()
  if (markerDrag) markerDrag.up()
  if (drag) endClipDrag()
  if (dirty.value) void save()
})

// --- Styles ---------------------------------------------------------------

const page = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', bg: 'bg.app', color: 'fg.default' })
const header = css({ display: 'flex', alignItems: 'center', gap: '2.5', flexShrink: '0', h: '[52px]', px: '3', borderBottomWidth: '1px', borderColor: 'border.default', bg: 'bg.panel' })
const heading = css({ flex: '1', minW: '0', display: 'flex', alignItems: 'center', gap: '2.5' })
const nameInput = css({ w: '[240px]' })
const eyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', flexShrink: '0' })
const toolbar = css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap', flexShrink: '0', px: '3', py: '1.5', borderBottomWidth: '1px', borderColor: 'border.default', bg: 'bg.panel' })
const group = css({ display: 'flex', alignItems: 'center', gap: '1' })
const separated = css({ display: 'flex', alignItems: 'center', gap: '1', pl: '2', borderLeftWidth: '1px', borderColor: 'border.default' })
const timecode = css({ textStyle: 'ui.mono', fontSize: '[14px]', color: 'fg.default', ml: '1.5', minW: '[92px]' })
const frameLabel = css({ textStyle: 'ui.xs', color: 'fg.subtle', minW: '[88px]' })
const fieldLabel = css({ textStyle: 'ui.xs', color: 'fg.muted' })
const errorText = css({ textStyle: 'ui.xs', color: 'danger.default', px: '3', py: '1', borderBottomWidth: '1px', borderColor: 'border.default' })
const workspace = css({ display: 'flex', flex: '1', minH: '0' })
const headerColumn = css({ w: '[184px]', flexShrink: '0', bg: 'bg.panel', borderRightWidth: '1px', borderColor: 'border.default', overflow: 'hidden' })
const rulerSpacer = css({ h: '[30px]', borderBottomWidth: '1px', borderColor: 'border.default', display: 'flex', alignItems: 'center', px: '3', textStyle: 'ui.xs', color: 'fg.subtle' })
const trackHeader = css({ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1', h: '[52px]', px: '2.5', borderBottomWidth: '1px', borderColor: 'border.default' })
const trackTitle = css({ display: 'flex', alignItems: 'center', gap: '1.5', minW: '0' })
const trackName = css({ flex: '1', minW: '0', textStyle: 'ui.sm', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const trackMeta = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const scroll = css({ flex: '1', minW: '0', minH: '0', overflow: 'auto', position: 'relative' })
const content = css({ position: 'relative', minH: 'full', userSelect: 'none' })
const ruler = css({ position: 'relative', h: '[30px]', borderBottomWidth: '1px', borderColor: 'border.default', bg: 'bg.canvas', cursor: 'col-resize', overflow: 'hidden' })
const tick = css({ position: 'absolute', top: '0', bottom: '0', borderLeftWidth: '1px', borderColor: 'border.strong', pointerEvents: 'none' })
const tickLabel = css({ position: 'absolute', top: '1.5', left: '1', textStyle: 'ui.xs', color: 'fg.subtle', whiteSpace: 'nowrap' })
const markerFlag = css({
  position: 'absolute',
  bottom: '0',
  display: 'grid',
  placeItems: 'center',
  w: '[16px]',
  h: '[18px]',
  transform: 'translateX(-50%)',
  borderTopLeftRadius: 'xs',
  borderTopRightRadius: 'xs',
  bg: 'accent.muted',
  color: 'accent.default',
  cursor: 'ew-resize',
  borderWidth: '1px',
  borderColor: 'accent.default',
  zIndex: '[2]',
})
const markerOff = css({ opacity: 0.45 })
const markerSelected = css({ bg: 'accent.default', color: 'fg.onAccent' })
const lane = css({ position: 'relative', h: '[52px]', borderBottomWidth: '1px', borderColor: 'border.default', _hover: { bg: 'bg.subtle' } })
const clip = css({
  position: 'absolute',
  top: '[8px]',
  h: '[36px]',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: '0',
  px: '2',
  overflow: 'hidden',
  borderRadius: 'sm',
  borderWidth: '1px',
  borderColor: 'transparent',
  color: 'fg.onAccent',
  cursor: 'grab',
  touchAction: 'none',
})
const clipSelected = css({ outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'accent.default', zIndex: '[2]' })
const clipLocked = css({ opacity: 0.6, cursor: 'default' })
const clipLabel = css({ textStyle: 'ui.xs', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const clipMeta = css({ textStyle: 'ui.xs', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const trimHandle = css({ position: 'absolute', top: '0', bottom: '0', w: '[7px]', cursor: 'ew-resize', bg: 'transparent', _hover: { bg: 'selection.hover' } })
const trimLeft = css({ left: '0' })
const trimRight = css({ right: '0' })
const clipTone: Record<TimelineClip['kind'], string> = {
  slide: css({ bg: 'track.violet' }),
  media: css({ bg: 'track.blue' }),
  audio: css({ bg: 'track.green' }),
  macro: css({ bg: 'track.amber' }),
}
const playheadLine = css({ position: 'absolute', top: '0', bottom: '0', w: '[1px]', bg: 'accent.default', pointerEvents: 'none', zIndex: '[3]' })
const playheadHandle = css({ position: 'absolute', top: '0', w: '[12px]', h: '[13px]', transform: 'translateX(-50%)', bg: 'accent.default', borderTopLeftRadius: 'xs', borderTopRightRadius: 'xs', cursor: 'ew-resize', zIndex: '[4]' })
const snapGuideLine = css({ position: 'absolute', top: '0', bottom: '0', w: '[1px]', borderLeftWidth: '1px', borderStyle: 'dashed', borderColor: 'accent.default', pointerEvents: 'none', zIndex: '[2]' })
const inspector = css({ w: 'inspector', flexShrink: '0' })
const inspectorNote = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const zoomLabel = css({ textStyle: 'ui.xs', color: 'fg.muted', minW: '[42px]', textAlign: 'center' })
</script>

<template>
  <div :class="page">
    <header :class="header">
      <IconButton icon="lucide:arrow-left" label="Back to timelines" @click="closeEditor" />
      <div :class="heading">
        <span :class="eyebrow">Timeline</span>
        <Input v-model="nameField" live size="sm" :class="nameInput" aria-label="Timeline name" />
        <Badge :tone="dirty ? 'warning' : 'success'" dot :label="dirty ? 'Unsaved' : 'Saved'" />
      </div>
      <Select
        v-model="frameRateField"
        :options="rateOptions"
        size="sm"
        aria-label="Frame rate"
      />
      <NumberField
        v-model="durationField"
        :units="unitless"
        :min="1"
        :decimals="0"
        label="Dur"
        size="sm"
        aria-label="Timeline duration in frames"
      />
      <span :class="frameLabel">{{ durationLabel }}</span>
      <Button variant="primary" icon="lucide:save" size="sm" :loading="saving" @click="save">
        Save
      </Button>
    </header>

    <div :class="toolbar">
      <div :class="group">
        <IconButton icon="lucide:skip-back" label="Go to start" @click="goToStart" />
        <IconButton icon="lucide:step-back" label="Previous frame" @click="stepPlayhead(-1)" />
        <IconButton icon="lucide:play" label="Playback is not available yet" disabled />
        <IconButton icon="lucide:step-forward" label="Next frame" @click="stepPlayhead(1)" />
        <IconButton icon="lucide:skip-forward" label="Go to end" @click="goToEnd" />
        <span :class="timecode">{{ playheadTimecode }}</span>
        <span :class="frameLabel">Frame {{ Math.round(playhead) }} / {{ doc.durationFrames }}</span>
      </div>

      <div :class="separated">
        <span :class="fieldLabel">Clip</span>
        <Select v-model="newClipKind" :options="clipKindOptions" size="sm" aria-label="New clip kind" />
        <Button variant="secondary" size="sm" icon="lucide:plus" @click="addClip(newClipKind)">Add</Button>
        <Button variant="secondary" size="sm" icon="lucide:scissors" @click="splitSelected">Split</Button>
        <Button variant="secondary" size="sm" icon="lucide:flag" @click="addMarker">Marker</Button>
        <Button variant="ghost" size="sm" icon="lucide:trash-2" @click="deleteSelection">Delete</Button>
      </div>

      <div :class="separated">
        <span :class="fieldLabel">Snap</span>
        <Switch v-model="snapEnabled" size="sm" aria-label="Snap to frames, clip edges and markers" />
        <IconButton icon="lucide:zoom-out" label="Zoom out" @click="zoomOut" />
        <span :class="zoomLabel">{{ zoomPercent }}%</span>
        <IconButton icon="lucide:zoom-in" label="Zoom in" @click="zoomIn" />
        <IconButton icon="lucide:maximize" label="Fit timeline" @click="zoomFit" />
      </div>
    </div>

    <p v-if="error" :class="errorText">{{ error }}</p>

    <div :class="workspace">
      <div :class="headerColumn">
        <div :class="rulerSpacer">
          <span>{{ clipCount }} clips · {{ doc.markers.length }} markers</span>
        </div>
        <div v-for="track in doc.tracks" :key="track.id" :class="trackHeader">
          <div :class="trackTitle">
            <Icon :name="trackIcon(track.kind)" :size="13" aria-hidden="true" />
            <span :class="trackName">{{ track.name }}</span>
            <IconButton
              :icon="track.muted ? 'lucide:volume-x' : 'lucide:volume-2'"
              :label="track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`"
              :active="track.muted"
              size="sm"
              @click="toggleTrackMuted(track)"
            />
            <IconButton
              :icon="track.locked ? 'lucide:lock' : 'lucide:unlock'"
              :label="track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`"
              :active="track.locked"
              size="sm"
              @click="toggleTrackLocked(track)"
            />
          </div>
          <span :class="trackMeta">{{ trackKindLabel(track.kind) }} · {{ track.clips.length }} clips</span>
        </div>
      </div>

      <div ref="scrollEl" :class="scroll" @wheel="onWheel">
        <div ref="contentEl" :class="content" :style="{ width: `${contentWidth}px` }">
          <div :class="ruler" @pointerdown="beginScrub">
            <div v-for="entry in ticks" :key="entry.frame" :class="tick" :style="tickStyle(entry.frame)">
              <span :class="tickLabel">{{ entry.label }}</span>
            </div>
            <button
              v-for="marker in doc.markers"
              :key="marker.id"
              type="button"
              :class="[markerFlag, marker.enabled ? '' : markerOff, marker.id === selectedMarkerId ? markerSelected : '']"
              :style="markerStyle(marker)"
              :title="marker.label || `Marker ${marker.frame}`"
              :aria-label="marker.label || `Marker at frame ${marker.frame}`"
              @pointerdown.stop="beginMarkerDrag($event, marker)"
            >
              <Icon name="lucide:flag" :size="9" aria-hidden="true" />
            </button>
            <div
              :class="playheadHandle"
              :style="playheadStyle()"
              role="slider"
              aria-label="Playhead"
              :aria-valuemin="0"
              :aria-valuemax="doc.durationFrames"
              :aria-valuenow="Math.round(playhead)"
              tabindex="0"
              @pointerdown.stop="beginScrub"
            />
          </div>

          <div
            v-for="track in doc.tracks"
            :key="track.id"
            :class="lane"
            @pointerdown="beginLanePointer"
          >
            <div
              v-for="entry in track.clips"
              :key="entry.id"
              :class="[
                clip,
                clipTone[entry.kind],
                selectedClipKey?.clipId === entry.id ? clipSelected : '',
                track.locked ? clipLocked : '',
              ]"
              :style="clipStyle(entry)"
              @pointerdown.stop="beginClipDrag($event, track, entry, 'move')"
            >
              <span :class="clipLabel">{{ entry.label || clipKindLabel(entry.kind) }}</span>
              <span :class="clipMeta">{{ clipRangeLabel(entry) }}</span>
              <div
                v-if="!track.locked"
                :class="[trimHandle, trimLeft]"
                aria-hidden="true"
                @pointerdown.stop="beginClipDrag($event, track, entry, 'trim-start')"
              />
              <div
                v-if="!track.locked"
                :class="[trimHandle, trimRight]"
                aria-hidden="true"
                @pointerdown.stop="beginClipDrag($event, track, entry, 'trim-end')"
              />
            </div>
          </div>

          <div :class="playheadLine" :style="playheadStyle()" aria-hidden="true" />
          <div v-if="snapGuide !== null" :class="snapGuideLine" :style="guideStyle()" aria-hidden="true" />
        </div>
      </div>

      <Panel title="Inspector" bordered="left" :class="inspector">
        <EmptyState
          v-if="!selectedClip && !selectedMarker"
          icon="lucide:mouse-pointer-2"
          title="Nothing selected"
          description="Select a clip or a marker to edit it."
          size="sm"
        />

        <template v-else-if="selectedClip">
          <PanelSection title="Clip">
            <PropertyRow label="Kind">
              <Badge :label="clipKindLabel(selectedClip.clip.kind)" />
            </PropertyRow>
            <PropertyRow label="Track">
              <span :class="inspectorNote">{{ selectedClip.track.name }}</span>
            </PropertyRow>
            <PropertyRow label="Label">
              <Input v-model="clipLabelField" live size="sm" aria-label="Clip label" />
            </PropertyRow>
            <PropertyRow label="Start">
              <NumberField
                v-model="clipStartField"
                :units="unitless"
                :min="0"
                :decimals="0"
                size="sm"
                aria-label="Clip start frame"
              />
            </PropertyRow>
            <PropertyRow label="Duration">
              <NumberField
                v-model="clipDurationField"
                :units="unitless"
                :min="1"
                :decimals="0"
                size="sm"
                aria-label="Clip duration in frames"
              />
            </PropertyRow>
            <PropertyRow label="Trim in">
              <NumberField
                v-model="clipTrimField"
                :units="unitless"
                :min="0"
                :decimals="0"
                size="sm"
                aria-label="Clip trim-in frames"
              />
            </PropertyRow>
            <PropertyRow label="End">
              <span :class="inspectorNote">{{ clipEndFrame(selectedClip.clip) }} frames</span>
            </PropertyRow>
            <PropertyRow v-if="selectedClip.clip.kind === 'audio'" label="Gain">
              <Slider
                :model-value="selectedClip.clip.gain"
                :min="0"
                :max="1"
                :step="0.01"
                aria-label="Clip gain"
                @update:model-value="clipGainField = String($event)"
              />
            </PropertyRow>
            <PropertyRow v-if="selectedClip.clip.kind === 'audio'" label="Loop">
              <Switch v-model="clipLoopField" size="sm" aria-label="Loop audio clip" />
            </PropertyRow>
            <PropertyRow v-if="selectedClip.clip.kind === 'macro'" label="Action">
              <Select v-model="macroAction" :options="macroActionOptions" size="sm" aria-label="Macro action" />
            </PropertyRow>
            <PropertyRow v-if="selectedClip.clip.kind === 'slide'" label="Slide">
              <span :class="inspectorNote">
                {{ selectedClip.clip.presentationId ?? 'No presentation linked' }}
              </span>
            </PropertyRow>
            <PropertyRow v-if="selectedClip.clip.kind === 'media'" label="Asset">
              <span :class="inspectorNote">{{ selectedClip.clip.assetId ?? 'No asset linked' }}</span>
            </PropertyRow>
            <p v-if="selectedClip.track.locked" :class="inspectorNote">This track is locked.</p>
          </PanelSection>
        </template>

        <template v-else-if="selectedMarker">
          <PanelSection title="Marker">
            <PropertyRow label="Label">
              <Input v-model="markerLabelField" live size="sm" aria-label="Marker label" />
            </PropertyRow>
            <PropertyRow label="Frame">
              <NumberField
                v-model="markerFrameField"
                :units="unitless"
                :min="0"
                :max="doc.durationFrames"
                :decimals="0"
                size="sm"
                aria-label="Marker frame"
              />
            </PropertyRow>
            <PropertyRow label="Time">
              <span :class="inspectorNote">{{ timecodeLabel(selectedMarker.frame, doc.frameRate) }}</span>
            </PropertyRow>
            <PropertyRow label="Enabled">
              <Switch v-model="markerEnabledField" size="sm" aria-label="Marker enabled" />
            </PropertyRow>
            <PropertyRow label="Action">
              <span :class="inspectorNote">{{ selectedMarker.action?.type ?? 'No action' }}</span>
            </PropertyRow>
          </PanelSection>
        </template>

        <template v-if="selectedClip || selectedMarker" #footer>
          <Button
            v-if="selectedClip"
            variant="danger"
            size="sm"
            block
            icon="lucide:trash-2"
            :disabled="selectedLocked"
            @click="deleteSelection"
          >
            Delete clip
          </Button>
          <Button
            v-else-if="selectedMarker"
            variant="danger"
            size="sm"
            block
            icon="lucide:trash-2"
            @click="deleteSelection"
          >
            Delete marker
          </Button>
        </template>
      </Panel>
    </div>
  </div>
</template>
