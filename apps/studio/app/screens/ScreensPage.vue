<script setup lang="ts">
import { css } from 'styled-system/css'
import { removeScreen } from '@lumen/core'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { IconButton, SegmentedControl, matchesShortcut, type SegmentOption } from '~/ui'
import { listMediaAssets, type MediaAsset } from '~/data/media'
import ErrorNotice from '~/library/ErrorNotice.vue'
import OutputPanel from '~/output/OutputPanel.vue'
import { useShowDocument } from '~/show/useShowDocument'
import ScreenCanvas from './ScreenCanvas.vue'
import ScreenInspector from './ScreenInspector.vue'
import ScreenList from './ScreenList.vue'
import ScreenOutputView from './ScreenOutputView.vue'
import { useScreenOutputs, useTestPatternOutputs } from './useScreenOutputs'

type View = 'canvas' | 'output'

const showDocument = useShowDocument()
const show = showDocument.show
const outputs = useScreenOutputs()
const media = shallowRef<MediaAsset[]>([])
const selectedId = ref<string | null>(null)
const view = ref<View>('canvas')
const error = ref('')

const selected = computed(() => show.value.screens.find((screen) => screen.id === selectedId.value) ?? null)
const viewOptions: SegmentOption<View>[] = [
  { value: 'canvas', label: 'Canvas', icon: 'lucide:layout-panel-left' },
  { value: 'output', label: 'Output', icon: 'lucide:scan' },
]

useTestPatternOutputs(show, media)

// Keep a valid selection: the first screen when nothing (or a removed screen) is selected.
watch(
  () => show.value.screens,
  (screens) => {
    if (!screens.some((screen) => screen.id === selectedId.value)) selectedId.value = screens[0]?.id ?? null
  },
  { immediate: true },
)

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try {
    const [, assets] = await Promise.all([showDocument.load(), listMediaAssets().catch(() => [] as MediaAsset[]), outputs.ensureLoaded()])
    media.value = assets
  } catch (reason) {
    error.value = message(reason)
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.closest('[role="dialog"], [role="listbox"], [role="menu"]') !== null
}

function removeSelected(): void {
  const screen = selected.value
  if (!screen) return
  const index = show.value.screens.indexOf(screen)
  showDocument.update((value) => removeScreen(value, screen.id))
  const screens = show.value.screens
  selectedId.value = screens[Math.min(index, screens.length - 1)]?.id ?? null
}

function onKey(event: KeyboardEvent): void {
  if (event.defaultPrevented || isEditable(event.target)) return
  if (matchesShortcut(event, 'Mod+Shift+Z') || matchesShortcut(event, 'Mod+Y')) {
    event.preventDefault()
    showDocument.redo()
    return
  }
  if (matchesShortcut(event, 'Mod+Z')) {
    event.preventDefault()
    showDocument.undo()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (!selected.value) return
    event.preventDefault()
    removeSelected()
  }
}

const page = css({
  display: 'grid',
  gridTemplateColumns: '[minmax(260px, 300px) minmax(0, 1fr) minmax(300px, 340px)]',
  h: 'full',
  minH: '0',
  bg: 'bg.canvas',
})
const left = css({ display: 'flex', flexDirection: 'column', minH: '0', borderRightWidth: '1px', borderColor: 'border.default', bg: 'bg.panel', overflowY: 'auto' })
const monitors = css({ p: '2', borderTopWidth: '1px', borderColor: 'border.default' })
const centre = css({ display: 'flex', flexDirection: 'column', minW: '0', minH: '0', overflow: 'hidden' })
const toolbar = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  h: '[44px]',
  px: '3',
  borderBottomWidth: '1px',
  borderColor: 'border.default',
  bg: 'bg.panel',
  flexShrink: '0',
})
const title = css({ textStyle: 'ui.sm', color: 'fg.default', fontWeight: 'semibold', mr: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const segment = css({ w: '[200px]', flexShrink: '0' })
const body = css({ flex: '1', minH: '0', display: 'flex', flexDirection: 'column' })
const right = css({ minH: '0', overflowY: 'auto', borderLeftWidth: '1px', borderColor: 'border.default', bg: 'bg.panel' })
const notice = css({ px: '3', pt: '2' })
</script>

<template>
  <div :class="page">
    <aside :class="left" aria-label="Screens">
      <ScreenList :selected-id="selectedId" @select="selectedId = $event" />
      <div :class="monitors">
        <OutputPanel />
      </div>
    </aside>

    <section :class="centre" aria-label="Screen canvas">
      <div :class="toolbar">
        <h1 :class="title">{{ view === 'output' && selected ? selected.name || 'Screen' : 'Screens' }}</h1>
        <IconButton icon="lucide:undo-2" label="Undo" shortcut="Mod+Z" size="sm" :disabled="!showDocument.canUndo.value" @click="showDocument.undo()" />
        <IconButton icon="lucide:redo-2" label="Redo" shortcut="Mod+Shift+Z" size="sm" :disabled="!showDocument.canRedo.value" @click="showDocument.redo()" />
        <div :class="segment">
          <SegmentedControl v-model="view" :options="viewOptions" size="sm" aria-label="View" />
        </div>
      </div>
      <div v-if="error || showDocument.error.value" :class="notice">
        <ErrorNotice :message="error || showDocument.error.value" />
      </div>
      <div :class="body">
        <ScreenCanvas v-if="view === 'canvas'" :selected-id="selectedId" @select="selectedId = $event" />
        <ScreenOutputView v-else :screen="selected" :media="media" />
      </div>
    </section>

    <aside :class="right" aria-label="Screen inspector">
      <ScreenInspector :screen="selected" />
    </aside>
  </div>
</template>
