<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { Button, IconButton, Input, Select } from '~/ui'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  listPresentations,
  updatedLabel,
  type PresentationSummary,
} from '~/data/presentations'
import {
  addPresentationItem,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  movePlaylistItem,
  newPlaylistDoc,
  removePlaylistItem,
  savePlaylist,
  type PlaylistRecord,
  type PlaylistSummary,
} from '~/data/playlists'

const router = useRouter()
const playlists = ref<PlaylistSummary[]>([])
const library = ref<PresentationSummary[]>([])
const selectedId = ref('')
const draft = ref<PlaylistRecord | null>(null)
const selectedPresentation = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const baseline = ref('')
const savedAt = ref<number | null>(null)

const presentationOptions = computed(() =>
  library.value.map((item) => ({
    value: item.id,
    label: `${item.title} · ${item.kind === 'song' ? 'Song' : 'Slides'}`,
  })),
)
const dirty = computed(
  () => draft.value !== null && JSON.stringify(draft.value.doc) !== baseline.value,
)
const itemCount = computed(() => draft.value?.doc.items.length ?? 0)
const presentationCount = computed(
  () => draft.value?.doc.items.filter((item) => item.kind === 'presentation').length ?? 0,
)
const canAdd = computed(
  () => Boolean(draft.value) && selectedPresentation.value.length > 0,
)
const saveLabel = computed(() => {
  if (saving.value) return 'Saving…'
  return dirty.value ? 'Save changes' : 'Saved'
})

function markSaved(record: PlaylistRecord): void {
  draft.value = record
  baseline.value = JSON.stringify(record.doc)
  savedAt.value = record.updatedAt
}

async function refresh(): Promise<void> {
  playlists.value = await listPlaylists()
}

async function select(id: string): Promise<void> {
  if (!id) {
    draft.value = null
    selectedId.value = ''
    baseline.value = ''
    return
  }
  const record = await getPlaylist(id)
  if (!record) return
  selectedId.value = id
  markSaved(record)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [playlistList, presentations] = await Promise.all([
      listPlaylists(),
      listPresentations(),
    ])
    playlists.value = playlistList
    library.value = presentations
    const first = playlistList[0]
    if (first) await select(first.id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function newPlaylist(): Promise<void> {
  try {
    const record = await createPlaylist(newPlaylistDoc())
    await refresh()
    await select(record.id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function save(): Promise<void> {
  if (!draft.value) return
  saving.value = true
  error.value = ''
  try {
    const updated: PlaylistRecord = { ...draft.value, updatedAt: Date.now() }
    await savePlaylist(updated)
    markSaved(updated)
    await refresh()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    saving.value = false
  }
}

function addPresentation(): void {
  if (!draft.value || !selectedPresentation.value) return
  const summary = library.value.find((item) => item.id === selectedPresentation.value)
  if (!summary) return
  draft.value = {
    ...draft.value,
    doc: addPresentationItem(draft.value.doc, summary.id, summary.title),
  }
  selectedPresentation.value = ''
}

function removeItem(itemId: string): void {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    doc: removePlaylistItem(draft.value.doc, itemId),
  }
}

function moveItem(itemId: string, delta: number): void {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    doc: movePlaylistItem(draft.value.doc, itemId, delta),
  }
}

async function openLive(): Promise<void> {
  if (!draft.value) return
  if (dirty.value) await save()
  if (error.value) return
  await router.push({ path: '/live', query: { playlist: draft.value.id } })
}

async function removePlaylist(): Promise<void> {
  if (!draft.value) return
  try {
    await deletePlaylist(draft.value.id)
    draft.value = null
    selectedId.value = ''
    baseline.value = ''
    await refresh()
    const first = playlists.value[0]
    if (first) await select(first.id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

onMounted(load)

const root = css({ display: 'flex', h: 'full', minH: '0' })
const rail = css({ w: '[240px]', flexShrink: '0', display: 'flex', flexDirection: 'column', bg: 'bg.panel', borderRightWidth: '1px', borderColor: 'border.default' })
const railHead = css({ p: '3', borderBottomWidth: '1px', borderColor: 'border.default' })
const railEyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const railTitle = css({ textStyle: 'ui.title', color: 'fg.default', mb: '2' })
const railList = css({ flex: '1', minH: '0', overflowY: 'auto', p: '2', display: 'flex', flexDirection: 'column', gap: '1' })
const playlistButton = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.5',
  px: '2',
  py: '2',
  borderRadius: 'sm',
  borderLeftWidth: '2px',
  borderColor: 'transparent',
  color: 'fg.muted',
  textAlign: 'left',
  cursor: 'pointer',
  _hover: { bg: 'bg.hover', color: 'fg.default' },
})
const playlistButtonActive = css({ bg: 'bg.subtle', color: 'fg.default', borderColor: 'accent.default' })
const playlistName = css({ textStyle: 'ui.sm', color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxW: 'full' })
const playlistMeta = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const content = css({ flex: '1', minW: '0', h: 'full', overflowY: 'auto', px: '6', py: '5' })
const header = css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '4', mb: '5' })
const eyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const title = css({ textStyle: 'display.md', color: 'fg.default' })
const subtitle = css({ mt: '1', textStyle: 'ui.sm', color: 'fg.muted' })
const actions = css({ display: 'flex', alignItems: 'center', gap: '2' })
const card = css({ borderRadius: 'md', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default', p: '4' })
const fieldLabel = css({ textStyle: 'ui.xs', color: 'fg.muted', mb: '1.5' })
const addRow = css({ display: 'flex', alignItems: 'center', gap: '2', mt: '4' })
const itemList = css({ display: 'flex', flexDirection: 'column', gap: '1', mt: '4' })
const itemRow = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2.5',
  px: '2',
  py: '2',
  borderRadius: 'sm',
  bg: 'bg.canvas',
  borderWidth: '1px',
  borderColor: 'border.default',
})
const itemIndex = css({ w: '5', textStyle: 'ui.mono', color: 'fg.subtle', flexShrink: '0' })
const itemMeta = css({ flex: '1', minW: '0' })
const itemTitle = css({ textStyle: 'ui.sm', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const itemNote = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const notice = css({ py: '10', textAlign: 'center', textStyle: 'ui.sm', color: 'fg.muted' })
const errorText = css({ textStyle: 'ui.sm', color: 'danger.default', mb: '3' })
const status = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const inspector = css({ w: 'inspector', flexShrink: '0', h: 'full', overflowY: 'auto', bg: 'bg.panel', borderLeftWidth: '1px', borderColor: 'border.default', px: '4', py: '4' })
const inspectorTitle = css({ textStyle: 'ui.title', color: 'fg.default', mb: '3' })
const stat = css({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', py: '2.5', borderBottomWidth: '1px', borderColor: 'border.default' })
const statLabel = css({ textStyle: 'ui.sm', color: 'fg.muted' })
const statValue = css({ textStyle: 'ui.title', color: 'fg.default' })
const cardBox = css({ mt: '4', p: '3', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default' })
const boxTitle = css({ display: 'flex', alignItems: 'center', gap: '2', textStyle: 'ui.sm', color: 'fg.default', mb: '2' })
const boxText = css({ textStyle: 'ui.xs', color: 'fg.muted', lineHeight: 'normal' })
</script>

<template>
  <div :class="root">
    <aside :class="rail" aria-label="Playlists">
      <div :class="railHead">
        <p :class="railEyebrow">Service</p>
        <h1 :class="railTitle">Playlists</h1>
        <Button variant="secondary" size="sm" block icon="lucide:plus" @click="newPlaylist">New playlist</Button>
      </div>
      <div :class="railList">
        <button
          v-for="entry in playlists"
          :key="entry.id"
          type="button"
          :class="[playlistButton, entry.id === selectedId ? playlistButtonActive : '']"
          @click="select(entry.id)"
        >
          <span :class="playlistName">{{ entry.name }}</span>
          <span :class="playlistMeta">{{ entry.itemCount }} items · {{ updatedLabel(entry.updatedAt) }}</span>
        </button>
        <p v-if="!loading && playlists.length === 0" :class="notice">No playlists yet.</p>
      </div>
    </aside>

    <section :class="content">
      <header :class="header">
        <div>
          <p :class="eyebrow">Order of service</p>
          <h2 :class="title">{{ draft?.doc.name ?? 'Playlists' }}</h2>
          <p :class="subtitle">Add presentations, reorder the service, then open it live.</p>
        </div>
        <div :class="actions">
          <span v-if="savedAt" :class="status">{{ dirty ? 'Unsaved changes' : `Saved ${updatedLabel(savedAt)}` }}</span>
          <Button variant="secondary" size="md" :disabled="!draft || saving" @click="save">{{ saveLabel }}</Button>
          <Button variant="primary" size="md" icon="lucide:radio" :disabled="!draft" @click="openLive">Open live</Button>
        </div>
      </header>

      <p v-if="error" :class="errorText">{{ error }}</p>
      <p v-if="loading" :class="notice">Loading playlists…</p>
      <p v-else-if="!draft" :class="notice">Create a playlist to order the service.</p>
      <div v-else :class="card">
        <label :class="fieldLabel" for="playlist-name">Playlist name</label>
        <Input id="playlist-name" v-model="draft.doc.name" live placeholder="Sunday service" size="md" />

        <div :class="addRow">
          <Select
            v-model="selectedPresentation"
            :options="presentationOptions"
            placeholder="Add a presentation…"
            aria-label="Add a presentation"
          />
          <Button variant="secondary" size="md" icon="lucide:plus" :disabled="!canAdd" @click="addPresentation">Add</Button>
        </div>

        <div :class="itemList">
          <div v-for="(item, index) in draft.doc.items" :key="item.id" :class="itemRow">
            <span :class="itemIndex">{{ String(index + 1).padStart(2, '0') }}</span>
            <Icon :name="item.kind === 'presentation' ? 'lucide:presentation' : item.kind === 'media' ? 'lucide:film' : 'lucide:heading'" :size="14" />
            <div :class="itemMeta">
              <p :class="itemTitle">{{ item.label || 'Untitled item' }}</p>
              <p :class="itemNote">{{ item.kind === 'presentation' ? 'Presentation' : item.kind === 'media' ? 'Media' : 'Header' }}</p>
            </div>
            <IconButton icon="lucide:arrow-up" label="Move up" size="sm" :disabled="index === 0" @click="moveItem(item.id, -1)" />
            <IconButton icon="lucide:arrow-down" label="Move down" size="sm" :disabled="index === draft.doc.items.length - 1" @click="moveItem(item.id, 1)" />
            <IconButton icon="lucide:x" label="Remove item" size="sm" @click="removeItem(item.id)" />
          </div>
          <p v-if="draft.doc.items.length === 0" :class="notice">Add a presentation to start the playlist.</p>
        </div>
      </div>
    </section>

    <aside :class="inspector" aria-label="Playlist inspector">
      <h2 :class="inspectorTitle">Playlist status</h2>
      <div :class="stat"><span :class="statLabel">Items</span><span :class="statValue">{{ itemCount }}</span></div>
      <div :class="stat"><span :class="statLabel">Presentations</span><span :class="statValue">{{ presentationCount }}</span></div>
      <div :class="stat"><span :class="statLabel">State</span><span :class="statValue">{{ dirty ? 'Draft' : 'Saved' }}</span></div>
      <div :class="cardBox">
        <p :class="boxTitle"><Icon name="lucide:database" :size="14" />Local playlist</p>
        <p :class="boxText">Stored in SQLite. Live resumes the last item and slide after a restart.</p>
      </div>
      <div :class="cardBox">
        <p :class="boxTitle"><Icon name="lucide:keyboard" :size="14" />Live keys</p>
        <p :class="boxText">Space next · Enter take · [ and ] change item · B/C/L/F output modes</p>
      </div>
      <Button v-if="draft" variant="danger" size="md" block icon="lucide:trash-2" @click="removePlaylist">Delete playlist</Button>
    </aside>
  </div>
</template>
