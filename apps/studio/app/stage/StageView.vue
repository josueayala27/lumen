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
const session = useStageSession({
  playlistId: (route.query.playlist as string | undefined) ?? undefined,
  presentationId: (route.query.presentation as string | undefined) ?? undefined,
})

const now = ref(Date.now())
const clock = computed(() => formatClock(now.value))
const timers = computed(() => timerViews(session.timers.value, now.value))

const currentDoc = computed(() => session.current.value?.item.doc ?? null)
const currentIndex = computed(() => session.current.value?.slideIndex ?? 0)
const currentKey = computed(() => {
  const value = session.current.value
  return value ? `${value.item.id}:${value.slideIndex}` : ''
})
const nextDoc = computed(() => session.next.value?.item.doc ?? null)
const nextIndex = computed(() => session.next.value?.slideIndex ?? 0)
const nextKey = computed(() => {
  const value = session.next.value
  return value ? `${value.item.id}:${value.slideIndex}` : ''
})

const currentRender = useStageRender(currentDoc, currentIndex, currentKey)
const nextRender = useStageRender(nextDoc, nextIndex, nextKey)
const safeAreaStyle = computed(() => ({ inset: safeAreaPercent(session.safeArea.value) }))

const emptyLabel = computed(() => (session.hasSession.value ? 'No slide' : 'Waiting for a live session'))

let clockTimer: ReturnType<typeof setInterval> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined

function onStorage(event: StorageEvent): void {
  if (event.key === LIVE_SESSION_LOCAL_KEY || event.key === null) void session.refresh()
}

onMounted(() => {
  void session.refresh()
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  refreshTimer = setInterval(() => void session.refresh(), 500)
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
const header = css({
  display: 'flex',
  alignItems: 'center',
  gap: '4',
  flexShrink: '0',
})
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
const body = css({ display: 'grid', gridTemplateColumns: '[minmax(0,2fr)_minmax(0,1fr)]', gap: '4', flex: '1', minH: '0' })
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
const notesText = css({ textStyle: 'ui.md', color: 'fg.default', lineHeight: 'relaxed', whiteSpace: 'pre-wrap', overflowY: 'auto' })
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
const timerValue = css({ textStyle: 'display.md', color: 'fg.default', fontVariantNumeric: 'tabular-nums' })
const timerRunning = css({ color: 'live.default' })
const errorText = css({ textStyle: 'ui.xs', color: 'danger.default' })
const footer = css({ display: 'flex', alignItems: 'center', gap: '3', flexShrink: '0' })
const footerText = css({ textStyle: 'ui.xs', color: 'fg.subtle', flex: '1' })
</script>

<template>
  <div :class="root">
    <header :class="header">
      <span :class="modePill"><span :class="css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: 'live.default' })" />{{ session.mode.value.toUpperCase() }}</span>
      <p :class="[message, !session.stageMessage.value ? messageEmpty : '']">
        {{ session.stageMessage.value || 'No stage message' }}
      </p>
      <time :class="clockStyle">{{ clock }}</time>
    </header>

    <p v-if="session.error.value" :class="errorText">{{ session.error.value }}</p>

    <div :class="body">
      <div :class="column">
        <section :class="[panel, panelGrow]">
          <p :class="panelLabel">
            <span>Current</span>
            <span>{{ session.current.value?.item.label }} · {{ session.current.value?.slide.label ?? '—' }}</span>
          </p>
          <div :class="frame">
            <img v-if="currentRender.image.value" :class="frameImage" :src="currentRender.image.value" alt="" />
            <div v-else-if="session.current.value" :class="slideText">
              <span v-for="(line, index) in session.current.value.slide.lines" :key="index">{{ line }}</span>
            </div>
            <p v-else :class="placeholder">{{ emptyLabel }}</p>
            <span :class="safeMarker" :style="safeAreaStyle" aria-hidden="true" />
          </div>
          <p v-if="currentRender.error.value" :class="errorText">{{ currentRender.error.value }}</p>
        </section>
      </div>

      <div :class="column">
        <section :class="panel">
          <p :class="panelLabel">
            <span>Next</span>
            <span>{{ session.next.value?.item.label ?? 'End' }}</span>
          </p>
          <div :class="frame">
            <img v-if="nextRender.image.value" :class="frameImage" :src="nextRender.image.value" alt="" />
            <div v-else-if="session.next.value" :class="[slideText, nextText]">
              <span v-for="(line, index) in session.next.value.slide.lines" :key="index">{{ line }}</span>
            </div>
            <p v-else :class="placeholder">End of playlist</p>
          </div>
        </section>

        <section :class="[panel, panelGrow]">
          <p :class="panelLabel"><span>Notes</span><Icon name="lucide:notebook-pen" :size="14" /></p>
          <p v-if="session.current.value?.slide.notes" :class="notesText">{{ session.current.value.slide.notes }}</p>
          <p v-else :class="placeholder">No notes for this slide</p>
        </section>
      </div>
    </div>

    <footer :class="footer">
      <div :class="timersRow">
        <div v-for="timer in timers" :key="timer.id" :class="timerCard">
          <span :class="timerLabel">{{ timer.label }}</span>
          <span :class="[timerValue, timer.running ? timerRunning : '']">{{ timer.value }}</span>
        </div>
        <p v-if="timers.length === 0" :class="footerText">No timers</p>
      </div>
      <p :class="footerText">Stage · safe area {{ safeAreaPercent(session.safeArea.value) }}</p>
    </footer>
  </div>
</template>
