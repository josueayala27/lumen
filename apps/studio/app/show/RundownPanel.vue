<script setup lang="ts">
import { css, cx } from 'styled-system/css'
import { Icon } from '#components'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listPlaylists, type PlaylistSummary } from '~/data/playlists'
import type { LiveItem } from '~/live/liveSession'
import { Button, EmptyState, Select, type SelectOption } from '~/ui'
import { useShowLive } from './useShowLive'

/**
 * The active rundown: pick one, pick an item, then a slide. Clicking a slide
 * previews it; double-click (or Enter) takes it to the content layer.
 */
const emit = defineEmits<{ select: [playlistId: string] }>()

const router = useRouter()
const live = useShowLive()
const session = live.session
const state = session.state
const playlists = ref<PlaylistSummary[]>([])

const SINGLE = '__single__'
const options = computed<SelectOption<string>[]>(() => {
  const list = playlists.value.map((entry) => ({ value: entry.id, label: entry.name || 'Untitled rundown' }))
  const single = session.presentation.value
  return single ? [{ value: SINGLE, label: `${single.doc.title} (single)` }, ...list] : list
})
const selected = computed(() => session.playlist.value?.id ?? (session.presentation.value ? SINGLE : undefined))
const selectedItemIndex = computed(() => state.value.previewItemIndex)
const selectedItem = computed(() => session.items.value[selectedItemIndex.value] ?? null)
const empty = computed(() => !session.loading.value && session.items.value.length === 0)

onMounted(async () => {
  try {
    playlists.value = await listPlaylists()
  } catch {
    playlists.value = []
  }
})

function onSelect(id: string | undefined): void {
  if (id && id !== SINGLE && id !== selected.value) emit('select', id)
}

function iconFor(item: LiveItem): string {
  if (item.kind === 'media') return 'lucide:film'
  if (item.kind === 'header') return 'lucide:heading'
  return item.presentationKind === 'song' ? 'lucide:music' : 'lucide:presentation'
}

function pickItem(itemIndex: number): void {
  session.goTo(itemIndex, 0)
}

function pickSlide(slideIndex: number): void {
  session.goTo(selectedItemIndex.value, slideIndex)
}

function takeSlide(slideIndex: number): void {
  session.goTo(selectedItemIndex.value, slideIndex)
  session.take()
}

/** The item on air in this rundown; none while a slide from elsewhere is held on air. */
const liveItemIndex = computed(() => (session.held.value ? -1 : state.value.itemIndex))

function isLiveSlide(slideIndex: number): boolean {
  return liveItemIndex.value === selectedItemIndex.value && state.value.slideIndex === slideIndex
}

const root = css({ display: 'flex', flexDirection: 'column', minH: '0', h: 'full' })
const head = css({ display: 'flex', flexDirection: 'column', gap: '2', p: '3', borderBottomWidth: '1px', borderColor: 'border.default' })
const eyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase' })
const meta = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const list = css({ display: 'flex', flexDirection: 'column', gap: '0.5', p: '2', overflowY: 'auto' })
const items = css({ flexShrink: '0', maxH: '[40%]', borderBottomWidth: '1px', borderColor: 'border.default' })
const slides = css({ flex: '1', minH: '0' })
const groupTitle = css({ px: '2', pt: '1', pb: '1', textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase' })
const row = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2.5',
  px: '2',
  py: '1.5',
  borderRadius: 'sm',
  cursor: 'pointer',
  color: 'fg.muted',
  textAlign: 'left',
  borderLeftWidth: '2px',
  borderColor: 'transparent',
  _hover: { bg: 'bg.hover', color: 'fg.default' },
})
const rowSelected = css({ bg: 'bg.subtle', color: 'fg.default', borderColor: 'accent.default' })
const rowLive = css({ bg: 'live.muted', color: 'fg.default', borderColor: 'live.default' })
const index = css({ w: '5', textStyle: 'ui.mono', color: 'fg.subtle', flexShrink: '0' })
const rowLabel = css({ flex: '1', minW: '0', textStyle: 'ui.sm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const slideLines = css({ display: 'block', textStyle: 'ui.xs', color: 'fg.subtle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
</script>

<template>
  <section :class="root" aria-label="Rundown">
    <div :class="head">
      <p :class="eyebrow">Rundown</p>
      <Select
        :model-value="selected"
        :options="options"
        placeholder="Pick a rundown"
        size="sm"
        aria-label="Rundown"
        @update:model-value="onSelect"
      />
      <p :class="meta">
        <template v-if="session.loading.value">Loading…</template>
        <template v-else>{{ session.items.value.length }} items · {{ session.slideCount.value }} slides</template>
      </p>
    </div>

    <EmptyState
      v-if="empty"
      size="sm"
      icon="lucide:list-music"
      title="Nothing to run yet"
      description="Build a rundown, then open it here."
    >
      <template #actions>
        <Button variant="primary" size="sm" icon="lucide:plus" @click="router.push('/rundowns')">Create rundown</Button>
      </template>
    </EmptyState>

    <template v-else>
      <div :class="cx(list, items)">
        <button
          v-for="(item, itemIndex) in session.items.value"
          :key="item.id"
          type="button"
          :class="cx(row, liveItemIndex === itemIndex ? rowLive : selectedItemIndex === itemIndex && rowSelected)"
          @click="pickItem(itemIndex)"
        >
          <span :class="index">{{ String(itemIndex + 1).padStart(2, '0') }}</span>
          <Icon :name="iconFor(item)" :size="14" aria-hidden="true" />
          <span :class="rowLabel">{{ item.label }}</span>
          <Icon v-if="liveItemIndex === itemIndex" name="lucide:radio" :size="12" aria-label="On air" />
        </button>
      </div>

      <div :class="cx(list, slides)">
        <p v-if="selectedItem" :class="groupTitle">{{ selectedItem.label }}</p>
        <button
          v-for="(slide, slideIndex) in selectedItem?.slides ?? []"
          :key="slide.id"
          type="button"
          :class="cx(row, isLiveSlide(slideIndex) ? rowLive : state.previewSlideIndex === slideIndex && rowSelected)"
          :title="slide.lines.join('\n')"
          @click="pickSlide(slideIndex)"
          @dblclick="takeSlide(slideIndex)"
        >
          <span :class="index">{{ String(slideIndex + 1).padStart(2, '0') }}</span>
          <span :class="rowLabel">
            {{ slide.label }}
            <span :class="slideLines">{{ slide.lines.join(' / ') }}</span>
          </span>
          <Icon v-if="isLiveSlide(slideIndex)" name="lucide:radio" :size="12" aria-label="On air" />
        </button>
      </div>
    </template>
  </section>
</template>
