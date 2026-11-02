<script setup lang="ts">
import {
  addCompositionLayer,
  addSource,
  createLayer,
  duplicateCompositionLayer,
  moveCompositionLayer,
  newId,
  presentationSlideSource,
  removeCompositionLayer,
  removeSource,
  setLayerSource,
  updateCompositionLayer,
  updateSource,
} from '@lumen/core'
import type { LayerTransform, Source } from '@lumen/schema'
import { css } from 'styled-system/css'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { listMediaAssets, type MediaAsset } from '~/data/media'
import { getPresentation, listPresentations, type PresentationSummary } from '~/data/presentations'
import { getTheme } from '~/data/themes'
import ErrorNotice from '~/library/ErrorNotice.vue'
import PageHeader from '~/library/PageHeader.vue'
import { useShowDocument } from '~/show/useShowDocument'
import { Badge, IconButton, Panel, PanelSection, matchesShortcut } from '~/ui'
import ComposeCanvas from './ComposeCanvas.vue'
import CompositionInspector from './CompositionInspector.vue'
import {
  createGradientSource,
  createMediaSource,
  createShaderSource,
  createSolidSource,
  sourceLabel,
  type ShaderId,
  type SourceAddKind,
} from './composeModel'
import LayerInspector from './LayerInspector.vue'
import LayerStack from './LayerStack.vue'
import SourceInspector from './SourceInspector.vue'
import SourceList from './SourceList.vue'
import { useComposePreview } from './useComposePreview'

const doc = useShowDocument()
const show = doc.show
const composition = doc.composition

const media = ref<MediaAsset[]>([])
const presentations = ref<PresentationSummary[]>([])
const error = ref('')
const dragging = ref(false)

type Selection = { kind: 'layer' | 'source'; id: string } | null
const selection = ref<Selection>(null)

const selectedLayer = computed(() =>
  selection.value?.kind === 'layer' ? composition.value.layers.find((layer) => layer.id === selection.value!.id) ?? null : null,
)
const selectedSource = computed<Source | null>(() => {
  const value = selection.value
  if (!value) return null
  const id = value.kind === 'source' ? value.id : selectedLayer.value?.sourceId
  return id ? composition.value.sources.find((source) => source.id === id) ?? null : null
})
const images = computed(() => media.value.filter((asset) => asset.kind === 'image' && !asset.missing))

const preview = useComposePreview({ show, media, dragging })
const rendered = computed(() => preview.available && !preview.error.value)

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function assetName(source: Source | null): string | undefined {
  if (!source || (source.kind !== 'image' && source.kind !== 'video')) return undefined
  return media.value.find((asset) => asset.id === source.asset.assetId)?.name
}

// --- Layers ------------------------------------------------------------------

function selectLayer(id: string | null): void {
  selection.value = id ? { kind: 'layer', id } : null
}

function addLayer(): void {
  const layer = createLayer({ name: `Layer ${composition.value.layers.length + 1}` })
  doc.updateComposition((value) => addCompositionLayer(value, layer))
  selectLayer(layer.id)
}

function removeLayer(id: string): void {
  doc.updateComposition((value) => removeCompositionLayer(value, id))
  if (selection.value?.id === id) selection.value = null
}

function duplicateLayer(id: string): void {
  const copyId = newId('layer')
  doc.updateComposition((value) => duplicateCompositionLayer(value, id, copyId))
  selectLayer(copyId)
}

function assign(layerId: string, sourceId: string): void {
  doc.updateComposition((value) => setLayerSource(value, layerId, sourceId))
}

function setTransform(layerId: string, transform: LayerTransform): void {
  doc.updateComposition((value) => updateCompositionLayer(value, layerId, { transform }), { coalesce: `layer:${layerId}:drag` })
}

// --- Sources -----------------------------------------------------------------

/** Adds a source; a selected layer without a source picks it up. */
function insertSource(source: Source): void {
  const layer = selectedLayer.value
  doc.updateComposition((value) => {
    const next = addSource(value, source)
    return layer && layer.sourceId === null ? setLayerSource(next, layer.id, source.id) : next
  })
  if (!layer || layer.sourceId !== null) selection.value = { kind: 'source', id: source.id }
}

function addGenerator(kind: SourceAddKind): void {
  if (kind === 'solid') insertSource(createSolidSource())
  else if (kind === 'gradient') insertSource(createGradientSource())
  else insertSource(createShaderSource(kind.slice('shader:'.length) as ShaderId))
}

function addMedia(asset: MediaAsset): void {
  const source = createMediaSource(asset)
  if (source) insertSource(source)
}

async function addPresentation(id: string): Promise<void> {
  try {
    const record = await getPresentation(id)
    if (!record) throw new Error('The presentation no longer exists.')
    const theme = record.doc.themeId ? ((await getTheme(record.doc.themeId))?.theme ?? null) : null
    const source = presentationSlideSource(newId('source'), record.doc, 0, theme)
    if (!source) throw new Error(`“${record.doc.title}” has no slides.`)
    insertSource(source)
  } catch (reason) {
    error.value = message(reason)
  }
}

function removeSelectedSource(id: string): void {
  doc.updateComposition((value) => removeSource(value, id))
  if (selection.value?.kind === 'source' && selection.value.id === id) selection.value = null
}

function patchSource(sourceId: string, patch: Partial<Source>, field?: string): void {
  doc.updateComposition((value) => updateSource(value, sourceId, patch), field ? { coalesce: `source:${sourceId}:${field}` } : {})
}

// --- Keyboard ----------------------------------------------------------------

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

function onKey(event: KeyboardEvent): void {
  if (matchesShortcut(event, 'Mod+Shift+Z') || matchesShortcut(event, 'Mod+Y')) {
    if (isTyping(event.target)) return
    event.preventDefault()
    doc.redo()
    return
  }
  if (matchesShortcut(event, 'Mod+Z')) {
    if (isTyping(event.target)) return
    event.preventDefault()
    doc.undo()
    return
  }
  if (isTyping(event.target)) return
  if (event.key === 'Delete' || event.key === 'Backspace') {
    const value = selection.value
    if (!value) return
    event.preventDefault()
    if (value.kind === 'layer') removeLayer(value.id)
    else removeSelectedSource(value.id)
    return
  }
  if (matchesShortcut(event, 'Mod+D') && selectedLayer.value) {
    event.preventDefault()
    duplicateLayer(selectedLayer.value.id)
    return
  }
  if (event.key === 'Escape') selection.value = null
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try {
    const [, assets, list] = await Promise.all([doc.load(), listMediaAssets(), listPresentations()])
    media.value = assets
    presentations.value = list
  } catch (reason) {
    error.value = message(reason)
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const page = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', p: '6', pb: '4' })
const grid = css({
  flex: '1',
  minH: '0',
  display: 'grid',
  gridTemplateColumns: '[token(sizes.64) minmax(0, 1fr) token(sizes.80)]',
  gap: '3',
})
const column = css({ display: 'flex', flexDirection: 'column', gap: '3', minH: '0' })
const half = css({ flex: '1', minH: '0' })
const centre = css({ display: 'flex', flexDirection: 'column', gap: '2', minH: '0', minW: '0' })
const note = css({ display: 'flex', alignItems: 'center', gap: '2', textStyle: 'ui.xs', color: 'fg.subtle' })
const inspector = css({ flex: '1', minH: '0', overflowY: 'auto', px: '3' })
const actions = css({ display: 'flex', alignItems: 'center', gap: '1' })
</script>

<template>
  <div :class="page">
    <PageHeader eyebrow="Build" title="Compose" subtitle="Stack sources into layers, then set blend modes, effects and masks for the show's composition." compact>
      <template #badges>
        <Badge :label="`${composition.canvas.width} × ${composition.canvas.height}`" size="sm" />
      </template>
      <template #actions>
        <div :class="actions">
          <IconButton icon="lucide:undo-2" label="Undo" shortcut="Mod+Z" :disabled="!doc.canUndo.value" @click="doc.undo()" />
          <IconButton icon="lucide:redo-2" label="Redo" shortcut="Mod+Shift+Z" :disabled="!doc.canRedo.value" @click="doc.redo()" />
        </div>
      </template>
    </PageHeader>
    <ErrorNotice v-if="error || doc.error.value" :message="error || doc.error.value" @dismiss="error = ''" />

    <div :class="grid">
      <div :class="column">
        <Panel bordered="all" :class="half">
          <LayerStack
            :layers="composition.layers"
            :sources="composition.sources"
            :selected-id="selectedLayer?.id ?? null"
            @select="selectLayer"
            @add="addLayer"
            @remove="removeLayer"
            @duplicate="duplicateLayer"
            @move="(id, index) => doc.updateComposition((value) => moveCompositionLayer(value, id, index))"
            @rename="(id, name) => doc.updateComposition((value) => updateCompositionLayer(value, id, { name }))"
            @toggle="(id, enabled) => doc.updateComposition((value) => updateCompositionLayer(value, id, { enabled }))"
            @assign="assign"
            @opacity="(id, opacity) => doc.updateComposition((value) => updateCompositionLayer(value, id, { opacity }), { coalesce: `layer:${id}:opacity` })"
            @tags="(id, tags) => doc.updateComposition((value) => updateCompositionLayer(value, id, { tags }))"
          />
        </Panel>
        <Panel bordered="all" :class="half">
          <SourceList
            :sources="composition.sources"
            :layers="composition.layers"
            :selected-id="selection?.kind === 'source' ? selection.id : null"
            :can-assign="selectedLayer !== null"
            :media="media"
            :presentations="presentations"
            @select="(id) => (selection = { kind: 'source', id })"
            @assign="(id) => selectedLayer && assign(selectedLayer.id, id)"
            @remove="removeSelectedSource"
            @add="addGenerator"
            @add-media="addMedia"
            @add-presentation="addPresentation"
          />
        </Panel>
      </div>

      <div :class="centre">
        <ComposeCanvas
          :composition="composition"
          :selected-id="selectedLayer?.id ?? null"
          :frame="preview.frame.value"
          :rendered="rendered"
          @select="selectLayer"
          @drag-start="dragging = true"
          @drag-end="dragging = false"
          @transform="setTransform"
        />
        <p :class="note">
          <span>{{ rendered ? 'Rust preview.' : 'Browser approximation; the desktop app shows the Rust render.' }}</span>
          <span>Blend modes, effects, masks and generators are not rendered until the compositor lands.</span>
        </p>
        <p v-if="preview.error.value" :class="note">Preview error: {{ preview.error.value }}</p>
      </div>

      <Panel bordered="all" :title="selectedLayer ? selectedLayer.name : selection?.kind === 'source' && selectedSource ? sourceLabel(selectedSource) : 'Composition'">
        <div :class="inspector">
          <template v-if="selectedLayer">
            <LayerInspector :layer="selectedLayer" :sources="composition.sources" :images="images" />
            <PanelSection v-if="selectedSource" title="Source settings" flush>
              <SourceInspector
                :source="selectedSource"
                :asset-name="assetName(selectedSource)"
                @patch="(patch, field) => patchSource(selectedSource!.id, patch, field)"
              />
            </PanelSection>
          </template>
          <PanelSection v-else-if="selectedSource" title="Source" flush>
            <SourceInspector
              :source="selectedSource"
              :asset-name="assetName(selectedSource)"
              @patch="(patch, field) => patchSource(selectedSource!.id, patch, field)"
            />
          </PanelSection>
          <CompositionInspector v-else :composition="composition" />
        </div>
      </Panel>
    </div>
  </div>
</template>
