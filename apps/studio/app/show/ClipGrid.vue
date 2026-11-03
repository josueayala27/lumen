<script setup lang="ts">
import { css, cx } from 'styled-system/css'
import { Icon } from '#components'
import { slideText, updateCompositionLayer } from '@lumen/core'
import { computed, onMounted, ref } from 'vue'
import { listPresentations, type PresentationSummary } from '~/data/presentations'
import { Dialog, IconButton, Input, Slider } from '~/ui'
import { activeClips, assignClip, clipAt, removeShowClip, type ClipContent, type ShowClip } from './showModel'
import { contentLayerId } from './showLive'
import { useShowDocument } from './useShowDocument'
import { useShowLive } from './useShowLive'

/** Layers × columns. Clicking a filled cell launches it; an empty cell picks a clip. */
const pickerOpen = defineModel<boolean>('pickerOpen', { default: false })

const showDocument = useShowDocument()
const show = showDocument.show
const live = useShowLive()
const grid = live.grid
const media = live.session.media
const presentations = ref<PresentationSummary[]>([])

const columns = computed(() => Array.from({ length: show.value.grid.columns }, (_, index) => index))
const layers = computed(() => [...show.value.composition.layers].reverse())
const playing = computed(() => new Set(Object.values(grid.value.active).filter(Boolean)))
const contentLayer = computed(() => contentLayerId(show.value.composition))

onMounted(async () => {
  try {
    presentations.value = await listPresentations()
  } catch {
    presentations.value = []
  }
})

function setLayerOpacity(layerId: string, opacity: number): void {
  showDocument.updateComposition((composition) => updateCompositionLayer(composition, layerId, { opacity }), {
    coalesce: `opacity:${layerId}`,
  })
}

// Picker

const picking = ref<{ layerId: string; column: number } | null>(null)
const pickerQuery = ref('')
const pickerMedia = computed(() => {
  const needle = pickerQuery.value.trim().toLowerCase()
  return media.value.filter(
    (asset) => (asset.kind === 'image' || asset.kind === 'video') && asset.name.toLowerCase().includes(needle),
  )
})
const pickerDocs = computed(() => {
  const needle = pickerQuery.value.trim().toLowerCase()
  return presentations.value.filter((item) => item.title.toLowerCase().includes(needle))
})

function onCell(layerId: string, column: number): void {
  const clip = clipAt(show.value, layerId, column)
  if (clip) {
    live.launch(clip)
    return
  }
  pickerQuery.value = ''
  picking.value = { layerId, column }
  pickerOpen.value = true
}

function onPickerOpen(value: boolean): void {
  pickerOpen.value = value
  if (!value) picking.value = null
}

async function pick(content: ClipContent, label: string): Promise<void> {
  const target = picking.value
  if (!target) return
  onPickerOpen(false)
  if (content.kind === 'presentation') await live.ensureDoc(content.presentationId)
  showDocument.update((value) => assignClip(value, target.layerId, target.column, content, label))
}

function remove(clip: ShowClip): void {
  if (grid.value.active[clip.layerId] === clip.id) live.clearLayer(clip.layerId)
  showDocument.update((value) => removeShowClip(value, clip.id))
}

function clipIcon(clip: ShowClip): string {
  if (clip.content.kind === 'presentation') return 'lucide:music'
  if (clip.content.kind !== 'media') return 'lucide:layers'
  const { assetId } = clip.content
  return media.value.find((asset) => asset.id === assetId)?.kind === 'video' ? 'lucide:film' : 'lucide:image'
}

function clipMissing(clip: ShowClip): boolean {
  if (clip.content.kind === 'presentation') return !live.presentation(clip.content.presentationId)
  if (clip.content.kind !== 'media') return false
  const { assetId } = clip.content
  const asset = media.value.find((entry) => entry.id === assetId)
  return !asset || asset.missing
}

// Presentation clips on air step through their slides here.

const activeLyrics = computed(() =>
  activeClips(show.value, grid.value).filter((clip) => clip.content.kind === 'presentation'),
)

function slideCount(clip: ShowClip): number {
  return clip.content.kind === 'presentation' ? live.presentation(clip.content.presentationId)?.slides.length ?? 0 : 0
}

function lyricText(clip: ShowClip): string {
  if (clip.content.kind !== 'presentation') return ''
  const doc = live.presentation(clip.content.presentationId)
  const slide = doc?.slides[grid.value.slides[clip.id] ?? 0]
  return slide ? slideText(slide) : ''
}

const root = css({ display: 'flex', flexDirection: 'column', gap: '2', minH: '0' })
const head = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2' })
const title = css({ textStyle: 'ui.label', color: 'fg.muted', textTransform: 'uppercase' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const gridWrap = css({ overflow: 'auto', minH: '0' })
const gridStyle = css({ display: 'grid', gap: '1.5', minW: '[760px]' })
const headCell = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  h: 'control.sm',
  borderRadius: 'sm',
  textStyle: 'ui.xs',
  color: 'fg.muted',
  bg: 'bg.subtle',
  cursor: 'pointer',
  _hover: { bg: 'bg.hover', color: 'fg.default' },
})
const layerCell = css({ display: 'flex', flexDirection: 'column', gap: '1', p: '2', borderRadius: 'sm', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default' })
const layerHead = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1', textStyle: 'ui.sm', color: 'fg.default' })
const tag = css({ textStyle: 'ui.xs', color: 'accent.default' })
const cell = css({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: '1',
  minW: '0',
  minH: '[64px]',
  p: '2',
  borderRadius: 'sm',
  borderWidth: '1px',
  borderColor: 'border.default',
  bg: 'bg.panel',
  textAlign: 'left',
  cursor: 'pointer',
  _hover: { borderColor: 'border.strong', bg: 'bg.hover' },
})
const emptyCell = css({ borderStyle: 'dashed', bg: 'bg.canvas', color: 'fg.subtle', alignItems: 'center', justifyContent: 'center' })
const playingCell = css({ borderColor: 'success.default', boxShadow: '[inset 0 0 0 1px var(--colors-success-default)]' })
// The label truncates in its own span (a bare text node in a flex row cannot), and the
// icon keeps its size; the remove button sits in the footer so it never covers the label.
const cellLabel = css({ display: 'flex', alignItems: 'center', gap: '1.5', minW: '0', textStyle: 'ui.sm', color: 'fg.default' })
const cellIcon = css({ flexShrink: '0' })
const cellText = css({ flex: '1', minW: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const cellFooter = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1', minW: '0' })
const cellMeta = css({ textStyle: 'ui.xs', color: 'fg.subtle', minW: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const lyricBar = css({ display: 'flex', alignItems: 'center', gap: '3', px: '3', py: '2', borderRadius: 'sm', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default' })
const lyricLine = css({ flex: '1', minW: '0', textStyle: 'ui.sm', color: 'fg.default', whiteSpace: 'pre-line' })
const pickerList = css({ display: 'flex', flexDirection: 'column', gap: '1', maxH: '[360px]', overflowY: 'auto', mt: '3' })
const pickerGroup = css({ textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase', mt: '2' })
const pickerItem = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  px: '2.5',
  py: '2',
  borderRadius: 'md',
  textStyle: 'ui.sm',
  color: 'fg.default',
  textAlign: 'left',
  cursor: 'pointer',
  _hover: { bg: 'bg.hover' },
})
</script>

<template>
  <section :class="root" aria-label="Clip grid">
    <div :class="head">
      <h2 :class="title">Clip grid</h2>
      <span :class="hint">Click a cell to launch · 1–{{ Math.min(9, show.grid.columns) }} launch a column · Esc clears clips</span>
    </div>

    <div :class="gridWrap">
      <div :class="gridStyle" :style="{ gridTemplateColumns: `180px repeat(${show.grid.columns}, minmax(0, 1fr))` }">
        <div />
        <button
          v-for="column in columns"
          :key="`head-${column}`"
          type="button"
          :class="headCell"
          :title="`Launch column ${column + 1}`"
          @click="live.launchColumn(column)"
        >
          {{ column + 1 }}
        </button>

        <template v-for="layer in layers" :key="layer.id">
          <div :class="layerCell">
            <div :class="layerHead">
              <span>
                {{ layer.name }}
                <span v-if="layer.id === contentLayer" :class="tag" title="Rundown slides play on this layer"> · rundown</span>
              </span>
              <IconButton icon="lucide:x" label="Clear layer" size="sm" @click="live.clearLayer(layer.id)" />
            </div>
            <Slider
              :model-value="Math.round(layer.opacity * 100)"
              :aria-label="`${layer.name} opacity`"
              :value-text="`${Math.round(layer.opacity * 100)}%`"
              @update:model-value="(value: number) => setLayerOpacity(layer.id, value / 100)"
            />
          </div>
          <template v-for="column in columns" :key="`${layer.id}-${column}`">
            <div
              v-if="clipAt(show, layer.id, column)"
              role="button"
              tabindex="0"
              :class="cx(cell, playing.has(clipAt(show, layer.id, column)!.id) && playingCell)"
              @click="onCell(layer.id, column)"
              @keydown.enter.stop="onCell(layer.id, column)"
            >
              <span :class="cellLabel" :title="clipAt(show, layer.id, column)!.label">
                <Icon :class="cellIcon" :name="clipIcon(clipAt(show, layer.id, column)!)" :size="14" aria-hidden="true" />
                <span :class="cellText">{{ clipAt(show, layer.id, column)!.label }}</span>
              </span>
              <span :class="cellFooter">
                <span :class="cellMeta">
                  {{ clipMissing(clipAt(show, layer.id, column)!) ? 'Missing' : playing.has(clipAt(show, layer.id, column)!.id) ? 'Playing' : '' }}
                </span>
                <span @click.stop>
                  <IconButton icon="lucide:trash-2" label="Remove clip" size="sm" @click="remove(clipAt(show, layer.id, column)!)" />
                </span>
              </span>
            </div>
            <button v-else type="button" :class="cx(cell, emptyCell)" :aria-label="`Add clip to ${layer.name} column ${column + 1}`" @click="onCell(layer.id, column)">
              <Icon name="lucide:plus" :size="14" aria-hidden="true" />
            </button>
          </template>
        </template>
      </div>
    </div>

    <div v-for="clip in activeLyrics" :key="clip.id" :class="lyricBar">
      <IconButton icon="lucide:chevron-left" label="Previous slide" @click="live.stepClip(clip, -1)" />
      <p :class="lyricLine">{{ lyricText(clip) || '—' }}</p>
      <span :class="hint">{{ (grid.slides[clip.id] ?? 0) + 1 }} / {{ slideCount(clip) }}</span>
      <IconButton icon="lucide:chevron-right" label="Next slide" @click="live.stepClip(clip, 1)" />
    </div>

    <Dialog :open="pickerOpen" title="Add clip" description="Pick media or a song for this cell." size="md" @update:open="onPickerOpen">
      <Input v-model="pickerQuery" placeholder="Search" aria-label="Search" />
      <div :class="pickerList">
        <p :class="pickerGroup">Media</p>
        <button
          v-for="asset in pickerMedia"
          :key="asset.id"
          type="button"
          :class="pickerItem"
          @click="pick({ kind: 'media', assetId: asset.id, loop: true }, asset.name)"
        >
          <Icon :name="asset.kind === 'video' ? 'lucide:film' : 'lucide:image'" :size="14" aria-hidden="true" />
          {{ asset.name }}
        </button>
        <p v-if="pickerMedia.length === 0" :class="hint">No images or videos. Import them on the Media page.</p>
        <p :class="pickerGroup">Songs and presentations</p>
        <button
          v-for="item in pickerDocs"
          :key="item.id"
          type="button"
          :class="pickerItem"
          @click="pick({ kind: 'presentation', presentationId: item.id }, item.title)"
        >
          <Icon :name="item.kind === 'song' ? 'lucide:music' : 'lucide:presentation'" :size="14" aria-hidden="true" />
          {{ item.title }}
          <span :class="hint">{{ item.slideCount }} slides</span>
        </button>
        <p v-if="pickerDocs.length === 0" :class="hint">No songs or presentations yet.</p>
      </div>
    </Dialog>
  </section>
</template>
