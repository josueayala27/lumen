<script setup lang="ts">
import { Icon } from '#components'
import type { Layer, Source } from '@lumen/schema'
import { css, cx } from 'styled-system/css'
import { computed, nextTick, ref } from 'vue'
import { IconButton, Input, MultiCombobox, PropertyRow, Slider, SortableList, type ComboboxOption, type SortableMove } from '~/ui'
import { SOURCE_DRAG_TYPE } from './dragTypes'
import { layersTopFirst, parseTags, sourceIcon, sourceLabel, stackIndexFromDisplay } from './composeModel'

/** The layer stack, top layer first. Sources dropped on a row are assigned to that layer. */
const props = defineProps<{ layers: Layer[]; sources: Source[]; selectedId: string | null }>()

const emit = defineEmits<{
  select: [layerId: string]
  add: []
  remove: [layerId: string]
  duplicate: [layerId: string]
  move: [layerId: string, stackIndex: number]
  rename: [layerId: string, name: string]
  toggle: [layerId: string, enabled: boolean]
  assign: [layerId: string, sourceId: string]
  opacity: [layerId: string, opacity: number]
  tags: [layerId: string, tags: string[]]
}>()

const ordered = computed(() => layersTopFirst(props.layers))
const sourceMap = computed(() => new Map(props.sources.map((source) => [source.id, source])))
const selected = computed(() => props.layers.find((layer) => layer.id === props.selectedId) ?? null)
const renaming = ref<string | null>(null)
const draft = ref('')
const dropTarget = ref<string | null>(null)

const BASE_TAGS = ['background', 'content', 'lyrics', 'overlay']
const tagOptions = computed<ComboboxOption[]>(() => {
  const all = new Set([...BASE_TAGS, ...props.layers.flatMap((layer) => layer.tags)])
  return [...all].sort().map((tag) => ({ value: tag, label: tag }))
})

function onMove(move: SortableMove): void {
  const layer = ordered.value[move.from.index]
  if (layer) emit('move', layer.id, stackIndexFromDisplay(move.to.index, props.layers.length))
}

async function startRename(layer: Layer): Promise<void> {
  renaming.value = layer.id
  draft.value = layer.name
  await nextTick()
  document.querySelector<HTMLInputElement>(`[data-rename="${layer.id}"] input`)?.focus()
}

function commitRename(layer: Layer, value: string): void {
  if (renaming.value !== layer.id) return
  renaming.value = null
  const name = value.trim()
  if (name && name !== layer.name) emit('rename', layer.id, name)
}

function onDragOver(event: DragEvent, layerId: string): void {
  if (!event.dataTransfer?.types.includes(SOURCE_DRAG_TYPE)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'link'
  dropTarget.value = layerId
}

function onDrop(event: DragEvent, layerId: string): void {
  const sourceId = event.dataTransfer?.getData(SOURCE_DRAG_TYPE)
  dropTarget.value = null
  if (!sourceId) return
  event.preventDefault()
  emit('assign', layerId, sourceId)
  emit('select', layerId)
}

function addTag(query: string): void {
  const layer = selected.value
  if (!layer) return
  const tags = parseTags(query)
  if (tags.length > 0) emit('tags', layer.id, [...new Set([...layer.tags, ...tags])])
}

const root = css({ display: 'flex', flexDirection: 'column', minH: '0', h: 'full' })
const toolbar = css({ display: 'flex', alignItems: 'center', gap: '1', px: '2', py: '1', borderBottomWidth: '1px', borderColor: 'border.default' })
const toolbarTitle = css({ flex: '1', textStyle: 'ui.label', color: 'fg.default' })
const scroll = css({ flex: '1', minH: '0', overflowY: 'auto', p: '2' })
const row = css({
  display: 'flex',
  alignItems: 'center',
  gap: '1.5',
  h: 'control.lg',
  px: '1.5',
  borderRadius: 'sm',
  borderWidth: '1px',
  borderColor: 'transparent',
  cursor: 'pointer',
  minW: '0',
  w: 'full',
  _hover: { bg: 'bg.hover' },
})
const rowSelected = css({ bg: 'accent.muted', _hover: { bg: 'accent.muted' } })
const rowDrop = css({ borderColor: 'accent.default' })
const rowDisabled = css({ opacity: 0.5 })
const nameCol = css({ flex: '1', minW: '0', display: 'flex', flexDirection: 'column' })
const name = css({ textStyle: 'ui.sm', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const meta = css({ display: 'flex', alignItems: 'center', gap: '1', textStyle: 'ui.xs', color: 'fg.subtle', overflow: 'hidden', whiteSpace: 'nowrap' })
const footer = css({ borderTopWidth: '1px', borderColor: 'border.default', p: '2', display: 'flex', flexDirection: 'column', gap: '1' })
const sliderRow = css({ display: 'grid', gridTemplateColumns: '[minmax(0, 1fr) token(sizes.10)]', alignItems: 'center', gap: '2', w: 'full' })
const value = css({ textStyle: 'ui.xs', color: 'fg.muted', textAlign: 'right' })
const empty = css({ textStyle: 'ui.xs', color: 'fg.subtle', p: '2', textAlign: 'center' })
</script>

<template>
  <div :class="root">
    <div :class="toolbar">
      <span :class="toolbarTitle">Layers</span>
      <IconButton icon="lucide:copy" label="Duplicate layer" size="sm" :disabled="!selected" @click="selected && emit('duplicate', selected.id)" />
      <IconButton icon="lucide:trash-2" label="Remove layer" shortcut="Delete" size="sm" :disabled="!selected" @click="selected && emit('remove', selected.id)" />
      <IconButton icon="lucide:plus" label="Add layer" size="sm" @click="emit('add')" />
    </div>
    <div :class="scroll">
      <p v-if="layers.length === 0" :class="empty">No layers yet. Add one, then drop a source on it.</p>
      <SortableList
        v-else
        :items="ordered"
        list-id="compose-layers"
        group="compose-layers"
        item-key="id"
        :item-label="(layer) => layer.name"
        aria-label="Layers, top first"
        @move="onMove"
      >
        <template #default="{ item: layer }">
          <div
            :class="cx(row, layer.id === selectedId && rowSelected, dropTarget === layer.id && rowDrop, !layer.enabled && rowDisabled)"
            role="button"
            tabindex="0"
            :aria-pressed="layer.id === selectedId"
            :data-rename="layer.id"
            @click="emit('select', layer.id)"
            @keydown.enter.self="emit('select', layer.id)"
            @dblclick="startRename(layer)"
            @dragover="onDragOver($event, layer.id)"
            @dragleave="dropTarget = dropTarget === layer.id ? null : dropTarget"
            @drop="onDrop($event, layer.id)"
          >
            <IconButton
              :icon="layer.enabled ? 'lucide:eye' : 'lucide:eye-off'"
              :label="layer.enabled ? 'Hide layer' : 'Show layer'"
              size="sm"
              @click.stop="emit('toggle', layer.id, !layer.enabled)"
            />
            <div :class="nameCol">
              <Input
                v-if="renaming === layer.id"
                v-model="draft"
                size="sm"
                aria-label="Layer name"
                @click.stop
                @commit="commitRename(layer, $event)"
                @cancel="renaming = null"
              />
              <template v-else>
                <span :class="name">{{ layer.name }}</span>
                <span :class="meta">
                  <template v-if="layer.sourceId && sourceMap.get(layer.sourceId)">
                    <Icon :name="sourceIcon(sourceMap.get(layer.sourceId)!)" :size="11" aria-hidden="true" />
                    {{ sourceLabel(sourceMap.get(layer.sourceId)!) }}
                  </template>
                  <template v-else>No source</template>
                  <template v-if="layer.tags.length"> · {{ layer.tags.join(', ') }}</template>
                </span>
              </template>
            </div>
            <span :class="value">{{ Math.round(layer.opacity * 100) }}%</span>
          </div>
        </template>
      </SortableList>
    </div>
    <div v-if="selected" :class="footer">
      <PropertyRow label="Opacity">
        <div :class="sliderRow">
          <Slider :model-value="selected.opacity" :min="0" :max="1" :step="0.01" aria-label="Layer opacity" @update:model-value="emit('opacity', selected.id, $event)" />
          <span :class="value">{{ Math.round(selected.opacity * 100) }}%</span>
        </div>
      </PropertyRow>
      <PropertyRow label="Tags">
        <MultiCombobox
          :model-value="selected.tags"
          :options="tagOptions"
          creatable
          size="sm"
          placeholder="Add tag"
          aria-label="Layer tags"
          @update:model-value="emit('tags', selected.id, parseTags($event.join(',')))"
          @create="addTag"
        />
      </PropertyRow>
    </div>
  </div>
</template>
