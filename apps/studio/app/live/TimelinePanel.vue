<script setup lang="ts">
import { formatTimecode, timecodeFromFrames } from '@lumen/core'
import type { TimecodeSnapshot } from '@lumen/schema'
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Badge, Button, IconButton, NumberField, SegmentedControl, Select, Slider, Switch, type SegmentOption } from '~/ui'
import type { TimelineClock, useShowTimeline } from './useShowTimeline'

const props = defineProps<{
  timecode: TimecodeSnapshot | null
  runner: ReturnType<typeof useShowTimeline>
}>()

const router = useRouter()
// Body is hidden with v-show, never unmounted, so armed cues keep firing while collapsed.
const open = ref(false)

const runner = props.runner
const doc = runner.doc
const playback = runner.playback

const clockOptions: SegmentOption<TimelineClock>[] = [
  { value: 'internal', label: 'Internal' },
  { value: 'external', label: 'LTC/MTC' },
]

const timelineOptions = computed(() =>
  runner.timelines.value.map((entry) => ({ value: entry.id, label: entry.name })),
)

function label(frame: number): string {
  if (!doc.value) return '--:--:--:--'
  return formatTimecode(timecodeFromFrames(Math.max(0, frame), doc.value.frameRate))
}

const playheadLabel = computed(() => label(playback.value.frame))
const durationLabel = computed(() => label(runner.durationFrames.value))
const markerCount = computed(() => doc.value?.markers.length ?? 0)
const clipCount = computed(() => doc.value?.tracks.reduce((sum, track) => sum + track.clips.length, 0) ?? 0)
const activeLabels = computed(() =>
  (runner.evaluation.value?.clips ?? []).map((clip) => clip.label || clip.kind).slice(0, 3).join(' · '),
)

const statusTone = computed(() => {
  if (!runner.armed.value) return 'neutral'
  if (runner.clock.value === 'internal') return playback.value.playing ? 'success' : 'neutral'
  return props.timecode?.locked && !runner.rateMismatch.value ? 'success' : 'warning'
})
const statusLabel = computed(() => {
  if (!runner.armed.value) return 'DISARMED'
  if (runner.clock.value === 'internal') return playback.value.playing ? 'RUNNING' : 'ARMED'
  if (runner.rateMismatch.value) return 'RATE'
  return props.timecode?.locked ? 'LOCKED' : 'NO LOCK'
})

const firedLabel = computed(() => runner.lastFired.value.map((entry) => entry.label).join(', '))

function onSelect(id: string | undefined): void {
  if (id) void runner.select(id)
}

function onClock(value: TimelineClock | undefined): void {
  if (value) runner.setClock(value)
}

function onOffset(value: string): void {
  const frames = Number.parseInt(value, 10)
  runner.setOffset(Number.isFinite(frames) ? frames : 0)
}

function scrub(value: number): void {
  runner.seek(value)
}

function openEditor(): void {
  void router.push(doc.value ? { path: '/timeline', query: { id: doc.value.id } } : '/timeline')
}

const root = css({ py: '2', borderBottomWidth: '1px', borderColor: 'border.default' })
const head = css({ display: 'flex', alignItems: 'center', gap: '2', h: 'control.md', pl: '3', pr: '3' })
const title = css({ flex: '1', minW: '0', display: 'flex', alignItems: 'center', gap: '1', h: 'full', textStyle: 'ui.label', color: 'fg.default', textAlign: 'left', cursor: 'pointer', borderRadius: 'xs' })
const body = css({ display: 'flex', flexDirection: 'column', gap: '2.5', px: '3', pt: '1.5', pb: '1' })
const row = css({ display: 'flex', alignItems: 'center', gap: '2' })
const clockRow = css({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '2' })
const mono = css({ textStyle: 'ui.mono', fontSize: '[18px]', color: 'fg.default', fontVariantNumeric: 'tabular-nums' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const failure = css({ textStyle: 'ui.xs', color: 'danger.default' })
const fieldLabel = css({ textStyle: 'ui.xs', color: 'fg.muted', flex: '1' })
const notice = css({ display: 'flex', flexDirection: 'column', gap: '2', p: '2.5', borderRadius: 'sm', bg: 'bg.subtle', textStyle: 'ui.xs', color: 'fg.muted' })
</script>

<template>
  <section :class="root" aria-label="Show timeline">
    <div :class="head">
      <button type="button" :class="title" :aria-expanded="open" aria-controls="timeline-body" @click="open = !open">
        <span>Timeline</span>
        <Icon name="lucide:chevron-down" :size="12" :class="css({ color: 'fg.subtle', transition: 'transform', ...(open ? {} : { transform: 'rotate(-90deg)' }) })" aria-hidden="true" />
        <span v-if="!open && doc" :class="[hint, css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })]">{{ playheadLabel }}</span>
      </button>
      <Badge :tone="statusTone" dot :label="statusLabel" />
      <Switch :model-value="runner.armed.value" size="sm" :disabled="!doc" aria-label="Arm timeline" @update:model-value="runner.setArmed" />
    </div>

    <div v-show="open" id="timeline-body" :class="body">
      <p v-if="runner.loading.value" :class="hint">Loading timelines…</p>
      <p v-else-if="runner.error.value" :class="failure" role="alert">{{ runner.error.value }}</p>

      <div v-if="runner.legacyCueCount.value > 0" :class="notice">
        <span>{{ runner.legacyCueCount.value }} LTC cues from the old cue list are not in a timeline yet.</span>
        <Button variant="secondary" size="sm" icon="lucide:import" @click="runner.importLegacyCues">Import as markers</Button>
      </div>

      <template v-if="!runner.loading.value">
        <div v-if="timelineOptions.length === 0" :class="notice">
          <span>No timelines yet. Build one to drive slides, media and macros by timestamp.</span>
          <Button variant="primary" size="sm" icon="lucide:plus" @click="openEditor">Create timeline</Button>
        </div>

        <template v-else>
          <div :class="row">
            <Select
              :model-value="doc?.id"
              :options="timelineOptions"
              aria-label="Timeline"
              @update:model-value="onSelect"
            />
            <IconButton icon="lucide:pencil" label="Edit timeline" size="sm" @click="openEditor" />
          </div>

          <SegmentedControl
            :model-value="runner.clock.value"
            :options="clockOptions"
            size="sm"
            aria-label="Timeline clock"
            @update:model-value="onClock"
          />

          <div :class="clockRow">
            <span :class="mono">{{ playheadLabel }}</span>
            <span :class="hint">/ {{ durationLabel }}</span>
          </div>

          <Slider
            v-if="doc"
            :model-value="playback.frame"
            :min="0"
            :max="Math.max(1, runner.durationFrames.value - 1)"
            :step="1"
            :disabled="runner.clock.value === 'external'"
            aria-label="Playhead"
            @update:model-value="scrub"
          />

          <div v-if="runner.clock.value === 'internal'" :class="row">
            <IconButton icon="lucide:skip-back" label="Stop and rewind" size="sm" @click="runner.stop" />
            <IconButton icon="lucide:step-back" label="Previous frame" size="sm" @click="runner.step(-1)" />
            <Button
              variant="primary"
              size="sm"
              :icon="playback.playing ? 'lucide:pause' : 'lucide:play'"
              @click="runner.togglePlay"
            >
              {{ playback.playing ? 'Pause' : 'Play' }}
            </Button>
            <IconButton icon="lucide:step-forward" label="Next frame" size="sm" @click="runner.step(1)" />
            <span :class="css({ flex: '1' })" />
            <span :class="hint">Loop</span>
            <Switch :model-value="playback.loop" size="sm" aria-label="Loop timeline" @update:model-value="runner.setLoop" />
          </div>

          <template v-else>
            <div :class="row">
              <span :class="fieldLabel">Offset (frames)</span>
              <NumberField
                :model-value="String(playback.offsetFrames)"
                :units="['']"
                :step="1"
                :decimals="0"
                size="sm"
                aria-label="Timecode offset in frames"
                @update:model-value="onOffset"
              />
            </div>
            <p :class="hint">
              {{ props.timecode?.source?.toUpperCase() ?? 'No source' }} · timeline frame = external frame − offset
            </p>
            <p v-if="runner.rateMismatch.value" :class="failure">
              Source rate {{ props.timecode?.timecode?.rate }} does not match timeline {{ doc?.frameRate }}.
            </p>
          </template>

          <p :class="hint">{{ markerCount }} markers · {{ clipCount }} clips<template v-if="activeLabels"> · now: {{ activeLabels }}</template></p>
          <p v-if="!runner.armed.value" :class="hint">Arm to let markers and clips drive the live output.</p>
          <p v-if="firedLabel" :class="hint">Fired: {{ firedLabel }}</p>
        </template>
      </template>
    </div>
  </section>
</template>
