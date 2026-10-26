<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { Button, IconButton, Input } from '~/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface Cue {
  id: string
  label: string
  kind: 'song' | 'slide'
  lines: string[]
}

const cues: Cue[] = [
  { id: 'c1', label: 'Great Are You Lord', kind: 'song', lines: ['You give life, You are love', 'You bring light to the darkness'] },
  { id: 'c2', label: 'Great Are You Lord', kind: 'song', lines: ['You give hope, You restore', 'Every heart that is broken'] },
  { id: 'c3', label: 'Great Are You Lord', kind: 'song', lines: ["It's Your breath in our lungs", 'So we pour out our praise'] },
  { id: 'c4', label: 'Welcome', kind: 'slide', lines: ['Welcome to Riverside', 'Sunday Gathering'] },
  { id: 'c5', label: 'Way Maker', kind: 'song', lines: ['Way maker, miracle worker', 'Promise keeper, light in the darkness'] },
]

const current = ref(0)
const preview = ref(0)
const mode = ref<'live' | 'black' | 'clear' | 'logo' | 'freeze'>('live')
const stageMessage = ref('')
const currentCue = computed(() => cues[current.value]!)
const previewCue = computed(() => cues[preview.value]!)
const nextCue = computed(() => cues[Math.min(cues.length - 1, current.value + 1)]!)
const isLive = computed(() => mode.value === 'live')

function next(): void {
  current.value = Math.min(cues.length - 1, current.value + 1)
  preview.value = current.value
}
function prev(): void {
  current.value = Math.max(0, current.value - 1)
  preview.value = current.value
}
function take(): void {
  current.value = preview.value
  mode.value = 'live'
}
function goTo(index: number): void {
  preview.value = index
}
function onKey(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  switch (event.key) {
    case 'ArrowRight':
    case ' ':
      event.preventDefault()
      next()
      break
    case 'ArrowLeft':
      prev()
      break
    case 'Enter':
      take()
      break
    case 'b':
    case 'B':
      mode.value = 'black'
      break
    case 'c':
    case 'C':
      mode.value = 'clear'
      break
    case 'l':
    case 'L':
      mode.value = 'logo'
      break
    case 'f':
    case 'F':
      mode.value = mode.value === 'freeze' ? 'live' : 'freeze'
      break
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const root = css({ display: 'flex', h: 'full', minH: '0' })
const rail = css({ w: '[300px]', flexShrink: '0', display: 'flex', flexDirection: 'column', bg: 'bg.panel', borderRightWidth: '1px', borderColor: 'border.default' })
const railHead = css({ p: '3', borderBottomWidth: '1px', borderColor: 'border.default' })
const railEyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const railTitle = css({ textStyle: 'ui.title', color: 'fg.default' })
const railMeta = css({ textStyle: 'ui.xs', color: 'fg.subtle', mt: '1' })
const railList = css({ flex: '1', minH: '0', overflowY: 'auto', p: '2', display: 'flex', flexDirection: 'column', gap: '1' })
const cue = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2.5',
  px: '2',
  py: '2',
  borderRadius: 'sm',
  cursor: 'pointer',
  color: 'fg.muted',
  borderLeftWidth: '2px',
  borderColor: 'transparent',
  _hover: { bg: 'bg.hover', color: 'fg.default' },
})
const cueActive = css({ bg: 'bg.subtle', color: 'fg.default', borderColor: 'accent.default' })
const cueLive = css({ bg: 'live.muted', color: 'fg.default', borderColor: 'live.default' })
const cueIndex = css({ w: '5', textStyle: 'ui.mono', color: 'fg.subtle', flexShrink: '0' })
const cueLabel = css({ flex: '1', textStyle: 'ui.sm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const center = css({ flex: '1', minW: '0', display: 'flex', flexDirection: 'column', minH: '0', bg: 'bg.canvas' })
const centerHead = css({ display: 'flex', alignItems: 'center', gap: '2', h: 'toolbar', px: '4', flexShrink: '0', borderBottomWidth: '1px', borderColor: 'border.default' })
const livePill = css({ display: 'inline-flex', alignItems: 'center', gap: '1.5', h: 'control.sm', px: '2', borderRadius: 'full', bg: 'live.muted', color: 'live.default', textStyle: 'ui.xs', fontWeight: 'semibold' })
const stage = css({ display: 'flex', gap: '3', p: '4', flex: '1', minH: '0' })
const pane = css({ flex: '1', minW: '0', display: 'flex', flexDirection: 'column', gap: '2' })
const paneLabel = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textStyle: 'ui.label', color: 'fg.muted', textTransform: 'uppercase' })
const slide = css({ position: 'relative', aspectRatio: 'video', borderRadius: 'md', overflow: 'hidden', borderWidth: '1px', borderColor: 'border.default', display: 'grid', placeItems: 'center', p: '8', textAlign: 'center' })
const liveSlide = css({ borderColor: 'live.default' })
const slideText = css({ display: 'flex', flexDirection: 'column', gap: '2', textStyle: 'display.md', color: 'ink.0', textShadow: '[0_2px_18px_rgba(0,0,0,0.5)]' })
const slideLine = css({ lineHeight: '[1.15]' })
const nextStrip = css({ display: 'flex', gap: '2', p: '4', pt: '0' })
const nextCard = css({ flex: '1', aspectRatio: 'video', maxW: '[180px]', borderRadius: 'sm', borderWidth: '1px', borderColor: 'border.default', display: 'grid', placeItems: 'center', p: '2', textStyle: 'ui.xs', color: 'fg.muted', bg: 'bg.panel' })
const controls = css({ display: 'flex', alignItems: 'center', gap: '2', p: '3', borderTopWidth: '1px', borderColor: 'border.default', bg: 'bg.panel', flexShrink: '0' })
const inspector = css({ w: 'inspector', flexShrink: '0', bg: 'bg.panel', borderLeftWidth: '1px', borderColor: 'border.default', p: '4', overflowY: 'auto' })
const sectionTitle = css({ textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase', mb: '2', mt: '4', _first: { mt: '0' } })
const fieldLabel = css({ textStyle: 'ui.sm', color: 'fg.muted', mb: '1.5' })
const timer = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: '3', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default', mb: '2' })
const timerValue = css({ textStyle: 'ui.mono', fontSize: '[18px]', color: 'fg.default' })
const shortcut = css({ display: 'flex', justifyContent: 'space-between', py: '1.5', textStyle: 'ui.xs', color: 'fg.muted' })
const kbd = css({ px: '1.5', py: '0.5', borderRadius: 'xs', bg: 'bg.subtle', color: 'fg.default', textStyle: 'ui.mono' })
const gradient = css({ background: '[token(gradients.ember)]' })
const gradientTwo = css({ background: '[token(gradients.graphite)]' })
</script>

<template>
  <div :class="root">
    <aside :class="rail" aria-label="Service playlist">
      <div :class="railHead">
        <p :class="railEyebrow">Sunday Gathering</p>
        <h1 :class="railTitle">10:30 service</h1>
        <p :class="railMeta">5 cues · 42 minutes</p>
      </div>
      <div :class="railList">
        <button
          v-for="(item, index) in cues"
          :key="item.id"
          type="button"
          :class="[cue, index === current ? cueLive : index === preview ? cueActive : '']"
          @click="goTo(index)"
        >
          <span :class="cueIndex">{{ String(index + 1).padStart(2, '0') }}</span>
          <Icon :name="item.kind === 'song' ? 'lucide:music' : 'lucide:presentation'" :size="14" />
          <span :class="cueLabel">{{ item.label }}</span>
          <Icon v-if="index === current" name="lucide:radio" :size="12" />
        </button>
      </div>
    </aside>

    <section :class="center">
      <div :class="centerHead">
        <span :class="livePill"><span :class="css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: 'live.default' })" />{{ mode.toUpperCase() }}</span>
        <span :class="css({ textStyle: 'ui.sm', color: 'fg.muted' })">Audience · Stage Left · 1920×1080</span>
        <span :class="css({ flex: '1' })" />
        <Button variant="secondary" size="sm" icon="lucide:monitor">Displays</Button>
        <Button variant="ghost" size="sm" icon="lucide:settings-2">Output</Button>
      </div>

      <div :class="stage">
        <div :class="pane">
          <p :class="paneLabel">Preview <span>{{ previewCue.label }}</span></p>
          <div :class="[slide, gradientTwo]">
            <div :class="slideText">
              <span v-for="line in previewCue.lines" :key="line" :class="slideLine">{{ line }}</span>
            </div>
          </div>
        </div>
        <div :class="pane">
          <p :class="paneLabel">Live <span>{{ currentCue.label }}</span></p>
          <div :class="[slide, liveSlide, gradient]">
            <div v-if="isLive" :class="slideText">
              <span v-for="line in currentCue.lines" :key="line" :class="slideLine">{{ line }}</span>
            </div>
            <div v-else :class="css({ textStyle: 'display.lg', color: 'fg.muted', textTransform: 'uppercase', letterSpacing: 'widest' })">{{ mode }}</div>
          </div>
        </div>
      </div>

      <div :class="nextStrip">
        <div :class="nextCard">
          <span>Next · {{ nextCue.label }}</span>
        </div>
        <div :class="nextCard">
          <span>Stage · notes ready</span>
        </div>
      </div>

      <div :class="controls">
        <Button variant="secondary" size="md" icon="lucide:skip-back" @click="prev">Previous</Button>
        <Button variant="primary" size="md" icon="lucide:skip-forward" @click="next">Next slide</Button>
        <Button variant="secondary" size="md" icon="lucide:arrow-up-right" @click="take">Take</Button>
        <span :class="css({ flex: '1' })" />
        <IconButton icon="lucide:square" label="Black" :active="mode === 'black'" @click="mode = 'black'" />
        <IconButton icon="lucide:eraser" label="Clear" :active="mode === 'clear'" @click="mode = 'clear'" />
        <IconButton icon="lucide:badge" label="Logo" :active="mode === 'logo'" @click="mode = 'logo'" />
        <IconButton icon="lucide:pause" label="Freeze" :active="mode === 'freeze'" @click="mode = mode === 'freeze' ? 'live' : 'freeze'" />
        <Button variant="danger" size="md" icon="lucide:radio" @click="mode = 'live'">Live</Button>
      </div>
    </section>

    <aside :class="inspector" aria-label="Live inspector">
      <h2 :class="sectionTitle">Stage message</h2>
      <p :class="fieldLabel">Shown on the confidence monitor</p>
      <Input v-model="stageMessage" placeholder="Chorus in 2 · mic 3" size="md" />

      <h2 :class="sectionTitle">Timers</h2>
      <div :class="timer">
        <div>
          <p :class="css({ textStyle: 'ui.xs', color: 'fg.subtle' })">Service countdown</p>
          <p :class="timerValue">04:32</p>
        </div>
        <Button variant="ghost" size="sm" icon="lucide:play">Start</Button>
      </div>
      <div :class="timer">
        <div>
          <p :class="css({ textStyle: 'ui.xs', color: 'fg.subtle' })">Elapsed</p>
          <p :class="timerValue">26:08</p>
        </div>
        <Button variant="ghost" size="sm" icon="lucide:pause">Pause</Button>
      </div>

      <h2 :class="sectionTitle">Keyboard</h2>
      <div :class="shortcut"><span>Next slide</span><span :class="kbd">Space</span></div>
      <div :class="shortcut"><span>Previous</span><span :class="kbd">←</span></div>
      <div :class="shortcut"><span>Take preview</span><span :class="kbd">Enter</span></div>
      <div :class="shortcut"><span>Black</span><span :class="kbd">B</span></div>
      <div :class="shortcut"><span>Clear</span><span :class="kbd">C</span></div>
      <div :class="shortcut"><span>Logo</span><span :class="kbd">L</span></div>
      <div :class="shortcut"><span>Freeze</span><span :class="kbd">F</span></div>
    </aside>
  </div>
</template>
