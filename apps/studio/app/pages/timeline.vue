<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { onMounted, ref } from 'vue'
import { updatedLabel } from '~/data/presentations'
import {
  createTimeline,
  deleteTimeline,
  getTimeline,
  listTimelines,
  type TimelineRecord,
  type TimelineSummary,
} from '~/data/timelines'
import TimelineEditor from '~/timeline/TimelineEditor.vue'
import { timecodeLabel } from '~/timeline/lib'
import { Badge, Button, EmptyState, IconButton } from '~/ui'

const items = ref<TimelineSummary[]>([])
const active = ref<TimelineRecord | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')

async function load(): Promise<void> {
  error.value = ''
  try {
    items.value = await listTimelines()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function open(id: string): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    active.value = await getTimeline(id)
    if (!active.value) error.value = 'Timeline not found.'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}

async function create(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const record = await createTimeline()
    active.value = record
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}

async function remove(item: TimelineSummary): Promise<void> {
  if (typeof window !== 'undefined' && !window.confirm(`Delete timeline "${item.name}"?`)) return
  busy.value = true
  error.value = ''
  try {
    await deleteTimeline(item.id)
    if (active.value?.id === item.id) active.value = null
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}

function closeEditor(): void {
  active.value = null
  void load()
}

function onSaved(record: TimelineRecord): void {
  active.value = record
  void load()
}

function metaLine(item: TimelineSummary): string {
  return `${item.frameRate} fps · ${timecodeLabel(item.durationFrames, item.frameRate)} · ${item.trackCount} tracks · ${item.clipCount} clips`
}

onMounted(() => void load())

const page = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', px: '6', py: '5' })
const header = css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '4', mb: '4' })
const eyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const titleRow = css({ display: 'flex', alignItems: 'center', gap: '2' })
const title = css({ textStyle: 'display.md', color: 'fg.default' })
const subtitle = css({ mt: '1', textStyle: 'ui.sm', color: 'fg.muted' })
const errorText = css({ mb: '3', textStyle: 'ui.sm', color: 'danger.default' })
const loadingText = css({ p: '4', textStyle: 'ui.sm', color: 'fg.muted' })
const body = css({ flex: '1', minH: '0', overflowY: 'auto' })
const grid = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: '3',
  alignContent: 'start',
})
const card = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '3',
  p: '3.5',
  borderRadius: 'md',
  bg: 'bg.panel',
  borderWidth: '1px',
  borderColor: 'border.default',
  cursor: 'pointer',
  transitionProperty: 'border-color, background-color',
  transitionDuration: 'fast',
  transitionTimingFunction: 'standard',
  _hover: { borderColor: 'accent.default', bg: 'bg.subtle' },
  _focusVisible: { outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'accent.default', outlineOffset: '[1px]' },
})
const cardTop = css({ display: 'flex', alignItems: 'center', gap: '2.5', minW: '0' })
const mark = css({ display: 'grid', placeItems: 'center', w: '8', h: '8', flexShrink: '0', borderRadius: 'sm', bg: 'accent.muted', color: 'accent.default' })
const cardName = css({ flex: '1', minW: '0', textStyle: 'ui.md', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const meta = css({ textStyle: 'ui.xs', color: 'fg.muted' })
const cardBottom = css({ display: 'flex', alignItems: 'center', gap: '2' })
const updated = css({ flex: '1', textStyle: 'ui.xs', color: 'fg.subtle' })
</script>

<template>
  <TimelineEditor
    v-if="active"
    :record="active"
    @close="closeEditor"
    @saved="onSaved"
  />

  <div v-else :class="page">
    <header :class="header">
      <div>
        <p :class="eyebrow">Library</p>
        <div :class="titleRow">
          <h1 :class="title">Timelines</h1>
          <Badge tone="neutral">{{ items.length }}</Badge>
        </div>
        <p :class="subtitle">
          Build a show timeline from slide, media, audio and macro clips. Frames, clip edges and markers snap.
        </p>
      </div>
      <Button variant="primary" icon="lucide:plus" :loading="busy" @click="create">
        New timeline
      </Button>
    </header>

    <p v-if="error" :class="errorText">{{ error }}</p>
    <p v-if="loading" :class="loadingText">Loading timelines…</p>

    <div v-else-if="items.length" :class="body">
      <div :class="grid">
        <div
          v-for="item in items"
          :key="item.id"
          :class="card"
          @click="open(item.id)"
        >
          <div :class="cardTop">
            <span :class="mark"><Icon name="lucide:film" :size="15" aria-hidden="true" /></span>
            <span :class="cardName">{{ item.name }}</span>
            <Badge tone="info" :label="item.frameRate" />
          </div>
          <p :class="meta">{{ metaLine(item) }}</p>
          <div :class="cardBottom">
            <span :class="updated">Updated {{ updatedLabel(item.updatedAt) }}</span>
            <IconButton
              icon="lucide:trash-2"
              label="Delete timeline"
              size="sm"
              @click.stop="remove(item)"
            />
            <Button variant="secondary" size="sm" icon="lucide:arrow-right" @click.stop="open(item.id)">
              Open
            </Button>
          </div>
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      icon="lucide:clapperboard"
      title="No timelines yet"
      description="Create a timeline to lay out slides, media, audio and macro cues on one track sheet."
    >
      <template #actions>
        <Button variant="primary" icon="lucide:plus" @click="create">New timeline</Button>
      </template>
    </EmptyState>
  </div>
</template>
