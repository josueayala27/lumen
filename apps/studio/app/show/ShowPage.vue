<script setup lang="ts">
import { css, cx } from 'styled-system/css'
import type { Composition, OutputMode } from '@lumen/schema'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useShowControl } from '~/control/useShowControl'
import ErrorNotice from '~/library/ErrorNotice.vue'
import TimelinePanel from '~/live/TimelinePanel.vue'
import { liveTimerViews } from '~/live/liveTimers'
import { useShowTimeline } from '~/live/useShowTimeline'
import { isTauri } from '~/output/api'
import { Badge, Button, IconButton, Input, Kbd, PanelSection } from '~/ui'
import ClipGrid from './ClipGrid.vue'
import CompositionMonitor from './CompositionMonitor.vue'
import RundownPanel from './RundownPanel.vue'
import ScreensPanel from './ScreensPanel.vue'
import { contentLayerId, cueTransition, showKeyAction } from './showLive'
import { useShowDocument } from './useShowDocument'
import { useShowLive } from './useShowLive'
import { useShowOutput } from './useShowOutput'

/**
 * The operator's view while live (doc 11 § Show workspace): rundown, preview
 * and program, clip grid, screens, timeline transport. Rundown slides drive the
 * content layer; outputs go per screen through the v2 path.
 */
const route = useRoute()
const router = useRouter()
const showDocument = useShowDocument()
const show = showDocument.show
const live = useShowLive()
const session = live.session
const state = session.state
const mode = live.mode
const desktop = isTauri()
const error = ref('')
const stageError = ref('')
const pickerOpen = ref(false)

const isLive = computed(() => mode.value === 'live')
const stageMessage = computed({
  get: () => state.value.stageMessage,
  set: (value: string) => session.setStageMessage(value),
})
const hasContentLayer = computed(() => contentLayerId(show.value.composition) !== null)

function cueLabel(cue: { itemId: string; label: string } | null): string {
  if (!cue) return '—'
  const item = session.items.value.find((entry) => entry.id === cue.itemId)
  return item && session.items.value.length > 1 ? `${item.label} · ${cue.label}` : cue.label
}

// Monitors show the whole canvas through the compositor. Program holds its
// frame while frozen, like the outputs; black and logo black it out.
const programComposition = shallowRef<Composition | null>(null)
const previewComposition = shallowRef<Composition | null>(null)
watch(
  () => [show.value, live.version.value] as const,
  () => {
    previewComposition.value = live.frameComposition('preview')
    if (mode.value !== 'freeze' || !programComposition.value) programComposition.value = live.frameComposition('program')
  },
  { immediate: true },
)
const previewCanvas = computed(() => live.canvas('preview'))
const programCanvas = computed(() => live.canvas('program'))

// Outputs

const output = useShowOutput({
  show,
  composition: () => live.frameComposition('program'),
  nextComposition: () => (live.upNext.value ? live.frameComposition('next') : null),
  mode,
  cueKey: computed(() => live.programCue.value?.key ?? ''),
  transition: computed(() => cueTransition(live.programCue.value, session.theme.value)),
  version: () => live.version.value,
})
const openOutputs = computed(() => output.outputs.value.length)

// Control and timeline

const { timecode: showTimecode, lastCommand } = useShowControl((command) => session.dispatch(command))
const showTimeline = useShowTimeline({
  timecode: () => showTimecode.value,
  apply: (command) => session.dispatch(command),
  items: session.items,
  media: session.media,
})
watch(
  showTimeline.timelineTransform,
  (value) => {
    live.timelineTransform.value = value
  },
  { immediate: true },
)

const timecodeLabel = computed(() => {
  const value = showTimecode.value?.timecode
  if (!value) return ''
  const pad = (number: number) => String(number).padStart(2, '0')
  const separator = value.rate === '29.97df' ? ';' : ':'
  return `${pad(value.hours)}:${pad(value.minutes)}:${pad(value.seconds)}${separator}${pad(value.frames)}`
})

// Clock and timers

const now = ref(Date.now())
const clockLabel = computed(() => new Date(now.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
const timers = computed(() => liveTimerViews(state.value.timers, now.value))
const controlLabel = computed(() => {
  const last = lastCommand.value
  if (!last) return 'No control input yet'
  const seconds = Math.max(0, Math.round((now.value - last.at) / 1000))
  return `${last.source.toUpperCase()} · ${last.type} · ${seconds}s ago`
})
let clockTimer: ReturnType<typeof setInterval> | undefined

// Modes and keyboard

const modes: { mode: OutputMode; label: string; key: string }[] = [
  { mode: 'black', label: 'Black', key: 'B' },
  { mode: 'clear', label: 'Clear', key: 'C' },
  { mode: 'logo', label: 'Logo', key: 'L' },
  { mode: 'freeze', label: 'Freeze', key: 'F' },
]

function setMode(next: OutputMode): void {
  session.setMode(next === 'freeze' && mode.value === 'freeze' ? 'live' : next)
}

function onKey(event: KeyboardEvent): void {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
  if (target instanceof HTMLElement && target.isContentEditable) return
  // Open menus, lists and dialogs keep their own keys.
  if (target instanceof Element && target.closest('[role="listbox"], [role="option"], [role="menu"], [role="dialog"]')) return
  if (pickerOpen.value || event.metaKey || event.ctrlKey || event.altKey) return
  const action = showKeyAction(event.key, show.value.grid.columns)
  if (!action) return
  // Space and Enter drive the show even when a button has focus; no native click.
  event.preventDefault()
  switch (action.kind) {
    case 'next':
      return session.next()
    case 'prev':
      return session.prev()
    case 'take':
      return session.take()
    case 'nextItem':
      return session.nextItem()
    case 'prevItem':
      return session.prevItem()
    case 'mode':
      return session.setMode(action.mode)
    case 'toggleFreeze':
      return setMode('freeze')
    case 'launchColumn':
      return live.launchColumn(action.column)
    case 'clearClips':
      return live.clearClips()
  }
}

// Rundown

function queryId(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

async function selectRundown(playlistId: string): Promise<void> {
  await router.replace({ query: { rundown: playlistId } })
  await live.loadSession({ playlistId })
}

// Stage window

function stageUrl(): string {
  const params = new URLSearchParams()
  const playlistId = session.playlist.value?.id
  const presentationId = session.presentation.value?.id
  if (playlistId) params.set('playlist', playlistId)
  if (presentationId) params.set('presentation', presentationId)
  const query = params.toString()
  return query ? `/stage?${query}` : '/stage'
}

async function openStage(): Promise<void> {
  stageError.value = ''
  const url = stageUrl()
  if (!desktop) {
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
      // A normal window the operator can move and close; the stage view has its own
      // fullscreen toggle (F) for a monitor in front of the performers.
      decorations: true,
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

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  try {
    await Promise.all([
      showDocument.load(),
      live.loadSession({
        playlistId: queryId(route.query.rundown) ?? queryId(route.query.playlist),
        presentationId: queryId(route.query.presentation),
      }),
      output.ensureLoaded(),
    ])
    await live.ensureGridDocs()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (clockTimer) clearInterval(clockTimer)
  live.timelineTransform.value = null
})

const root = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', bg: 'bg.canvas' })
const toolbar = css({ display: 'flex', alignItems: 'center', gap: '2', h: 'toolbar', px: '3', flexShrink: '0', bg: 'bg.panel', borderBottomWidth: '1px', borderColor: 'border.default' })
const showName = css({ textStyle: 'ui.title', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxW: '[220px]' })
const mono = css({ textStyle: 'ui.mono', color: 'fg.muted', fontVariantNumeric: 'tabular-nums' })
const divider = css({ w: '[1px]', h: '5', bg: 'border.default', mx: '1' })
const pill = css({ display: 'inline-flex', alignItems: 'center', gap: '1.5', h: 'control.sm', px: '2', borderRadius: 'full', bg: 'live.muted', color: 'live.default', textStyle: 'ui.xs', fontWeight: 'semibold' })
const pillOff = css({ bg: 'bg.subtle', color: 'fg.muted' })
const body = css({ flex: '1', minH: '0', display: 'flex' })
const left = css({ w: '[280px]', flexShrink: '0', bg: 'bg.panel', borderRightWidth: '1px', borderColor: 'border.default', minH: '0' })
const center = css({ flex: '1', minW: '0', display: 'flex', flexDirection: 'column', minH: '0' })
const monitors = css({ display: 'grid', gridTemplateColumns: '[1fr 1fr]', gap: '3', px: '3', pt: '3', flexShrink: '0' })
const pane = css({ display: 'flex', flexDirection: 'column', gap: '1.5', minW: '0', maxW: '[calc(36vh * 16 / 9)]', w: 'full', justifySelf: 'center' })
const paneLabel = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2', textStyle: 'ui.label', color: 'fg.muted', textTransform: 'uppercase' })
const paneValue = css({ textTransform: 'none', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const programFrame = css({ borderWidth: '2px', borderColor: 'live.default', borderRadius: 'md', overflow: 'hidden' })
const previewFrame = css({ borderWidth: '2px', borderColor: 'border.default', borderRadius: 'md', overflow: 'hidden' })
const modeBadge = css({ position: 'absolute', top: '2', left: '2', px: '2', py: '0.5', borderRadius: 'sm', bg: '[rgba(0,0,0,0.6)]', color: '[#ffffff]', textStyle: 'ui.xs', textTransform: 'uppercase', letterSpacing: 'wider' })
const controls = css({ display: 'flex', alignItems: 'center', gap: '2', px: '3', py: '2', flexShrink: '0' })
const gridArea = css({ flex: '1', minH: '0', overflow: 'auto', px: '3', pb: '3' })
const right = css({ w: 'inspector', flexShrink: '0', bg: 'bg.panel', borderLeftWidth: '1px', borderColor: 'border.default', overflowY: 'auto' })
const transport = css({ display: 'flex', alignItems: 'flex-start', flexShrink: '0', bg: 'bg.panel', borderTopWidth: '1px', borderColor: 'border.default', maxH: '[45vh]', overflowY: 'auto' })
const transportTimeline = css({ w: '[360px]', flexShrink: '0', borderRightWidth: '1px', borderColor: 'border.default' })
const status = css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3', px: '3', h: 'control.lg', textStyle: 'ui.xs', color: 'fg.muted' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const fieldLabel = css({ textStyle: 'ui.sm', color: 'fg.muted', mb: '1.5' })
const timer = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: '3', py: '2', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default' })
const timerValue = css({ textStyle: 'ui.mono', fontSize: '[18px]', color: 'fg.default' })
const shortcutGrid = css({ display: 'grid', gridTemplateColumns: '[1fr 1fr]', columnGap: '3', rowGap: '1' })
const shortcut = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2', textStyle: 'ui.xs', color: 'fg.muted' })
</script>

<template>
  <div :class="root">
    <header :class="toolbar" aria-label="Show toolbar">
      <h1 :class="showName">{{ show.name }}</h1>
      <span :class="divider" />
      <span :class="mono" aria-label="Clock">{{ clockLabel }}</span>
      <span v-if="timecodeLabel" :class="mono" aria-label="Timecode">
        {{ timecodeLabel }}<template v-if="!showTimecode?.locked"> · no lock</template>
      </span>
      <span :class="divider" />
      <span :class="cx(pill, !isLive && pillOff)">
        <span :class="css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: isLive ? 'live.default' : 'fg.subtle' })" />
        {{ isLive ? 'ON AIR' : mode.toUpperCase() }}
      </span>
      <Button :variant="isLive ? 'secondary' : 'danger'" size="sm" icon="lucide:radio" :disabled="isLive" @click="session.setMode('live')">
        {{ isLive ? 'Live' : 'Go live' }}
      </Button>
      <Button
        v-for="entry in modes"
        :key="entry.mode"
        size="sm"
        :variant="mode === entry.mode ? 'primary' : 'ghost'"
        :aria-pressed="mode === entry.mode"
        :title="`${entry.label} (${entry.key})`"
        @click="setMode(entry.mode)"
      >
        {{ entry.label }}
      </Button>
      <span :class="css({ flex: '1' })" />
      <Button variant="ghost" size="sm" icon="lucide:presentation" @click="openStage">Stage</Button>
      <Button v-if="openOutputs > 0" variant="secondary" size="sm" icon="lucide:monitor-off" :disabled="!desktop" @click="output.closeAll">
        Stop outputs
      </Button>
      <Button variant="primary" size="sm" icon="lucide:monitor-play" :disabled="!desktop" :title="desktop ? undefined : 'Outputs open in the desktop app'" @click="output.openAll">
        Open outputs
      </Button>
    </header>

    <ErrorNotice v-if="error" :message="error" />
    <ErrorNotice v-if="session.error.value" :message="session.error.value" />
    <ErrorNotice v-if="showDocument.error.value" :message="showDocument.error.value" />
    <ErrorNotice v-if="output.error.value" :message="output.error.value" />
    <ErrorNotice v-if="stageError" :message="stageError" />

    <div :class="body">
      <aside :class="left">
        <RundownPanel @select="selectRundown" />
      </aside>

      <section :class="center">
        <div :class="monitors">
          <div :class="pane">
            <p :class="paneLabel">Preview <span :class="paneValue">{{ cueLabel(live.previewCue.value) }}</span></p>
            <div :class="previewFrame">
              <CompositionMonitor :composition="previewComposition" :screen="previewCanvas" label="Preview" />
            </div>
          </div>
          <div :class="pane">
            <p :class="paneLabel">Program <span :class="paneValue">{{ cueLabel(live.programCue.value) }}</span></p>
            <div :class="programFrame">
              <CompositionMonitor :composition="programComposition" :screen="programCanvas" label="Program">
                <span v-if="!isLive" :class="modeBadge">{{ mode }}</span>
              </CompositionMonitor>
            </div>
          </div>
        </div>

        <div :class="controls">
          <Button variant="secondary" size="md" icon="lucide:skip-back" :disabled="session.items.value.length === 0" @click="session.prev">Previous</Button>
          <Button variant="primary" size="md" icon="lucide:skip-forward" :disabled="session.items.value.length === 0" @click="session.next">Next</Button>
          <Button variant="secondary" size="md" icon="lucide:arrow-up-right" :disabled="session.items.value.length === 0" @click="session.take">Take</Button>
          <IconButton icon="lucide:chevrons-left" label="Previous item" :disabled="session.items.value.length === 0" @click="session.prevItem" />
          <IconButton icon="lucide:chevrons-right" label="Next item" :disabled="session.items.value.length === 0" @click="session.nextItem" />
          <span :class="css({ flex: '1' })" />
          <span :class="hint">Next · {{ cueLabel(live.upNext.value) }}</span>
          <span v-if="!hasContentLayer" :class="hint">Tag a layer content or lyrics in Compose to show rundown slides.</span>
        </div>

        <div :class="gridArea">
          <ClipGrid v-model:picker-open="pickerOpen" />
        </div>
      </section>

      <aside :class="right" aria-label="Screens and cues">
        <PanelSection title="Screens" collapsible storage-key="show.screens" flush>
          <template #actions>
            <Badge v-if="openOutputs > 0" tone="success" dot :label="`${openOutputs} open`" />
          </template>
          <ScreensPanel :errors="output.screenErrors.value" />
        </PanelSection>

        <PanelSection title="Stage message" collapsible storage-key="show.stageMessage">
          <p :class="fieldLabel">Shown on the confidence monitor</p>
          <Input v-model="stageMessage" placeholder="Chorus in 2 · mic 3" size="md" aria-label="Stage message" />
        </PanelSection>

        <PanelSection title="Timers" collapsible storage-key="show.timers">
          <template #actions>
            <Badge v-if="timers.some((entry) => entry.running)" tone="success" dot label="Running" />
          </template>
          <p v-if="timers.length === 0" :class="hint">No timers configured.</p>
          <div v-for="entry in timers" :key="entry.id" :class="timer">
            <div>
              <p :class="hint">{{ entry.label }}</p>
              <p :class="timerValue">{{ entry.value }}</p>
            </div>
            <div :class="css({ display: 'flex', alignItems: 'center', gap: '1' })">
              <Button v-if="!entry.running" variant="ghost" size="sm" icon="lucide:play" @click="session.startTimer(entry.id)">Start</Button>
              <Button v-else variant="ghost" size="sm" icon="lucide:pause" @click="session.pauseTimer(entry.id)">Pause</Button>
              <IconButton icon="lucide:rotate-ccw" label="Reset timer" @click="session.resetTimer(entry.id)" />
            </div>
          </div>
        </PanelSection>

        <PanelSection title="Keyboard" collapsible :default-open="false" storage-key="show.keyboard" flush>
          <div :class="shortcutGrid">
            <div :class="shortcut"><span>Next</span><Kbd shortcut="Space" /></div>
            <div :class="shortcut"><span>Previous</span><Kbd shortcut="Left" /></div>
            <div :class="shortcut"><span>Take</span><Kbd shortcut="Enter" /></div>
            <div :class="shortcut"><span>Freeze</span><Kbd shortcut="F" /></div>
            <div :class="shortcut"><span>Prev item</span><Kbd shortcut="[" /></div>
            <div :class="shortcut"><span>Next item</span><Kbd shortcut="]" /></div>
            <div :class="shortcut"><span>Black</span><Kbd shortcut="B" /></div>
            <div :class="shortcut"><span>Clear</span><Kbd shortcut="C" /></div>
            <div :class="shortcut"><span>Logo</span><Kbd shortcut="L" /></div>
            <div :class="shortcut"><span>Clear clips</span><Kbd shortcut="Escape" /></div>
            <div :class="shortcut"><span>Column</span><Kbd shortcut="1" /></div>
          </div>
        </PanelSection>
      </aside>
    </div>

    <footer :class="transport" aria-label="Transport">
      <div :class="transportTimeline">
        <TimelinePanel :timecode="showTimecode" :runner="showTimeline" />
      </div>
      <div :class="status">
        <span>Timecode: <span :class="mono">{{ timecodeLabel || '--:--:--:--' }}</span></span>
        <Badge
          :tone="showTimecode?.locked ? 'success' : 'neutral'"
          dot
          :label="showTimecode?.locked ? `${showTimecode.source?.toUpperCase() ?? 'TC'} locked` : 'No timecode lock'"
        />
        <span>Control: {{ controlLabel }}</span>
        <span>Outputs: {{ openOutputs }}</span>
      </div>
    </footer>
  </div>
</template>
