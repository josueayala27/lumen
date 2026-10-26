<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { Button, Dialog, IconButton, Input } from '~/ui'
import { useShowControl } from '~/control/useShowControl'
import { useOutputScreens } from '~/output/useOutputScreens'
import OutputPanel from '~/output/OutputPanel.vue'
import type { LiveCommand } from '@lumen/schema'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import TimelinePanel from './TimelinePanel.vue'
import { useLiveSession } from './useLiveSession'
import type { LiveItem } from './liveSession'
import { saveLiveSession } from './liveSessionStore'

const route = useRoute()
const {
  state,
  items,
  playlist,
  presentation,
  loading,
  error,
  currentItem,
  currentSlide,
  previewItem,
  previewSlide,
  nextSlide,
  slideCount,
  load,
  dispatch,
  next,
  prev,
  nextItem,
  prevItem,
  take,
  goTo,
  setMode,
  setStageMessage,
} = useLiveSession()

const mode = computed(() => state.value.mode)
const isLive = computed(() => mode.value === 'live')
const stageMessage = computed({
  get: () => state.value.stageMessage,
  set: (value: string) => setStageMessage(value),
})
const headerEyebrow = computed(() => {
  if (playlist.value) return 'Playlist'
  if (presentation.value?.kind === 'song') return 'Song'
  if (presentation.value) return 'Presentation'
  return 'Live'
})
const headerTitle = computed(
  () => playlist.value?.doc.name ?? presentation.value?.doc.title ?? 'No playlist',
)
const headerMeta = computed(() => {
  if (loading.value) return 'Loading…'
  if (playlist.value) {
    return `${items.value.length} items · ${slideCount.value} slides`
  }
  return `${slideCount.value} slides`
})
const previewLabel = computed(() => {
  const slide = previewSlide.value?.label ?? '—'
  return previewItem.value && items.value.length > 1
    ? `${previewItem.value.label} · ${slide}`
    : slide
})
const liveLabel = computed(() => {
  const slide = currentSlide.value?.label ?? '—'
  return currentItem.value && items.value.length > 1
    ? `${currentItem.value.label} · ${slide}`
    : slide
})
const nextItemLabel = computed(() => {
  const next = items.value[state.value.itemIndex + 1]
  if (!next) return 'End of playlist'
  return next.label
})
const emptyRail = computed(
  () => !loading.value && items.value.length === 0,
)
const stageError = ref('')
const screensOpen = ref(false)
const { audienceDisplay, audienceOnline, ensureLoaded: loadScreens, toggleAudience } = useOutputScreens()
const outputLabel = computed(() => {
  const display = audienceDisplay.value
  if (!display) return 'No output display'
  const state = audienceOnline.value ? 'Audience' : 'Audience off'
  return `${state} · ${display.name} · ${display.width}×${display.height}`
})

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function stageUrl(): string {
  const params = new URLSearchParams()
  const playlistId = playlist.value?.id ?? (route.query.playlist as string | undefined)
  const presentationId = presentation.value?.id ?? (route.query.presentation as string | undefined)
  if (playlistId) params.set('playlist', playlistId)
  if (presentationId) params.set('presentation', presentationId)
  const query = params.toString()
  return query ? `/stage?${query}` : '/stage'
}

async function openStage(): Promise<void> {
  stageError.value = ''
  const url = stageUrl()
  if (!isTauriRuntime()) {
    const popup = window.open(url, 'lumen-stage', 'popup,width=1280,height=800')
    if (!popup) stageError.value = 'Stage window was blocked by the browser.'
    return
  }
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const existing = await WebviewWindow.getByLabel('stage')
    if (existing) {
      await existing.show()
      await existing.setFocus()
      return
    }
    const stage = new WebviewWindow('stage', {
      url,
      title: 'Lumen Stage',
      width: 1280,
      height: 800,
      decorations: false,
      resizable: true,
      focus: true,
    })
    void stage.once('tauri://error', (event) => {
      stageError.value = `Stage window failed: ${String(event.payload)}`
    })
  } catch (reason) {
    stageError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function iconFor(item: LiveItem): string {
  if (item.kind === 'media') return 'lucide:film'
  if (item.kind === 'header') return 'lucide:heading'
  return item.presentationKind === 'song' ? 'lucide:music' : 'lucide:presentation'
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
    case ']':
      nextItem()
      break
    case '[':
      prevItem()
      break
    case 'b':
    case 'B':
      setMode('black')
      break
    case 'c':
    case 'C':
      setMode('clear')
      break
    case 'l':
    case 'L':
      setMode('logo')
      break
    case 'f':
    case 'F':
      setMode(mode.value === 'freeze' ? 'live' : 'freeze')
      break
  }
}
function applyLiveCommand(command: LiveCommand): void {
  dispatch(command)
}

const { timecode: showTimecode } = useShowControl(applyLiveCommand)
const timecodeLabel = computed(() => {
  const value = showTimecode.value?.timecode
  if (!value) return ''
  const pad = (number: number) => String(number).padStart(2, '0')
  const separator = value.rate === '29.97df' ? ';' : ':'
  return `${pad(value.hours)}:${pad(value.minutes)}:${pad(value.seconds)}${separator}${pad(value.frames)}`
})
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  void loadScreens()
  await load({
    playlistId: (route.query.playlist as string | undefined) ?? undefined,
    presentationId: (route.query.presentation as string | undefined) ?? undefined,
  })
  // Publish the restored position so a stage window opened later starts in sync.
  void saveLiveSession({
    playlistId: playlist.value?.id ?? null,
    presentationId: presentation.value?.id ?? null,
    state: state.value,
  })
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const root = css({ display: 'flex', h: 'full', minH: '0' })
const rail = css({ w: '[300px]', flexShrink: '0', display: 'flex', flexDirection: 'column', bg: 'bg.panel', borderRightWidth: '1px', borderColor: 'border.default' })
const railHead = css({ p: '3', borderBottomWidth: '1px', borderColor: 'border.default' })
const railEyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const railTitle = css({ textStyle: 'ui.title', color: 'fg.default' })
const railMeta = css({ textStyle: 'ui.xs', color: 'fg.subtle', mt: '1' })
const railList = css({ flex: '1', minH: '0', overflowY: 'auto', p: '2', display: 'flex', flexDirection: 'column', gap: '1' })
const cueGroup = css({ mt: '2', px: '2', py: '1', textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase', _first: { mt: '0' } })
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
const slideTextStyle = css({ display: 'flex', flexDirection: 'column', gap: '2', fontSize: '[clamp(16px, 1.6vw, 26px)]', fontWeight: 'semibold', lineHeight: '[1.15]', color: 'ink.0', textShadow: '[0_2px_18px_rgba(0,0,0,0.5)]', textAlign: 'center' })
const slideLine = css({ lineHeight: '[1.15]' })
const nextStrip = css({ display: 'flex', gap: '2', p: '4', pt: '0' })
const nextCard = css({ flex: '1', aspectRatio: 'video', maxW: '[180px]', borderRadius: 'sm', borderWidth: '1px', borderColor: 'border.default', display: 'grid', placeItems: 'center', p: '2', textStyle: 'ui.xs', color: 'fg.muted', bg: 'bg.panel', textAlign: 'center' })
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
const notice = css({ p: '3', textStyle: 'ui.xs', color: 'fg.subtle' })
const errorText = css({ px: '4', py: '2', textStyle: 'ui.sm', color: 'danger.default' })
</script>

<template>
  <div :class="root">
    <aside :class="rail" aria-label="Service playlist">
      <div :class="railHead">
        <p :class="railEyebrow">{{ headerEyebrow }}</p>
        <h1 :class="railTitle">{{ headerTitle }}</h1>
        <p :class="railMeta">{{ headerMeta }}</p>
      </div>
      <div :class="railList">
        <template v-for="(item, itemIndex) in items" :key="item.id">
          <p v-if="playlist" :class="cueGroup">{{ item.label }}</p>
          <button
            v-for="(itemSlide, slideIndex) in item.slides"
            :key="`${item.id}-${itemSlide.id}`"
            type="button"
            :class="[
              cue,
              state.itemIndex === itemIndex && state.slideIndex === slideIndex
                ? cueLive
                : state.previewItemIndex === itemIndex && state.previewSlideIndex === slideIndex
                  ? cueActive
                  : '',
            ]"
            @click="goTo(itemIndex, slideIndex)"
          >
            <span :class="cueIndex">{{ String(slideIndex + 1).padStart(2, '0') }}</span>
            <Icon :name="iconFor(item)" :size="14" />
            <span :class="cueLabel">{{ itemSlide.label }}</span>
            <Icon v-if="state.itemIndex === itemIndex && state.slideIndex === slideIndex" name="lucide:radio" :size="12" />
          </button>
        </template>
        <p v-if="emptyRail" :class="notice">
          Create a playlist to go live.
        </p>
      </div>
    </aside>

    <section :class="center">
      <div :class="centerHead">
        <span :class="livePill"><span :class="css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: 'live.default' })" />{{ mode.toUpperCase() }}</span>
        <span :class="css({ textStyle: 'ui.sm', color: 'fg.muted' })">{{ outputLabel }}</span>
        <span v-if="timecodeLabel" :class="css({ textStyle: 'ui.mono', color: 'fg.muted' })">
          {{ timecodeLabel }}<template v-if="!showTimecode?.locked"> · no lock</template>
        </span>
        <span :class="css({ flex: '1' })" />
        <Button variant="ghost" size="sm" icon="lucide:presentation" @click="openStage">Stage</Button>
        <Button variant="secondary" size="sm" icon="lucide:monitor" @click="screensOpen = true">Screens</Button>
        <Button
          variant="ghost"
          size="sm"
          :icon="audienceOnline ? 'lucide:square' : 'lucide:settings-2'"
          :disabled="!audienceDisplay"
          @click="toggleAudience"
        >
          {{ audienceOnline ? 'Stop output' : 'Output' }}
        </Button>
      </div>

      <p v-if="error" :class="errorText">{{ error }}</p>
      <p v-if="stageError" :class="errorText">{{ stageError }}</p>

      <div :class="stage">
        <div :class="pane">
          <p :class="paneLabel">Preview <span>{{ previewLabel }}</span></p>
          <div :class="[slide, gradientTwo]">
            <div :class="slideTextStyle">
              <span v-for="(line, lineIndex) in previewSlide?.lines ?? []" :key="lineIndex" :class="slideLine">{{ line }}</span>
            </div>
          </div>
        </div>
        <div :class="pane">
          <p :class="paneLabel">Live <span>{{ liveLabel }}</span></p>
          <div :class="[slide, liveSlide, gradient]">
            <div v-if="isLive" :class="slideTextStyle">
              <span v-for="(line, lineIndex) in currentSlide?.lines ?? []" :key="lineIndex" :class="slideLine">{{ line }}</span>
            </div>
            <div v-else :class="css({ textStyle: 'display.lg', color: 'fg.muted', textTransform: 'uppercase', letterSpacing: 'widest' })">{{ mode }}</div>
          </div>
        </div>
      </div>

      <div :class="nextStrip">
        <div :class="nextCard">
          <span>Next · {{ nextSlide?.label ?? '—' }}</span>
        </div>
        <div :class="nextCard">
          <span>Next item · {{ nextItemLabel }}</span>
        </div>
      </div>

      <div :class="controls">
        <Button variant="secondary" size="md" icon="lucide:skip-back" @click="prev">Previous</Button>
        <Button variant="primary" size="md" icon="lucide:skip-forward" @click="next">Next slide</Button>
        <Button variant="secondary" size="md" icon="lucide:arrow-up-right" @click="take">Take</Button>
        <span :class="css({ flex: '1' })" />
        <IconButton icon="lucide:chevrons-left" label="Previous item" @click="prevItem" />
        <IconButton icon="lucide:chevrons-right" label="Next item" @click="nextItem" />
        <IconButton icon="lucide:square" label="Black" :active="mode === 'black'" @click="setMode('black')" />
        <IconButton icon="lucide:eraser" label="Clear" :active="mode === 'clear'" @click="setMode('clear')" />
        <IconButton icon="lucide:badge" label="Logo" :active="mode === 'logo'" @click="setMode('logo')" />
        <IconButton icon="lucide:pause" label="Freeze" :active="mode === 'freeze'" @click="setMode(mode === 'freeze' ? 'live' : 'freeze')" />
        <Button variant="danger" size="md" icon="lucide:radio" @click="setMode('live')">Live</Button>
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

      <TimelinePanel :timecode="showTimecode" :apply="applyLiveCommand" />

      <h2 :class="sectionTitle">Keyboard</h2>
      <div :class="shortcut"><span>Next slide</span><span :class="kbd">Space</span></div>
      <div :class="shortcut"><span>Previous</span><span :class="kbd">←</span></div>
      <div :class="shortcut"><span>Take preview</span><span :class="kbd">Enter</span></div>
      <div :class="shortcut"><span>Previous item</span><span :class="kbd">[</span></div>
      <div :class="shortcut"><span>Next item</span><span :class="kbd">]</span></div>
      <div :class="shortcut"><span>Black</span><span :class="kbd">B</span></div>
      <div :class="shortcut"><span>Clear</span><span :class="kbd">C</span></div>
      <div :class="shortcut"><span>Logo</span><span :class="kbd">L</span></div>
      <div :class="shortcut"><span>Freeze</span><span :class="kbd">F</span></div>
    </aside>

    <Dialog
      v-model:open="screensOpen"
      title="Screens"
      description="Assign the audience output to a display and open or close native audience windows."
      size="lg"
    >
      <OutputPanel />
      <template #footer="{ close }">
        <Button variant="secondary" size="sm" @click="close">Done</Button>
      </template>
    </Dialog>
  </div>
</template>
