<script setup lang="ts">
import { css } from 'styled-system/css'
import type { ScreenPatch } from '@lumen/core'
import type { Composition } from '@lumen/schema'
import { shallowRef, watch } from 'vue'
import { screenStatus, targetLabel, type ScreenStatusKind } from '~/screens/screenStatus'
import { useScreenOutputs } from '~/screens/useScreenOutputs'
import { Badge, Button, SegmentedControl, Switch, type SegmentOption } from '~/ui'
import CompositionMonitor from './CompositionMonitor.vue'
import { updateScreen, updateScreenLayout, type Screen, type TextPreset } from './showModel'
import { useShowDocument } from './useShowDocument'
import { useShowLive } from './useShowLive'

/** One thumbnail per screen with the switches an operator needs while live. */
const showDocument = useShowDocument()
const show = showDocument.show
const live = useShowLive()
const outputs = useScreenOutputs()
const displays = outputs.displays

const presetOptions: SegmentOption<TextPreset>[] = [
  { value: 'full', label: 'Full' },
  { value: 'lowerThird', label: 'Lower' },
  { value: 'strip', label: 'Strip' },
  { value: 'hidden', label: 'Off' },
]

const tones: Record<ScreenStatusKind, 'neutral' | 'success' | 'warning' | 'info'> = {
  off: 'neutral',
  virtual: 'neutral',
  offline: 'warning',
  ready: 'info',
  live: 'success',
}

// One program composition for every thumbnail; freeze holds it with the outputs.
const program = shallowRef<Composition | null>(null)
watch(
  () => [show.value, live.version.value] as const,
  () => {
    if (live.mode.value === 'freeze' && program.value) return
    program.value = live.frameComposition('program')
  },
  { immediate: true },
)

/** Thumbnails render at most every this many ms each, so many screens stay cheap. */
const THUMBNAIL_THROTTLE_MS = 150

function status(screen: Screen) {
  return screenStatus(screen, outputs.displays.value, outputs.outputFor)
}

function patch(screen: Screen, value: ScreenPatch): void {
  showDocument.update((current) => updateScreen(current, screen.id, value))
}

function setPreset(screen: Screen, preset: TextPreset | undefined): void {
  if (!preset) return
  const text = { scale: 1, color: null, ...screen.layout.text, preset }
  showDocument.update((current) => updateScreenLayout(current, screen.id, { text }))
}

const root = css({ display: 'flex', flexDirection: 'column', gap: '2', p: '2' })
const card = css({ display: 'flex', flexDirection: 'column', gap: '2', p: '2', borderRadius: 'sm', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default' })
const head = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2' })
const name = css({ textStyle: 'ui.sm', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const meta = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const row = css({ display: 'flex', alignItems: 'center', gap: '3', textStyle: 'ui.xs', color: 'fg.muted' })
const toggle = css({ display: 'flex', alignItems: 'center', gap: '1.5' })
</script>

<template>
  <div :class="root">
    <p v-if="show.screens.length === 0" :class="meta">No screens. Add them in the Screens workspace.</p>
    <article v-for="screen in show.screens" :key="screen.id" :class="card" :aria-label="`Screen ${screen.name}`">
      <div :class="head">
        <div :class="css({ minW: '0' })">
          <p :class="name">{{ screen.name }}</p>
          <p :class="meta">{{ targetLabel(screen) }}</p>
        </div>
        <Badge :tone="tones[status(screen).kind]" dot>{{ status(screen).label }}</Badge>
      </div>
      <CompositionMonitor
        :composition="program"
        :screen="live.frameScreen(screen)"
        :max-width="320"
        :throttle-ms="THUMBNAIL_THROTTLE_MS"
        :label="`${screen.name} output`"
      />
      <div :class="row">
        <label :class="toggle">
          <Switch :model-value="screen.enabled" size="sm" aria-label="Enabled" @update:model-value="(on: boolean) => patch(screen, { enabled: on })" />
          On
        </label>
        <label :class="toggle">
          <Switch :model-value="screen.blackout" size="sm" aria-label="Blackout" @update:model-value="(on: boolean) => patch(screen, { blackout: on })" />
          Blackout
        </label>
        <span :class="css({ flex: '1' })" />
        <Button
          v-if="screen.target.kind === 'display' && displays.length > 0"
          size="sm"
          variant="ghost"
          :icon="outputs.outputForScreen(screen) ? 'lucide:monitor-off' : 'lucide:monitor-play'"
          :disabled="status(screen).kind === 'offline' || !screen.enabled"
          @click="outputs.outputForScreen(screen) ? outputs.close(screen) : outputs.open(screen)"
        >
          {{ outputs.outputForScreen(screen) ? 'Close' : 'Open' }}
        </Button>
      </div>
      <SegmentedControl
        :model-value="screen.layout.text?.preset ?? 'full'"
        :options="presetOptions"
        size="sm"
        fill
        aria-label="Text preset"
        @update:model-value="(value?: TextPreset) => setPreset(screen, value)"
      />
    </article>
  </div>
</template>
