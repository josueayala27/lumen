<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { displayTarget, layoutIncludesLayer, slideText, updateCompositionLayer, type ScreenPatch } from '@lumen/core'
import type { PresentationDoc } from '@lumen/schema'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { listMediaAssets, type MediaAsset } from '~/data/media'
import { getPresentation, listPresentations, type PresentationSummary } from '~/data/presentations'
import ErrorNotice from '~/library/ErrorNotice.vue'
import PageHeader from '~/library/PageHeader.vue'
import { isTauri } from '~/output/api'
import { screenRef } from '~/output/screens'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  type SegmentOption,
  type SelectOption,
} from '~/ui'
import {
  activeClips,
  assignClip,
  clearLayer,
  clipAt,
  displayForScreen,
  emptyLive,
  launchClip,
  launchColumn,
  removeShowClip,
  stepLyrics,
  toggleScreenLayer,
  updateScreen,
  updateScreenLayout,
  type ClipContent,
  type Screen,
  type ShowClip,
  type ShowLive,
  type TextPreset,
} from './showModel'
import { useShowDocument } from './useShowDocument'
import { useShowOutput } from './useShowOutput'

const showDocument = useShowDocument()
const show = showDocument.show
const saveError = showDocument.error
const live = ref<ShowLive>(emptyLive())
const media = ref<MediaAsset[]>([])
const presentations = ref<PresentationSummary[]>([])
const docs = shallowRef(new Map<string, PresentationDoc>())
const docsVersion = ref(0)
const error = ref('')
const desktop = isTauri()

const output = useShowOutput({
  show,
  live,
  media,
  theme: ref(null),
  presentation: (id) => docs.value.get(id) ?? null,
  docsVersion,
})

const columns = computed(() => Array.from({ length: show.value.grid.columns }, (_, index) => index))
const playing = computed(() => new Set(Object.values(live.value.active).filter(Boolean)))
const anyOutput = computed(() => output.outputs.value.length > 0)

const lyricOptions: SegmentOption<TextPreset>[] = [
  { value: 'full', label: 'Full' },
  { value: 'lowerThird', label: 'Lower third' },
  { value: 'strip', label: 'Strip' },
  { value: 'hidden', label: 'Hidden' },
]
const NO_DISPLAY = -1
const displayOptions = computed<SelectOption<number>[]>(() => [
  { value: NO_DISPLAY, label: 'No display' },
  ...output.displays.value.map((display) => ({
    value: display.index,
    label: `${display.name} · ${display.width}×${display.height}${display.primary ? ' · primary' : ''}`,
  })),
])

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function ensureDoc(id: string): Promise<void> {
  if (docs.value.has(id)) return
  const record = await getPresentation(id)
  if (!record) return
  docs.value = new Map(docs.value).set(id, record.doc)
  docsVersion.value++
}

onMounted(async () => {
  try {
    const [, assets, list] = await Promise.all([showDocument.load(), listMediaAssets(), listPresentations()])
    media.value = assets
    presentations.value = list
    await Promise.all(
      show.value.grid.clips.flatMap((clip) =>
        clip.content.kind === 'presentation' ? [ensureDoc(clip.content.presentationId)] : [],
      ),
    )
    await output.ensureLoaded()
  } catch (reason) {
    error.value = message(reason)
  }
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function setLayerOpacity(layerId: string, opacity: number): void {
  showDocument.updateComposition((composition) => updateCompositionLayer(composition, layerId, { opacity }), {
    coalesce: `opacity:${layerId}`,
  })
}

// Grid

const picking = ref<{ layerId: string; column: number } | null>(null)
const pickerOpen = computed({
  get: () => picking.value !== null,
  set: (value: boolean) => {
    if (!value) picking.value = null
  },
})
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
    live.value = launchClip(live.value, clip)
    return
  }
  pickerQuery.value = ''
  picking.value = { layerId, column }
}

async function pick(content: ClipContent, label: string): Promise<void> {
  const target = picking.value
  if (!target) return
  picking.value = null
  if (content.kind === 'presentation') await ensureDoc(content.presentationId)
  showDocument.update((value) => assignClip(value, target.layerId, target.column, content, label))
}

function remove(clip: ShowClip): void {
  if (live.value.active[clip.layerId] === clip.id) live.value = clearLayer(live.value, clip.layerId)
  showDocument.update((value) => removeShowClip(value, clip.id))
}

function clipIcon(clip: ShowClip): string {
  if (clip.content.kind === 'presentation') return 'lucide:music'
  if (clip.content.kind !== 'media') return 'lucide:layers'
  const { assetId } = clip.content
  return media.value.find((asset) => asset.id === assetId)?.kind === 'video' ? 'lucide:film' : 'lucide:image'
}

function clipMissing(clip: ShowClip): boolean {
  if (clip.content.kind === 'presentation') return !docs.value.has(clip.content.presentationId)
  if (clip.content.kind !== 'media') return false
  const { assetId } = clip.content
  const asset = media.value.find((entry) => entry.id === assetId)
  return !asset || asset.missing
}

function clearAll(): void {
  live.value = emptyLive()
}

// Lyrics

const activeLyrics = computed(() =>
  activeClips(show.value, live.value).filter((clip) => clip.content.kind === 'presentation'),
)

function slideCount(clip: ShowClip): number {
  return clip.content.kind === 'presentation' ? docs.value.get(clip.content.presentationId)?.slides.length ?? 0 : 0
}

function step(delta: number): void {
  live.value = activeLyrics.value.reduce(
    (next, clip) => stepLyrics(next, clip.id, delta, slideCount(clip)),
    live.value,
  )
}

function lyricText(clip: ShowClip): string {
  if (clip.content.kind !== 'presentation') return ''
  const doc = docs.value.get(clip.content.presentationId)
  const slide = doc?.slides[live.value.slides[clip.id] ?? 0]
  return slide ? slideText(slide) : ''
}

function onKey(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  if (pickerOpen.value) return
  if (event.key === 'ArrowRight' || event.key === ' ') {
    event.preventDefault()
    step(1)
    return
  }
  if (event.key === 'ArrowLeft') {
    step(-1)
    return
  }
  if (event.key === 'Escape') {
    clearAll()
    return
  }
  const column = Number(event.key) - 1
  if (Number.isInteger(column) && column >= 0 && column < show.value.grid.columns) {
    live.value = launchColumn(show.value, live.value, column)
  }
}

// Screens

function patchScreen(screen: Screen, patch: ScreenPatch): void {
  showDocument.update((value) => updateScreen(value, screen.id, patch))
}

function setTextPreset(screen: Screen, preset: TextPreset): void {
  const text = { scale: 1, color: null, ...screen.layout.text, preset }
  showDocument.update((value) => updateScreenLayout(value, screen.id, { text }))
}

function toggleLayer(screen: Screen, layerId: string, on: boolean): void {
  showDocument.update((value) => toggleScreenLayer(value, screen.id, layerId, on))
}

function displayIndexOf(screen: Screen): number {
  return displayForScreen(output.displays.value, screen)?.index ?? NO_DISPLAY
}

function setDisplay(screen: Screen, index: number | undefined): void {
  const display = output.displays.value.find((entry) => entry.index === index)
  if (!display) {
    patchScreen(screen, { target: { kind: 'virtual' } })
    return
  }
  patchScreen(screen, { target: displayTarget(screenRef(display)), size: { width: display.width, height: display.height } })
}

function screenStatus(screen: Screen): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (screen.target.kind !== 'display') return { label: 'No display', tone: 'neutral' }
  const display = displayForScreen(output.displays.value, screen)
  if (!display) return { label: 'Display missing', tone: 'warning' }
  return output.outputFor(display.index) ? { label: 'Live', tone: 'success' } : { label: 'Off', tone: 'neutral' }
}

/** What a screen shows right now, bottom to top, for the preview list. */
function screenLines(screen: Screen): string[] {
  if (screen.testPattern) return ['Test pattern']
  if (screen.blackout) return ['Blackout']
  const preset = screen.layout.text?.preset ?? 'full'
  const lines: string[] = []
  for (const layer of show.value.composition.layers) {
    if (!layer.enabled || !layoutIncludesLayer(screen.layout, layer) || layer.opacity <= 0) continue
    const clip = show.value.grid.clips.find((entry) => entry.id === live.value.active[layer.id])
    if (!clip) continue
    if (clip.content.kind === 'presentation') {
      if (preset === 'hidden') continue
      const text = lyricText(clip).split('\n')[0] ?? ''
      const style = preset === 'lowerThird' ? 'lower third · ' : preset === 'strip' ? 'strip · ' : ''
      lines.push(`${layer.name}: ${style}${text}`)
      continue
    }
    lines.push(`${layer.name}: ${clip.label}`)
  }
  return lines.length ? lines : ['Black']
}

const page = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', px: '6', py: '5', overflowY: 'auto' })
const section = css({ display: 'flex', flexDirection: 'column', gap: '2', mb: '6' })
const sectionHead = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2' })
const sectionTitle = css({ textStyle: 'ui.title', color: 'fg.default' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const gridWrap = css({ overflowX: 'auto' })
const grid = css({ display: 'grid', gap: '1.5', minW: '[900px]' })
const headCell = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  h: '[32px]',
  borderRadius: 'md',
  textStyle: 'ui.xs',
  color: 'fg.muted',
  bg: 'bg.subtle',
  cursor: 'pointer',
  _hover: { bg: 'bg.hover', color: 'fg.default' },
})
const layerCell = css({ display: 'flex', flexDirection: 'column', gap: '1.5', p: '2', borderRadius: 'md', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default' })
const layerHead = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1', textStyle: 'ui.sm', color: 'fg.default' })
const cell = css({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: '1',
  minH: '[76px]',
  p: '2',
  borderRadius: 'md',
  borderWidth: '1px',
  borderColor: 'border.default',
  bg: 'bg.panel',
  textAlign: 'left',
  cursor: 'pointer',
  _hover: { borderColor: 'border.strong', bg: 'bg.hover' },
})
const emptyCell = css({ borderStyle: 'dashed', bg: 'bg.canvas', color: 'fg.subtle', alignItems: 'center', justifyContent: 'center' })
const playingCell = css({ borderColor: 'success.default', boxShadow: '[inset 0 0 0 1px var(--colors-success-default)]' })
const cellLabel = css({ display: 'flex', alignItems: 'center', gap: '1.5', textStyle: 'ui.sm', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const cellMeta = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const cellRemove = css({ position: 'absolute', top: '1', right: '1' })
const lyricBar = css({ display: 'flex', alignItems: 'center', gap: '3', p: '3', borderRadius: 'md', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default' })
const lyricLine = css({ flex: '1', minW: '0', textStyle: 'ui.md', color: 'fg.default', whiteSpace: 'pre-line' })
const screensGrid = css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '3' })
const screenCard = css({ display: 'flex', flexDirection: 'column', gap: '3', p: '3.5', borderRadius: 'md', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default' })
const screenHead = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2' })
const preview = css({ display: 'flex', flexDirection: 'column', gap: '0.5', p: '2.5', borderRadius: 'md', bg: 'bg.canvas', textStyle: 'ui.mono', color: 'fg.muted', aspectRatio: '[16/9]', overflow: 'hidden' })
const row = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2', textStyle: 'ui.sm', color: 'fg.muted' })
const layerChecks = css({ display: 'flex', flexWrap: 'wrap', gap: '3' })
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
  <div :class="page">
    <PageHeader eyebrow="Show" title="Clip grid" subtitle="Launch media and lyrics on layers. Each screen shows its own layers and lyric style.">
      <template #actions>
        <Button variant="ghost" icon="lucide:square" @click="clearAll">Clear all</Button>
        <Button v-if="anyOutput" variant="secondary" icon="lucide:monitor-off" :disabled="!desktop" @click="output.closeAll">
          Stop outputs
        </Button>
        <Button variant="primary" icon="lucide:monitor-play" :disabled="!desktop" @click="output.openAll">Open outputs</Button>
      </template>
    </PageHeader>

    <ErrorNotice v-if="error" :message="error" />
    <ErrorNotice v-if="saveError" :message="saveError" />
    <ErrorNotice v-if="output.error.value" :message="output.error.value" />

    <section :class="section">
      <div :class="sectionHead">
        <h2 :class="sectionTitle">Grid</h2>
        <span :class="hint">Click a cell to launch · 1–{{ show.grid.columns }} launch a column · ←/→ lyrics · Esc clears</span>
      </div>
      <div :class="gridWrap">
        <div :class="grid" :style="{ gridTemplateColumns: `200px repeat(${show.grid.columns}, minmax(0, 1fr))` }">
          <div />
          <button
            v-for="column in columns"
            :key="`head-${column}`"
            type="button"
            :class="headCell"
            :title="`Launch column ${column + 1}`"
            @click="live = launchColumn(show, live, column)"
          >
            {{ column + 1 }}
          </button>

          <template v-for="layer in [...show.composition.layers].reverse()" :key="layer.id">
            <div :class="layerCell">
              <div :class="layerHead">
                <span>{{ layer.name }}</span>
                <IconButton icon="lucide:x" label="Clear layer" size="sm" @click="live = clearLayer(live, layer.id)" />
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
                :class="[cell, playing.has(clipAt(show, layer.id, column)!.id) && playingCell]"
                @click="onCell(layer.id, column)"
                @keydown.enter="onCell(layer.id, column)"
              >
                <span :class="cellLabel">
                  <Icon :name="clipIcon(clipAt(show, layer.id, column)!)" :size="14" aria-hidden="true" />
                  {{ clipAt(show, layer.id, column)!.label }}
                </span>
                <span :class="cellMeta">
                  {{ clipMissing(clipAt(show, layer.id, column)!) ? 'Missing' : playing.has(clipAt(show, layer.id, column)!.id) ? 'Playing' : '' }}
                </span>
                <span :class="cellRemove" @click.stop>
                  <IconButton icon="lucide:trash-2" label="Remove clip" size="sm" @click="remove(clipAt(show, layer.id, column)!)" />
                </span>
              </div>
              <button v-else type="button" :class="[cell, emptyCell]" :aria-label="`Add clip to ${layer.name} column ${column + 1}`" @click="onCell(layer.id, column)">
                <Icon name="lucide:plus" :size="14" aria-hidden="true" />
              </button>
            </template>
          </template>
        </div>
      </div>
    </section>

    <section v-for="clip in activeLyrics" :key="clip.id" :class="section">
      <div :class="lyricBar">
        <IconButton icon="lucide:chevron-left" label="Previous slide" @click="live = stepLyrics(live, clip.id, -1, slideCount(clip))" />
        <p :class="lyricLine">{{ lyricText(clip) || '—' }}</p>
        <span :class="hint">{{ (live.slides[clip.id] ?? 0) + 1 }} / {{ slideCount(clip) }}</span>
        <IconButton icon="lucide:chevron-right" label="Next slide" @click="live = stepLyrics(live, clip.id, 1, slideCount(clip))" />
      </div>
    </section>

    <section :class="section">
      <div :class="sectionHead">
        <h2 :class="sectionTitle">Screens</h2>
        <span v-if="!desktop" :class="hint">Outputs open in the desktop app.</span>
      </div>
      <div :class="screensGrid">
        <article v-for="screen in show.screens" :key="screen.id" :class="screenCard">
          <div :class="screenHead">
            <Input :model-value="screen.name" size="sm" aria-label="Screen name" @update:model-value="(value: string) => patchScreen(screen, { name: value })" />
            <Badge :tone="screenStatus(screen).tone" dot>{{ screenStatus(screen).label }}</Badge>
          </div>
          <div :class="preview">
            <span v-for="(line, index) in screenLines(screen)" :key="index">{{ line }}</span>
          </div>
          <Select
            :model-value="displayIndexOf(screen)"
            :options="displayOptions"
            size="sm"
            aria-label="Display"
            @update:model-value="(value?: number) => setDisplay(screen, value)"
          />
          <SegmentedControl
            :model-value="screen.layout.text?.preset ?? 'full'"
            :options="lyricOptions"
            size="sm"
            aria-label="Lyrics"
            @update:model-value="(value?: TextPreset) => value && setTextPreset(screen, value)"
          />
          <div :class="layerChecks">
            <Checkbox
              v-for="layer in show.composition.layers"
              :key="layer.id"
              :label="layer.name"
              :model-value="layoutIncludesLayer(screen.layout, layer)"
              @update:model-value="(on: boolean) => toggleLayer(screen, layer.id, on)"
            />
          </div>
          <div :class="row">
            <span>Test pattern</span>
            <Switch
              :model-value="screen.testPattern !== null"
              size="sm"
              aria-label="Test pattern"
              @update:model-value="(on: boolean) => patchScreen(screen, { testPattern: on ? 'bars' : null })"
            />
          </div>
        </article>
      </div>
    </section>

    <Dialog v-model:open="pickerOpen" title="Add clip" description="Pick media or a song for this cell." size="md">
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
  </div>
</template>
