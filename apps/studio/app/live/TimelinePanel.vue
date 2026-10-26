<script setup lang="ts">
import { formatTimecode, frameCount, parseTimecode, timecodeFromFrames } from '@lumen/core'
import type {
  ControlCommand,
  FrameRate,
  LiveCommand,
  TimecodeSnapshot,
  TimelineCue,
} from '@lumen/schema'
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { Badge, Button, IconButton, Input, Select, Switch } from '~/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useTimeline } from '~/control/useTimeline'

const props = defineProps<{
  timecode: TimecodeSnapshot | null
  apply: (command: LiveCommand) => void
}>()

const { timeline, armed, playhead, lastFired, rateMismatch, ready, setArmed, save } = useTimeline(
  () => props.timecode,
  props.apply,
)

type ActionKey = 'next' | 'prev' | 'take' | 'black' | 'clear' | 'logo' | 'freeze'

const actionOptions: { value: ActionKey; label: string }[] = [
  { value: 'next', label: 'Next slide' },
  { value: 'prev', label: 'Previous slide' },
  { value: 'take', label: 'Take preview' },
  { value: 'black', label: 'Black' },
  { value: 'clear', label: 'Clear' },
  { value: 'logo', label: 'Logo' },
  { value: 'freeze', label: 'Freeze' },
]

const rateOptions: { value: FrameRate; label: string }[] = [
  { value: '23.976', label: '23.976' },
  { value: '24', label: '24' },
  { value: '25', label: '25' },
  { value: '29.97', label: '29.97' },
  { value: '29.97df', label: '29.97 drop-frame' },
  { value: '30', label: '30' },
]

// Body is hidden with v-show, never unmounted, so armed cues keep firing while collapsed.
const open = ref(false)
const cueTime = ref('')
const cueLabel = ref('')
const cueAction = ref<ActionKey>('next')
const error = ref('')
let saveTimer: ReturnType<typeof setTimeout> | undefined

const rate = computed(() => timeline.value?.frameRate ?? '29.97df')
const playheadLabel = computed(() => (playhead.value ? formatTimecode(playhead.value) : '--:--:--:--'))
const sortedCues = computed(() =>
  [...(timeline.value?.cues ?? [])].sort((a, b) => a.atFrames - b.atFrames),
)
const statusTone = computed(() => {
  if (!armed.value) return 'neutral'
  return props.timecode?.locked ? 'success' : 'warning'
})
const statusLabel = computed(() => {
  if (!armed.value) return 'DISARMED'
  return props.timecode?.locked ? 'LOCKED' : 'NO LOCK'
})
const firedLabel = computed(() => lastFired.value.map((cue) => cue.label || cue.atFrames).join(', '))

function commandFor(action: ActionKey): ControlCommand {
  switch (action) {
    case 'next':
      return { type: 'next' }
    case 'prev':
      return { type: 'prev' }
    case 'take':
      return { type: 'take' }
    default:
      return { type: 'setMode', mode: action }
  }
}

function cueId(): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `cue_${suffix}`
}

function addCue(): void {
  if (!timeline.value) return
  const at = parseTimecode(cueTime.value, timeline.value.frameRate)
  if (!at) {
    error.value = 'Use HH:MM:SS:FF within the selected frame rate.'
    return
  }
  timeline.value.cues.push({
    id: cueId(),
    label: cueLabel.value.trim(),
    atFrames: frameCount(at),
    action: commandFor(cueAction.value),
    enabled: true,
  })
  cueTime.value = ''
  cueLabel.value = ''
  error.value = ''
  void save()
}

function removeCue(cue: TimelineCue): void {
  if (!timeline.value) return
  timeline.value.cues = timeline.value.cues.filter((entry) => entry.id !== cue.id)
  void save()
}

function usePlayhead(): void {
  if (playhead.value) cueTime.value = formatTimecode(playhead.value)
}

function setRate(value: FrameRate | undefined): void {
  if (value && timeline.value) timeline.value.frameRate = value
}

function labelForCue(cue: TimelineCue): string {
  const at = timecodeFromFrames(cue.atFrames, rate.value)
  return `${formatTimecode(at)} · ${cue.label || cue.action.type}`
}

function scheduleSave(): void {
  if (!ready.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 300)
}

watch(timeline, scheduleSave, { deep: true })

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
})

const root = css({ py: '2', borderBottomWidth: '1px', borderColor: 'border.default' })
const head = css({ display: 'flex', alignItems: 'center', gap: '2', h: 'control.md', pl: '3', pr: '3' })
const title = css({ flex: '1', display: 'flex', alignItems: 'center', gap: '1', h: 'full', textStyle: 'ui.label', color: 'fg.default', textAlign: 'left', cursor: 'pointer', borderRadius: 'xs' })
const body = css({ px: '3', pt: '1.5', pb: '1' })
const field = css({ display: 'flex', flexDirection: 'column', gap: '1.5', mb: '2' })
const label = css({ textStyle: 'ui.xs', color: 'fg.muted' })
const row = css({ display: 'flex', alignItems: 'center', gap: '2', mb: '2' })
const playheadRow = css({ display: 'flex', alignItems: 'baseline', gap: '2', mb: '2' })
const mono = css({ textStyle: 'ui.mono', fontSize: '[18px]', color: 'fg.default' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const failure = css({ textStyle: 'ui.xs', color: 'danger.default', mb: '2' })
const cueRow = css({
  display: 'flex',
  alignItems: 'center',
  gap: '1.5',
  py: '1.5',
  borderBottomWidth: '1px',
  borderColor: 'border.default',
  _last: { borderBottomWidth: '0' },
})
const cueMeta = css({ flex: '1', minW: '0' })
const cueTitle = css({ textStyle: 'ui.mono', fontSize: '[12px]', color: 'fg.default' })
const cueNote = css({ textStyle: 'ui.xs', color: 'fg.subtle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
</script>

<template>
  <section :class="root" aria-label="LTC timeline">
    <div :class="head">
      <button type="button" :class="title" :aria-expanded="open" aria-controls="timeline-body" @click="open = !open">
        <span>Timeline</span>
        <Icon name="lucide:chevron-down" :size="12" :class="css({ color: 'fg.subtle', transition: 'transform', ...(open ? {} : { transform: 'rotate(-90deg)' }) })" aria-hidden="true" />
        <span v-if="!open && timeline" :class="hint">{{ sortedCues.length }} cues</span>
      </button>
      <Badge :tone="statusTone" dot :label="statusLabel" />
      <Switch :model-value="armed" size="sm" aria-label="Arm timeline" @update:model-value="setArmed" />
    </div>

    <div v-show="open" id="timeline-body" :class="body">
    <p v-if="!timeline" :class="hint">Loading timeline…</p>
    <template v-if="timeline">
      <div :class="field">
        <span :class="label">Name</span>
        <Input v-model="timeline.name" size="sm" aria-label="Timeline name" />
      </div>

      <div :class="row">
        <Select
          :model-value="timeline.frameRate"
          :options="rateOptions"
          aria-label="Timeline frame rate"
          @update:model-value="setRate"
        />
        <Button variant="ghost" size="sm" :disabled="!playhead" @click="usePlayhead">At playhead</Button>
      </div>

      <div :class="playheadRow">
        <span :class="mono">{{ playheadLabel }}</span>
        <span :class="hint">{{ props.timecode?.source?.toUpperCase() ?? 'NO SOURCE' }}</span>
      </div>
      <p v-if="rateMismatch" :class="failure">
        Source rate {{ props.timecode?.timecode?.rate }} does not match timeline {{ timeline.frameRate }}.
      </p>

      <div :class="field">
        <span :class="label">Add cue</span>
        <div :class="row">
          <Input v-model="cueTime" size="sm" placeholder="00:00:00:00" aria-label="Cue timecode" />
          <Select v-model="cueAction" :options="actionOptions" aria-label="Cue action" />
        </div>
        <Input v-model="cueLabel" size="sm" placeholder="Cue label" aria-label="Cue label" />
        <Button variant="secondary" size="sm" icon="lucide:plus" @click="addCue">Add cue</Button>
      </div>

      <p v-if="error" :class="failure">{{ error }}</p>
      <p v-if="sortedCues.length === 0" :class="hint">No cues yet.</p>
      <div v-for="cue in sortedCues" :key="cue.id" :class="cueRow">
        <div :class="cueMeta">
          <p :class="cueTitle">{{ labelForCue(cue) }}</p>
          <p :class="cueNote">{{ cue.action.type }}</p>
        </div>
        <Switch v-model="cue.enabled" size="sm" :aria-label="`Enable ${cue.label || cue.action.type}`" />
        <IconButton icon="lucide:x" label="Remove cue" size="sm" @click="removeCue(cue)" />
      </div>

      <p v-if="firedLabel" :class="hint">Fired: {{ firedLabel }}</p>
    </template>
    </div>
  </section>
</template>
