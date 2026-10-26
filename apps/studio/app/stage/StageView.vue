<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { LIVE_SESSION_LOCAL_KEY } from '~/live/liveSessionStore'
import { formatClock, safeAreaPercent, timerViews } from './stageModel'
import { useStageRender } from './useStageRender'
import { useStageSession } from './useStageSession'

const route = useRoute()
const {
  current,
  next,
  loading,
  error,
  stageMessage,
  timers: sessionTimers,
  mode,
  hasSession,
  safeArea,
  refresh,
} = useStageSession({
  playlistId: (route.query.playlist as string | undefined) ?? undefined,
  presentationId: (route.query.presentation as string | undefined) ?? undefined,
})

const now = ref(Date.now())
const clock = computed(() => formatClock(now.value))
const timers = computed(() => timerViews(sessionTimers.value, now.value))

const currentDoc = computed(() => current.value?.item.doc ?? null)
const currentIndex = computed(() => current.value?.slideIndex ?? 0)
const currentKey = computed(() => (current.value ? `${current.value.item.id}:${current.value.slideIndex}` : ''))
const nextDoc = computed(() => next.value?.item.doc ?? null)
const nextIndex = computed(() => next.value?.slideIndex ?? 0)
const nextKey = computed(() => (next.value ? `${next.value.item.id}:${next.value.slideIndex}` : ''))

const { image: currentImage, error: currentRenderError } = useStageRender(currentDoc, currentIndex, currentKey)
const { image: nextImage } = useStageRender(nextDoc, nextIndex, nextKey)
const safeAreaStyle = computed(() => ({ inset: safeAreaPercent(safeArea.value) }))
const emptyLabel = computed(() => {
  if (loading.value) return 'Loading live session…'
  return hasSession.value ? 'No slide' : 'Waiting for a live session'
})

let clockTimer: ReturnType<typeof setInterval> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined

function onStorage(event: StorageEvent): void {
  if (event.key === LIVE_SESSION_LOCAL_KEY || event.key === null) void refresh()
}

onMounted(() => {
  void refresh()
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  refreshTimer = setInterval(() => void refresh(), 500)
  window.addEventListener('storage', onStorage)
})

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (refreshTimer) clearInterval(refreshTimer)
  window.removeEventListener('storage', onStorage)
})

const root = css({
  display: 'flex',
  flexDirection: 'column',
  h: 'full',
  minH: '0',
  bg: 'bg.app',
  color: 'fg.default',
  p: '5',
  gap: '4',
})
const header = css({ display: 'flex', alignItems: 'center', gap: '4', flexShrink: '0' })
const message = css({
  flex: '1',
  minW: '0',
  px: '4',
  py: '3',
  borderRadius: 'md',
  bg: 'bg.panel',
  borderWidth: '1px',
  borderColor: 'border.default',
  textStyle: 'ui.title',
  color: 'fg.default',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
const messageEmpty = css({ color: 'fg.subtle' })
const clockStyle = css({ textStyle: 'display.lg', color: 'fg.muted', fontVariantNumeric: 'tabular-nums' })
const modePill = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1.5',
  h: 'control.sm',
  px: '3',
  borderRadius: 'full',
  bg: 'live.muted',
  color: 'live.default',
  textStyle: 'ui.xs',
  fontWeight: 'semibold',
})
const body = css({
  display: 'grid',
  gridTemplateColumns: '[minmax(0,2fr)_minmax(0,1fr)]',
  gap: '4',
  flex: '1',
  minH: '0',
})
const column = css({ display: 'flex', flexDirection: 'column', gap: '3', minH: '0' })
const panel = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  minH: '0',
  p: '3',
  borderRadius: 'md',
  bg: 'bg.panel',
  borderWidth: '1px',
  borderColor: 'border.default',
})
const panelGrow = css({ flex: '1', minH: '0' })
const panelLabel = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '2',
  textStyle: 'ui.label',
  color: 'fg.muted',
  textTransform: 'uppercase',
})
const frame = css({
  position: 'relative',
  aspectRatio: 'video',
  borderRadius: 'sm',
  overflow: 'hidden',
  borderWidth: '1px',
  borderColor: 'border.default',
  bg: '[#101014]',
  display: 'grid',
  placeItems: 'center',
})
const frameImage = css({ position: 'absolute', inset: '0', w: 'full', h: 'full', objectFit: 'cover' })
const safeMarker = css({
  position: 'absolute',
  borderWidth: '1px',
  borderStyle: 'dashed',
  borderColor: 'accent.default',
  borderRadius: 'xs',
  pointerEvents: 'none',
})
const slideText = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  p: '8',
  textAlign: 'center',
  fontSize: '[clamp(18px, 2.6vw, 48px)]',
  fontWeight: 'semibold',
  lineHeight: '[1.15]',
  color: 'fg.default',
})
const nextText = css({ fontSize: '[clamp(14px, 1.4vw, 22px)]', fontWeight: 'medium', lineHeight: '[1.2]' })
const notesText = css({
  textStyle: 'ui.md',
  color: 'fg.default',
  lineHeight: '[1.6]',
  whiteSpace: 'pre-wrap',
  overflowY: 'auto',
})
const placeholder = css({ textStyle: 'ui.sm', color: 'fg.subtle', p: '4', textAlign: 'center' })
const timersRow = css({ display: 'flex', gap: '3', flexShrink: '0', flexWrap: 'wrap' })
const timerCard = css({
  display: 'flex',
  alignItems: 'baseline',
  gap: '3',
  px: '4',
  py: '3',
  borderRadius: 'md',
  bg: 'bg.panel',
  borderWidth: '1px',
  borderColor: 'border.default',
})
const timerLabel = css({ textStyle: 'ui.xs', color: 'fg.subtle', textTransform: 'uppercase' })
const timerValueStyle = css({ textStyle: 'display.md', color: 'fg.default', fontVariantNumeric: 'tabular-nums' })
const timerRunning = css({ color: 'live.default' })
const errorText = css({ textStyle: 'ui.xs', color: 'danger.default' })
const footer = css({ display: 'flex', alignItems: 'center', gap: '3', flexShrink: '0' })
const footerText = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const footerSpacer = css({ flex: '1' })
</script>

<template>
  <div :class="root">
    <header :class="header">
      <span :class="modePill"><span :class="css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: 'live.default' })" />{{ mode.toUpperCase() }}</span>
      <p :class="[message, !stageMessage ? messageEmpty : '']">
        {{ stageMessage || 'No stage message' }}
      </p>
      <time :class="clockStyle">{{ clock }}</time>
    </header>

    <p v-if="error" :class="errorText">{{ error }}</p>

    <div :class="body">
      <div :class="column">
        <section :class="[panel, panelGrow]">
          <p :class="panelLabel">
            <span>Current</span>
            <span>{{ current?.item.label }} · {{ current?.slide.label ?? '—' }}</span>
          </p>
          <div :class="frame">
            <img v-if="currentImage" :class="frameImage" :src="currentImage" alt="" />
            <div v-else-if="current" :class="slideText">
              <span v-for="(line, index) in current.slide.lines" :key="index">{{ line }}</span>
            </div>
            <p v-else :class="[placeholder, loading ? '' : '']">{{ emptyLabel }}</p>
            <span :class="safeMarker" :style="safeAreaStyle" aria-hidden="true" />
          </div>
          <p v-if="currentRenderError" :class="errorText">{{ currentRenderError }}</p>
        </section>
      </div>

      <div :class="column">
        <section :class="panel">
          <p :class="panelLabel">
            <span>Next</span>
            <span>{{ next?.item.label ?? 'End' }}</span>
          </p>
          <div :class="frame">
            <img v-if="nextImage" :class="frameImage" :src="nextImage" alt="" />
            <div v-else-if="next" :class="[slideText, nextText]">
              <span v-for="(line, index) in next.slide.lines" :key="index">{{ line }}</span>
            </div>
            <p v-else :class="placeholder">End of playlist</p>
          </div>
        </section>

        <section :class="[panel, panelGrow]">
          <p :class="panelLabel"><span>Notes</span><Icon name="lucide:notebook-pen" :size="14" /></p>
          <p v-if="current?.slide.notes" :class="notesText">{{ current.slide.notes }}</p>
          <p v-else :class="placeholder">No notes for this slide</p>
        </section>
      </div>
    </div>

    <footer :class="footer">
      <div :class="timersRow">
        <div v-for="timer in timers" :key="timer.id" :class="timerCard">
          <span :class="timerLabel">{{ timer.label }}</span>
          <span :class="[timerValueStyle, timer.running ? timerRunning : '']">{{ timer.value }}</span>
        </div>
        <p v-if="timers.length === 0" :class="footerText">No timers</p>
      </div>
      <span :class="footerSpacer" />
      <p :class="footerText">Stage · safe area {{ safeAreaPercent(safeArea) }}</p>
    </footer>
  </div>
</template>
