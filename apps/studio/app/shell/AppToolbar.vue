<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon, NuxtLink } from '#components'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Badge, Button, IconButton, Input, Kbd, Tooltip, matchesShortcut } from '~/ui'
import { useShellStats } from './useShellStats'

interface SearchHit {
  key: string
  label: string
  detail: string
  icon: string
  to: string
}

const route = useRoute()
const router = useRouter()
const { presentations, playlists, media, loaded, refresh } = useShellStats()

const search = ref('')
const open = ref(false)
const active = ref(0)
const searchWrap = ref<HTMLElement | null>(null)
const online = ref(true)

const hits = computed<SearchHit[]>(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return []
  const out: SearchHit[] = []
  for (const item of presentations.value) {
    if (!item.title.toLowerCase().includes(term)) continue
    const song = item.kind === 'song'
    out.push({
      key: `p-${item.id}`,
      label: item.title,
      detail: song ? 'Song' : 'Presentation',
      icon: song ? 'lucide:music' : 'lucide:presentation',
      to: `/editor/${item.id}`,
    })
  }
  for (const item of playlists.value) {
    if (item.name.toLowerCase().includes(term)) {
      out.push({ key: `l-${item.id}`, label: item.name, detail: 'Playlist', icon: 'lucide:list-music', to: '/playlists' })
    }
  }
  for (const item of media.value) {
    if (item.name.toLowerCase().includes(term)) {
      out.push({ key: `m-${item.id}`, label: item.name, detail: 'Media', icon: 'lucide:image', to: '/media' })
    }
  }
  return out.slice(0, 8)
})

const showResults = computed(() => open.value && search.value.trim().length > 0)

watch(hits, () => (active.value = 0))

function inputEl(): HTMLInputElement | null {
  return searchWrap.value?.querySelector('input') ?? null
}

function choose(hit: SearchHit | undefined): void {
  if (!hit) return
  open.value = false
  search.value = ''
  inputEl()?.blur()
  void router.push(hit.to)
}

function onSearchKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' && hits.value.length) {
    event.preventDefault()
    active.value = (active.value + 1) % hits.value.length
  } else if (event.key === 'ArrowUp' && hits.value.length) {
    event.preventDefault()
    active.value = (active.value - 1 + hits.value.length) % hits.value.length
  } else if (event.key === 'Enter') {
    choose(hits.value[active.value])
  } else if (event.key === 'Escape') {
    open.value = false
    search.value = ''
    inputEl()?.blur()
  }
}

function onGlobalKey(event: KeyboardEvent): void {
  if (matchesShortcut(event, 'Mod+K')) {
    event.preventDefault()
    const el = inputEl()
    el?.focus()
    el?.select()
  }
}

function onFocusOut(event: FocusEvent): void {
  if (!searchWrap.value?.contains(event.relatedTarget as Node | null)) open.value = false
}

function syncOnline(): void {
  online.value = navigator.onLine
}

onMounted(() => {
  if (!loaded.value) void refresh()
  syncOnline()
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('online', syncOnline)
  window.addEventListener('offline', syncOnline)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('online', syncOnline)
  window.removeEventListener('offline', syncOnline)
})

// Go Live opens the most recently edited playlist; without one there is nothing to run.
const latestPlaylist = computed(() => playlists.value[0])
const onLive = computed(() => route.path === '/live')
const goLiveTo = computed(() => (latestPlaylist.value ? `/live?playlist=${latestPlaylist.value.id}` : '/live'))
const goLiveHint = computed(() =>
  latestPlaylist.value ? `Open "${latestPlaylist.value.name}" live` : 'Create a playlist to go live',
)

const root = css({
  display: 'flex',
  alignItems: 'center',
  gap: '3',
  h: 'toolbar',
  px: '3',
  flexShrink: '0',
  bg: 'bg.panel',
  borderBottomWidth: '1px',
  borderColor: 'border.default',
})
const brand = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  borderRadius: 'sm',
  _focusVisible: { outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'accent.default', outlineOffset: '[2px]' },
})
const mark = css({
  display: 'grid',
  placeItems: 'center',
  w: '6',
  h: '6',
  borderRadius: 'sm',
  background: '[token(gradients.sheen), token(colors.accent.default)]',
  color: 'fg.onAccent',
  textStyle: 'ui.xs',
  fontWeight: 'bold',
  letterSpacing: 'tight',
})
const wordmark = css({ textStyle: 'ui.title', color: 'fg.default' })
const spacer = css({ flex: '1' })
const searchWrapCss = css({ position: 'relative', w: '[320px]', maxW: '[34vw]' })
const results = css({
  position: 'absolute',
  top: '[100%]',
  left: '0',
  right: '0',
  mt: '1',
  zIndex: '[100]',
  p: '1',
  borderRadius: 'md',
  borderWidth: '1px',
  borderColor: 'border.default',
  bg: 'bg.panel',
  boxShadow: '[0 8px 24px rgba(0,0,0,0.35)]',
})
const resultRow = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  h: 'control.lg',
  px: '2',
  borderRadius: 'sm',
  color: 'fg.default',
  textStyle: 'ui.sm',
  cursor: 'pointer',
})
const resultActive = css({ bg: 'bg.hover' })
const resultLabel = css({ flex: '1', minW: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const resultDetail = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const noResults = css({ px: '2', py: '2', textStyle: 'ui.sm', color: 'fg.muted' })
</script>

<template>
  <header :class="root">
    <NuxtLink to="/" :class="brand" aria-label="Lumen library">
      <span :class="mark">L</span>
      <span :class="wordmark">Lumen</span>
    </NuxtLink>
    <span :class="spacer" />
    <div ref="searchWrap" :class="searchWrapCss" @focusout="onFocusOut">
      <Input
        v-model="search"
        type="search"
        size="md"
        live
        :select-on-focus="false"
        placeholder="Search presentations, songs, playlists, media…"
        aria-label="Search library"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="showResults"
        aria-controls="shell-search-results"
        @focus="open = true"
        @keydown="onSearchKey"
      >
        <template #prefix><Icon name="lucide:search" :size="14" /></template>
        <template #suffix><Kbd v-if="!search" shortcut="Mod+K" tone="subtle" /></template>
      </Input>
      <div v-if="showResults" id="shell-search-results" :class="results" role="listbox" aria-label="Search results">
        <div
          v-for="(hit, index) in hits"
          :key="hit.key"
          role="option"
          :aria-selected="index === active"
          :class="[resultRow, index === active ? resultActive : '']"
          @mousedown.prevent="choose(hit)"
          @mousemove="active = index"
        >
          <Icon :name="hit.icon" :size="14" aria-hidden="true" />
          <span :class="resultLabel">{{ hit.label }}</span>
          <span :class="resultDetail">{{ hit.detail }}</span>
        </div>
        <p v-if="hits.length === 0" :class="noResults">No matches in your local library.</p>
      </div>
    </div>
    <Badge v-if="online" tone="success" dot size="md" label="Local library" title="Everything is stored on this device and works offline." />
    <Badge v-else tone="warning" icon="lucide:wifi-off" size="md" label="Offline" title="No network. Local features are unaffected." />
    <Button v-if="onLive" variant="secondary" size="md" icon="lucide:radio" disabled>On air view</Button>
    <NuxtLink v-else-if="latestPlaylist" :to="goLiveTo" :title="goLiveHint">
      <Button variant="primary" size="md" icon="lucide:play" tabindex="-1">Go Live</Button>
    </NuxtLink>
    <Tooltip v-else :content="goLiveHint">
      <span><Button variant="primary" size="md" icon="lucide:play" disabled>Go Live</Button></span>
    </Tooltip>
    <NuxtLink to="/settings" aria-label="Settings"><IconButton icon="lucide:settings" label="Settings" variant="ghost" size="md" tabindex="-1" /></NuxtLink>
  </header>
</template>
