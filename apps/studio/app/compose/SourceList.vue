<script setup lang="ts">
import { Icon } from '#components'
import type { Layer, Source } from '@lumen/schema'
import { css, cx } from 'styled-system/css'
import { computed, ref } from 'vue'
import type { MediaAsset } from '~/data/media'
import type { PresentationSummary } from '~/data/presentations'
import { Dialog, IconButton, Input, Menu, type MenuEntry } from '~/ui'
import { SOURCE_DRAG_TYPE } from './dragTypes'
import { SHADER_CATALOG, sourceCss, sourceIcon, sourceKindLabel, sourceLabel, type ShaderId, type SourceAddKind } from './composeModel'

/** Composition sources. Drag one onto a layer, or double-click to assign it to the selected layer. */
const props = defineProps<{
  sources: Source[]
  layers: Layer[]
  selectedId: string | null
  canAssign: boolean
  media: MediaAsset[]
  presentations: PresentationSummary[]
}>()

const emit = defineEmits<{
  select: [sourceId: string]
  assign: [sourceId: string]
  remove: [sourceId: string]
  add: [kind: SourceAddKind]
  addMedia: [asset: MediaAsset]
  addPresentation: [id: string]
}>()

const menuItems: MenuEntry[] = [
  { type: 'label', label: 'Generators' },
  { id: 'solid', label: 'Solid colour', icon: 'lucide:square' },
  { id: 'gradient', label: 'Gradient', icon: 'lucide:blend' },
  ...(Object.keys(SHADER_CATALOG) as ShaderId[]).map((id) => ({ id: `shader:${id}`, label: SHADER_CATALOG[id].label, icon: 'lucide:sparkles' })),
  { type: 'separator' },
  { id: 'media', label: 'Image or video…', icon: 'lucide:film' },
  { id: 'presentation', label: 'Slide from presentation…', icon: 'lucide:type' },
]

const picker = ref<'media' | 'presentation' | null>(null)
const pickerOpen = computed({
  get: () => picker.value !== null,
  set: (open: boolean) => {
    if (!open) picker.value = null
  },
})
const query = ref('')
const pickerMedia = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return props.media.filter((asset) => (asset.kind === 'image' || asset.kind === 'video') && !asset.missing && asset.name.toLowerCase().includes(needle))
})
const pickerPresentations = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return props.presentations.filter((entry) => entry.title.toLowerCase().includes(needle))
})

const usage = computed(() => {
  const counts = new Map<string, number>()
  for (const layer of props.layers) if (layer.sourceId) counts.set(layer.sourceId, (counts.get(layer.sourceId) ?? 0) + 1)
  return counts
})

function onMenu(id: string): void {
  if (id === 'media' || id === 'presentation') {
    query.value = ''
    picker.value = id
    return
  }
  emit('add', id as SourceAddKind)
}

function pickMedia(asset: MediaAsset): void {
  picker.value = null
  emit('addMedia', asset)
}

function pickPresentation(id: string): void {
  picker.value = null
  emit('addPresentation', id)
}

function onDragStart(event: DragEvent, source: Source): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(SOURCE_DRAG_TYPE, source.id)
  event.dataTransfer.effectAllowed = 'link'
}

const root = css({ display: 'flex', flexDirection: 'column', minH: '0', h: 'full' })
const toolbar = css({ display: 'flex', alignItems: 'center', gap: '1', px: '2', py: '1', borderBottomWidth: '1px', borderColor: 'border.default' })
const toolbarTitle = css({ flex: '1', textStyle: 'ui.label', color: 'fg.default' })
const scroll = css({ flex: '1', minH: '0', overflowY: 'auto', p: '2', display: 'flex', flexDirection: 'column', gap: '0.5' })
const row = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  h: 'control.lg',
  px: '1.5',
  borderRadius: 'sm',
  cursor: 'grab',
  textAlign: 'left',
  w: 'full',
  minW: '0',
  _hover: { bg: 'bg.hover', '& [data-part=assign]': { opacity: 1 } },
})
const rowSelected = css({ bg: 'accent.muted', _hover: { bg: 'accent.muted' } })
const swatch = css({ display: 'grid', placeItems: 'center', w: '6', h: '6', flexShrink: 0, borderRadius: 'xs', bg: 'bg.subtle', color: 'fg.muted', borderWidth: '1px', borderColor: 'border.default', overflow: 'hidden' })
const nameCol = css({ flex: '1', minW: '0', display: 'flex', flexDirection: 'column' })
const name = css({ textStyle: 'ui.sm', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const meta = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const assign = css({ opacity: 0 })
const empty = css({ textStyle: 'ui.xs', color: 'fg.subtle', p: '2', textAlign: 'center' })
const pickerList = css({ display: 'flex', flexDirection: 'column', gap: '0.5', mt: '2', maxH: '[50vh]', overflowY: 'auto' })
const pickerItem = css({ display: 'flex', alignItems: 'center', gap: '2', h: 'control.md', px: '2', borderRadius: 'xs', textStyle: 'ui.sm', color: 'fg.default', textAlign: 'left', cursor: 'pointer', _hover: { bg: 'bg.hover' } })
</script>

<template>
  <div :class="root">
    <div :class="toolbar">
      <span :class="toolbarTitle">Sources</span>
      <IconButton icon="lucide:trash-2" label="Remove source" size="sm" :disabled="!selectedId" @click="selectedId && emit('remove', selectedId)" />
      <Menu :items="menuItems" aria-label="Add source" @select="onMenu">
        <template #trigger="{ props: trigger }">
          <IconButton icon="lucide:plus" label="Add source" size="sm" v-bind="trigger" />
        </template>
      </Menu>
    </div>
    <div :class="scroll">
      <p v-if="sources.length === 0" :class="empty">No sources. Add a generator, media or a slide.</p>
      <div
        v-for="source in sources"
        :key="source.id"
        :class="cx(row, source.id === selectedId && rowSelected)"
        role="button"
        tabindex="0"
        draggable="true"
        :aria-pressed="source.id === selectedId"
        @click="emit('select', source.id)"
        @keydown.enter.self="emit('select', source.id)"
        @dblclick="canAssign && emit('assign', source.id)"
        @dragstart="onDragStart($event, source)"
      >
        <span :class="swatch" :style="sourceCss(source) ? { background: sourceCss(source)! } : undefined">
          <Icon v-if="!sourceCss(source)" :name="sourceIcon(source)" :size="13" aria-hidden="true" />
        </span>
        <span :class="nameCol">
          <span :class="name">{{ sourceLabel(source) }}</span>
          <span :class="meta">{{ sourceKindLabel(source) }}<template v-if="usage.get(source.id)"> · {{ usage.get(source.id) }} {{ usage.get(source.id) === 1 ? 'layer' : 'layers' }}</template></span>
        </span>
        <IconButton
          v-if="canAssign"
          data-part="assign"
          :class="assign"
          icon="lucide:arrow-up-to-line"
          label="Use on selected layer"
          size="sm"
          @click.stop="emit('assign', source.id)"
        />
      </div>
    </div>

    <Dialog
      v-model:open="pickerOpen"
      :title="picker === 'media' ? 'Add media source' : 'Add slide source'"
      :description="picker === 'media' ? 'Pick an image or video from the media library.' : 'The first slide of the presentation becomes a slide source.'"
      size="md"
    >
      <Input v-model="query" type="search" placeholder="Search" aria-label="Search" live />
      <div :class="pickerList">
        <template v-if="picker === 'media'">
          <button v-for="asset in pickerMedia" :key="asset.id" type="button" :class="pickerItem" @click="pickMedia(asset)">
            <Icon :name="asset.kind === 'video' ? 'lucide:film' : 'lucide:image'" :size="14" aria-hidden="true" />
            {{ asset.name }}
          </button>
          <p v-if="pickerMedia.length === 0" :class="empty">No images or videos. Import files in Media.</p>
        </template>
        <template v-else>
          <button v-for="entry in pickerPresentations" :key="entry.id" type="button" :class="pickerItem" @click="pickPresentation(entry.id)">
            <Icon name="lucide:type" :size="14" aria-hidden="true" />
            {{ entry.title }}
          </button>
          <p v-if="pickerPresentations.length === 0" :class="empty">No presentations. Create one in Content.</p>
        </template>
      </div>
    </Dialog>
  </div>
</template>
