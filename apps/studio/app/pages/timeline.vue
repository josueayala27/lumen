<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { updatedLabel } from '~/data/presentations'
import {
  createTimeline,
  deleteTimeline,
  getTimeline,
  listTimelines,
  saveTimeline,
  type TimelineRecord,
  type TimelineSummary,
} from '~/data/timelines'
import TimelineEditor from '~/timeline/TimelineEditor.vue'
import { importTimelineJson, timecodeLabel } from '~/timeline/lib'
import { Badge, Button, EmptyState, IconButton, Input } from '~/ui'
import ErrorNotice from '~/library/ErrorNotice.vue'
import PageHeader from '~/library/PageHeader.vue'
import SkeletonGrid from '~/library/SkeletonGrid.vue'
import { computed } from 'vue'

const items = ref<TimelineSummary[]>([])
const active = ref<TimelineRecord | null>(null)
const loading = ref(true)
const busy = ref(false)
const query = ref('')
const visibleItems = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return needle ? items.value.filter((item) => item.name.toLowerCase().includes(needle)) : items.value
})
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

const route = useRoute()
const fileInput = ref<HTMLInputElement | null>(null)

async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  error.value = ''
  try {
    const doc = importTimelineJson(await file.text())
    const now = Date.now()
    const record: TimelineRecord = { id: doc.id, doc, createdAt: now, updatedAt: now }
    await saveTimeline(record)
    active.value = record
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await load()
  const id = typeof route.query.id === 'string' ? route.query.id : ''
  if (id) await open(id)
})

const page = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', px: '6', py: '5' })
const toolbar = css({ display: 'flex', alignItems: 'center', gap: '2', mb: '4' })
const searchBox = css({ w: '[260px]' })
const count = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const noMatch = css({ flex: '1' })
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
    <PageHeader
      eyebrow="Library"
      title="Timelines"
      subtitle="Build a show timeline from slide, media, audio and macro clips. Frames, clip edges and markers snap."
    >
      <template #badges><Badge tone="neutral">{{ items.length }}</Badge></template>
      <template #actions>
        <Button variant="secondary" icon="lucide:upload" :disabled="busy" @click="fileInput?.click()">Import JSON</Button>
        <Button variant="primary" icon="lucide:plus" :loading="busy" @click="create">New timeline</Button>
      </template>
    </PageHeader>
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      hidden
      aria-hidden="true"
      tabindex="-1"
      @change="importFile"
    />

    <div v-if="items.length" :class="toolbar">
      <Input v-model="query" live type="search" size="md" placeholder="Search timelines" aria-label="Search timelines" :class="searchBox">
        <template #prefix><Icon name="lucide:search" :size="14" aria-hidden="true" /></template>
      </Input>
      <span :class="count" aria-live="polite">{{ query.trim() ? `${visibleItems.length} of ${items.length}` : `${items.length} ${items.length === 1 ? 'timeline' : 'timelines'}` }}</span>
    </div>

    <ErrorNotice v-if="error" :message="error" title="Timeline error" @retry="load" @dismiss="error = ''" />
    <SkeletonGrid v-if="loading" :count="6" min="280px" height="118px" label="Loading timelines" />

    <EmptyState
      v-else-if="items.length && !visibleItems.length"
      :class="noMatch"
      icon="lucide:search-x"
      title="No timelines match"
      :description="`Nothing matches “${query.trim()}”.`"
    >
      <template #actions>
        <Button variant="secondary" icon="lucide:x" @click="query = ''">Clear search</Button>
      </template>
    </EmptyState>

    <div v-else-if="items.length" :class="body">
      <div :class="grid">
        <div
          v-for="item in visibleItems"
          :key="item.id"
          :class="card"
          tabindex="0"
          role="button"
          :aria-label="`Open timeline ${item.name}`"
          @click="open(item.id)"
          @keydown.enter.self="open(item.id)"
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
