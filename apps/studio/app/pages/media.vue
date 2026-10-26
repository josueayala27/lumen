<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog'
import { Icon } from '#components'
import { css } from 'styled-system/css'
import { computed, onMounted, ref } from 'vue'
import { isTauri } from '~/data/db'
import {
  deleteMediaAsset,
  formatMediaDuration,
  importMediaFile,
  listMediaAssets,
  mediaThumbnail,
  relinkMediaAsset,
  type MediaAsset,
} from '~/data/media'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  SegmentedControl,
  formatBytes,
  type SegmentOption,
} from '~/ui'

type View = 'grid' | 'list'

const items = ref<MediaAsset[]>([])
const view = ref<View>('grid')
const loading = ref(true)
const importing = ref(false)
const relinking = ref<string | null>(null)
const error = ref('')
const thumbs = ref<Record<string, string>>({})

const viewOptions: SegmentOption<View>[] = [
  { value: 'grid', label: 'Grid', icon: 'lucide:layout-grid' },
  { value: 'list', label: 'List', icon: 'lucide:list' },
]

const missingCount = computed(() => items.value.filter((asset) => asset.missing).length)

function iconFor(asset: MediaAsset): string {
  if (asset.kind === 'video') return 'lucide:film'
  if (asset.kind === 'audio') return 'lucide:audio-lines'
  return 'lucide:image'
}

function metaLine(asset: MediaAsset): string {
  const parts = [asset.kind === 'image' ? 'Image' : asset.kind === 'video' ? 'Video' : 'Audio']
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`)
  const duration = formatMediaDuration(asset.durationMs)
  if (duration) parts.push(duration)
  parts.push(formatBytes(asset.size))
  return parts.join(' · ')
}

async function loadThumbnails(assets: MediaAsset[]): Promise<void> {
  const next: Record<string, string> = {}
  await Promise.all(
    assets.map(async (asset) => {
      const thumbnail = await mediaThumbnail(asset)
      if (thumbnail) next[asset.localPath] = thumbnail
    }),
  )
  thumbs.value = next
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    items.value = await listMediaAssets()
    void loadThumbnails(items.value)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function importSelected(): Promise<void> {
  if (!isTauri()) {
    error.value = 'Media import requires the desktop app.'
    return
  }
  error.value = ''
  importing.value = true
  try {
    const selection = await open({
      multiple: true,
      directory: false,
      title: 'Import media',
      filters: [
        {
          name: 'Media',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'm4v', 'mov', 'webm'],
        },
      ],
    })
    if (!selection) return
    const paths = Array.isArray(selection) ? selection : [selection]
    for (const path of paths) await importMediaFile(path)
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    importing.value = false
  }
}

async function relink(asset: MediaAsset): Promise<void> {
  if (!isTauri()) {
    error.value = 'Relinking media requires the desktop app.'
    return
  }
  error.value = ''
  try {
    const selection = await open({
      multiple: false,
      directory: false,
      title: `Relink "${asset.name}"`,
      filters: [
        {
          name: 'Media',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'm4v', 'mov', 'webm'],
        },
      ],
    })
    if (!selection || Array.isArray(selection)) return
    relinking.value = asset.id
    await relinkMediaAsset(asset.id, selection)
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    relinking.value = null
  }
}

async function remove(asset: MediaAsset): Promise<void> {
  if (typeof window !== 'undefined' && !window.confirm(`Delete "${asset.name}"?`)) return
  error.value = ''
  try {
    await deleteMediaAsset(asset.id)
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

onMounted(() => void load())

const page = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', px: '6', py: '5' })
const header = css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '4', mb: '4' })
const eyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const titleRow = css({ display: 'flex', alignItems: 'center', gap: '2' })
const title = css({ textStyle: 'display.md', color: 'fg.default' })
const subtitle = css({ mt: '1', textStyle: 'ui.sm', color: 'fg.muted' })
const actions = css({ display: 'flex', alignItems: 'center', gap: '2', flexShrink: '0' })
const errorText = css({ mb: '3', textStyle: 'ui.sm', color: 'danger.default' })
const loadingText = css({ p: '4', textStyle: 'ui.sm', color: 'fg.muted' })
const body = css({ flex: '1', minH: '0', overflowY: 'auto' })
const grid = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '3',
  alignContent: 'start',
})
const list = css({ display: 'flex', flexDirection: 'column', gap: '2' })
const card = css({
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 'md',
  bg: 'bg.panel',
  borderWidth: '1px',
  borderColor: 'border.default',
  transitionProperty: 'border-color',
  transitionDuration: 'fast',
  _hover: { borderColor: 'accent.default' },
})
const row = css({
  display: 'flex',
  alignItems: 'center',
  gap: '3',
  p: '2',
  pr: '3',
  borderRadius: 'md',
  bg: 'bg.panel',
  borderWidth: '1px',
  borderColor: 'border.default',
  transitionProperty: 'border-color',
  transitionDuration: 'fast',
  _hover: { borderColor: 'accent.default' },
})
const missingItem = css({ borderColor: 'danger.default' })
const thumb = css({
  position: 'relative',
  aspectRatio: 'video',
  display: 'grid',
  placeItems: 'center',
  overflow: 'hidden',
  bg: 'bg.canvas',
  borderBottomWidth: '1px',
  borderColor: 'border.default',
})
const rowThumb = css({
  position: 'relative',
  w: '[96px]',
  flexShrink: '0',
  aspectRatio: 'video',
  display: 'grid',
  placeItems: 'center',
  overflow: 'hidden',
  borderRadius: 'sm',
  bg: 'bg.canvas',
})
const thumbImage = css({ w: 'full', h: 'full', objectFit: 'contain' })
const thumbFallback = css({ display: 'grid', placeItems: 'center', w: 'full', h: 'full', color: 'fg.subtle' })
const missingBadge = css({ position: 'absolute', top: '2', left: '2' })
const cardBody = css({ display: 'flex', alignItems: 'center', gap: '2', p: '3' })
const rowBody = css({ display: 'flex', alignItems: 'center', gap: '3', flex: '1', minW: '0' })
const itemText = css({ flex: '1', minW: '0' })
const itemName = css({ textStyle: 'ui.sm', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const itemMeta = css({ mt: '0.5', textStyle: 'ui.xs', color: 'fg.subtle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
</script>

<template>
  <div :class="page">
    <header :class="header">
      <div>
        <p :class="eyebrow">Library</p>
        <div :class="titleRow">
          <h1 :class="title">Media</h1>
          <Badge tone="neutral">{{ items.length }}</Badge>
          <Badge v-if="missingCount" tone="danger" dot>{{ missingCount }} missing</Badge>
        </div>
        <p :class="subtitle">Images and video copied into the app-managed media folder.</p>
      </div>
      <div :class="actions">
        <SegmentedControl v-model="view" :options="viewOptions" aria-label="Media view" :fill="false" />
        <Button variant="primary" icon="lucide:plus" :loading="importing" @click="importSelected">
          Import media
        </Button>
      </div>
    </header>

    <p v-if="error" :class="errorText">{{ error }}</p>
    <p v-if="loading" :class="loadingText">Loading media…</p>

    <div v-else-if="items.length" :class="body">
      <div :class="view === 'grid' ? grid : list">
        <div
          v-for="asset in items"
          :key="asset.id"
          :class="[view === 'grid' ? card : row, asset.missing ? missingItem : '']"
        >
          <div :class="view === 'grid' ? thumb : rowThumb">
            <img
              v-if="thumbs[asset.localPath]"
              :src="thumbs[asset.localPath]"
              alt=""
              :class="thumbImage"
            />
            <span v-else :class="thumbFallback">
              <Icon :name="iconFor(asset)" :size="view === 'grid' ? 26 : 18" />
            </span>
            <Badge v-if="asset.missing" tone="danger" icon="lucide:file-x" :class="missingBadge">
              Missing
            </Badge>
          </div>
          <div :class="view === 'grid' ? cardBody : rowBody">
            <div :class="itemText">
              <p :class="itemName">{{ asset.name }}</p>
              <p :class="itemMeta">{{ metaLine(asset) }}</p>
            </div>
            <IconButton
              v-if="asset.missing"
              icon="lucide:link"
              label="Relink media"
              size="sm"
              :disabled="relinking === asset.id"
              @click.stop="relink(asset)"
            />
            <IconButton
              icon="lucide:trash-2"
              label="Delete media"
              size="sm"
              @click.stop="remove(asset)"
            />
          </div>
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      icon="lucide:image"
      title="No media yet"
      description="Import images or video. Files are copied into Lumen's local media folder."
    >
      <template #actions>
        <Button variant="primary" icon="lucide:plus" @click="importSelected">Import media</Button>
      </template>
    </EmptyState>
  </div>
</template>
