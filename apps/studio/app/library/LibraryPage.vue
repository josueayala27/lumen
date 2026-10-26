<script setup lang="ts">
import { buildBlankPresentation, buildSongDoc } from '@lumen/core'
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, EmptyState, IconButton, Input, Select, Tabs, type SelectOption } from '~/ui'
import ErrorNotice from './ErrorNotice.vue'
import PageHeader from './PageHeader.vue'
import SkeletonGrid from './SkeletonGrid.vue'
import {
  createPresentation,
  listPresentations,
  updatedLabel,
  type PresentationSummary,
} from '~/data/presentations'

type Filter = 'all' | 'presentations' | 'songs'

const props = withDefaults(defineProps<{ initialFilter?: Filter }>(), { initialFilter: 'all' })

const router = useRouter()
const filter = ref<Filter>(props.initialFilter)
const items = ref<PresentationSummary[]>([])
const loading = ref(true)
const error = ref('')

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'presentations', label: 'Presentations' },
  { value: 'songs', label: 'Songs' },
]

type Sort = 'recent' | 'title' | 'slides'
const query = ref('')
const sort = ref<Sort>('recent')
const sortOptions: SelectOption<Sort>[] = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'slides', label: 'Most slides' },
]

const inKind = computed(() => {
  if (filter.value === 'all') return items.value
  const kind = filter.value === 'songs' ? 'song' : 'presentation'
  return items.value.filter((item) => item.kind === kind)
})
const visible = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const matched = needle
    ? inKind.value.filter((item) => item.title.toLowerCase().includes(needle))
    : [...inKind.value]
  if (sort.value === 'title') matched.sort((a, b) => a.title.localeCompare(b.title))
  else if (sort.value === 'slides') matched.sort((a, b) => b.slideCount - a.slideCount)
  else matched.sort((a, b) => b.updatedAt - a.updatedAt)
  return matched
})
const searching = computed(() => query.value.trim().length > 0)
const resultLabel = computed(() => {
  const total = inKind.value.length
  const noun = filter.value === 'songs' ? 'song' : filter.value === 'presentations' ? 'presentation' : 'item'
  const plural = (n: number): string => `${n} ${noun}${n === 1 ? '' : 's'}`
  return searching.value ? `${visible.value.length} of ${plural(total)}` : plural(total)
})
const totalSlides = computed(() => items.value.reduce((sum, item) => sum + item.slideCount, 0))
const presentationCount = computed(() => items.value.filter((item) => item.kind === 'presentation').length)
const songCount = computed(() => items.value.filter((item) => item.kind === 'song').length)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    items.value = await listPresentations()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function newPresentation(): Promise<void> {
  try {
    const record = await createPresentation(buildBlankPresentation())
    await router.push(`/editor/${record.id}`)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function newSong(): Promise<void> {
  try {
    const doc = buildSongDoc({
      title: 'Untitled song',
      author: '',
      ccli: '',
      key: '',
      tempo: null,
      lyrics: '[Verse 1]\n',
    })
    const record = await createPresentation(doc)
    await router.push(`/editor/${record.id}`)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function open(id: string): void {
  void router.push(`/editor/${id}`)
}

function toneFor(index: number): 'graphite' | 'ember' | 'blaze' | 'dawn' {
  return (['graphite', 'ember', 'blaze', 'dawn'] as const)[index % 4]!
}

onMounted(load)

const root = css({ display: 'flex', h: 'full', minH: '0' })
const content = css({ flex: '1', minW: '0', h: 'full', overflowY: 'auto', px: '6', py: '5' })
const searchBox = css({ w: '[260px]' })
const sortBox = css({ w: '[180px]' })
const resultCount = css({ textStyle: 'ui.xs', color: 'fg.subtle', whiteSpace: 'nowrap' })
const inspector = css({ w: 'inspector', flexShrink: '0', h: 'full', overflowY: 'auto', bg: 'bg.panel', borderLeftWidth: '1px', borderColor: 'border.default', px: '4', py: '4' })
const filtersRow = css({ display: 'flex', alignItems: 'center', gap: '2', mb: '4' })
const grid = css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '3' })
const card = css({
  position: 'relative',
  _focusVisible: { borderColor: 'accent.default' },
  _active: { transform: 'translateY(0)' },
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 'md',
  bg: 'bg.panel',
  borderWidth: '1px',
  borderColor: 'border.default',
  cursor: 'pointer',
  textAlign: 'left',
  transitionProperty: 'border-color, transform, background',
  transitionDuration: 'normal',
  transitionTimingFunction: 'standard',
  _hover: { borderColor: 'accent.default', transform: 'translateY(-1px)' },
})
const thumb = css({ position: 'relative', aspectRatio: 'video', borderBottomWidth: '1px', borderColor: 'border.default' })
const tone = {
  graphite: css({ background: '[token(gradients.graphite)]' }),
  ember: css({ background: '[token(gradients.ember)]' }),
  blaze: css({ background: '[token(gradients.blaze)]' }),
  dawn: css({ background: '[token(gradients.dawn)]' }),
}
const kindBadge = css({
  position: 'absolute',
  top: '2',
  left: '2',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  h: '5',
  px: '1.5',
  borderRadius: 'full',
  bg: 'bg.app/70',
  color: 'fg.default',
  textStyle: 'ui.xs',
  backdropFilter: '[blur(8px)]',
})
const slideCount = css({ position: 'absolute', right: '2', bottom: '2', textStyle: 'ui.mono', color: 'fg.muted' })
const cardBody = css({ display: 'flex', flexDirection: 'column', gap: '1', p: '3' })
const cardTitle = css({ textStyle: 'ui.title', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const cardMeta = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const inspectorTitle = css({ textStyle: 'ui.title', color: 'fg.default', mb: '3' })
const stat = css({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', py: '2.5', borderBottomWidth: '1px', borderColor: 'border.default' })
const statLabel = css({ textStyle: 'ui.sm', color: 'fg.muted' })
const statValue = css({ textStyle: 'ui.title', color: 'fg.default' })
const cardBox = css({ mt: '4', p: '3', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default' })
const boxTitle = css({ display: 'flex', alignItems: 'center', gap: '2', textStyle: 'ui.sm', color: 'fg.default', mb: '2' })
const boxText = css({ textStyle: 'ui.xs', color: 'fg.muted', lineHeight: 'normal' })
const liveDot = css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: 'success.default' })
const emptyWrap = css({ gridColumn: '1 / -1', py: '12' })
const hintList = css({ display: 'flex', flexDirection: 'column', gap: '2', mt: '3', textStyle: 'ui.sm', color: 'fg.muted', lineHeight: 'normal' })
</script>

<template>
  <div :class="root">
    <section :class="content">
      <PageHeader
        eyebrow="Riverside Church"
        title="Library"
        subtitle="Create a song from lyrics or start a blank presentation."
      >
        <template #actions>
          <Button variant="secondary" size="md" icon="lucide:music" @click="newSong">New song</Button>
          <Button variant="primary" size="md" icon="lucide:plus" @click="newPresentation">New presentation</Button>
        </template>
      </PageHeader>

      <div :class="filtersRow">
        <Tabs v-model="filter" :tabs="filters" size="sm" />
        <span :class="css({ flex: '1' })" />
        <span v-if="!loading && items.length" :class="resultCount" aria-live="polite">{{ resultLabel }}</span>
        <Input
          v-if="items.length"
          v-model="query"
          live
          type="search"
          size="md"
          placeholder="Search title"
          aria-label="Search library"
          :class="searchBox"
        >
          <template #prefix><Icon name="lucide:search" :size="14" aria-hidden="true" /></template>
        </Input>
        <Select v-if="items.length" v-model="sort" :options="sortOptions" aria-label="Sort library" :class="sortBox" />
        <IconButton icon="lucide:refresh-cw" label="Refresh" size="md" @click="load" />
      </div>

      <ErrorNotice v-if="error" :message="error" title="Library action failed" @retry="load" @dismiss="error = ''" />
      <SkeletonGrid v-if="loading" :count="8" min="240px" height="190px" label="Loading library" />
      <div v-else :class="grid">
        <button
          v-for="(item, index) in visible"
          :key="item.id"
          type="button"
          :class="card"
          @click="open(item.id)"
        >
          <div :class="[thumb, tone[toneFor(index)]]">
            <span :class="kindBadge">
              <Icon :name="item.kind === 'song' ? 'lucide:music' : 'lucide:presentation'" :size="11" />
              {{ item.kind === 'song' ? 'Song' : 'Slides' }}
            </span>
            <span :class="slideCount">{{ item.slideCount }} {{ item.slideCount === 1 ? 'slide' : 'slides' }}</span>
          </div>
          <div :class="cardBody">
            <h2 :class="cardTitle">{{ item.title }}</h2>
            <p :class="cardMeta">Updated {{ updatedLabel(item.updatedAt) }}</p>
          </div>
        </button>
        <EmptyState
          v-if="visible.length === 0 && searching"
          :class="emptyWrap"
          icon="lucide:search-x"
          :title="`No results for “${query.trim()}”`"
          description="Check the spelling or try another filter."
        >
          <template #actions>
            <Button variant="secondary" icon="lucide:x" @click="query = ''">Clear search</Button>
          </template>
        </EmptyState>
        <EmptyState
          v-else-if="visible.length === 0"
          :class="emptyWrap"
          :icon="filter === 'songs' ? 'lucide:music' : 'lucide:presentation'"
          :title="filter === 'songs' ? 'No songs yet' : filter === 'presentations' ? 'No presentations yet' : 'Your library is empty'"
          :description="filter === 'songs' ? 'Paste lyrics and Lumen splits them into slides.' : 'Start a song from lyrics or a blank presentation. Everything is saved on this machine.'"
        >
          <template #actions>
            <Button v-if="filter !== 'presentations'" variant="secondary" icon="lucide:music" @click="newSong">New song</Button>
            <Button v-if="filter !== 'songs'" variant="primary" icon="lucide:plus" @click="newPresentation">New presentation</Button>
          </template>
        </EmptyState>
      </div>
    </section>

    <aside :class="inspector" aria-label="Library inspector">
      <template v-if="items.length">
        <h2 :class="inspectorTitle">Library status</h2>
        <div :class="stat"><span :class="statLabel">Presentations</span><span :class="statValue">{{ presentationCount }}</span></div>
        <div :class="stat"><span :class="statLabel">Songs</span><span :class="statValue">{{ songCount }}</span></div>
        <div :class="stat"><span :class="statLabel">Slides</span><span :class="statValue">{{ totalSlides }}</span></div>
      </template>
      <template v-else-if="!loading">
        <h2 :class="inspectorTitle">Getting started</h2>
        <ol :class="hintList">
          <li>1. Create a song or presentation.</li>
          <li>2. Add it to a playlist.</li>
          <li>3. Open the playlist live.</li>
        </ol>
      </template>
      <div :class="cardBox">
        <p :class="boxTitle"><span :class="liveDot" />Local library</p>
        <p :class="boxText">Saved on this machine. Cloud sync and media upload arrive after the local editor is solid.</p>
      </div>
      <div :class="cardBox">
        <p :class="boxTitle"><Icon name="lucide:keyboard" :size="14" />Shortcuts</p>
        <p :class="boxText">Space next slide · B black · C clear · L logo · F freeze</p>
      </div>
    </aside>
  </div>
</template>
