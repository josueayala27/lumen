import { slideText } from '@lumen/core'
import type { LiveState, PresentationDoc } from '@lumen/schema'
import { computed, ref } from 'vue'
import { getPlaylist } from '~/data/playlists'
import { getPresentation } from '~/data/presentations'
import { newLiveState } from '~/live/liveSession'
import { loadLiveSession } from '~/live/liveSessionStore'
import {
  stageNextSlide,
  stageSlideAt,
  type StageSourceItem,
  type StageSourceSlide,
} from './stageModel'

export type StageSlide = StageSourceSlide
export interface StageItem extends StageSourceItem<StageSlide> {
  doc: PresentationDoc | null
}

export interface StageLoadOptions {
  playlistId?: string
  presentationId?: string
}

function placeholderSlide(id: string, label: string): StageSlide {
  return { label, lines: [label], notes: '' }
}

function slidesOf(doc: PresentationDoc): StageSlide[] {
  return doc.slides.map((slide, index) => ({
    label: slide.label || `Slide ${index + 1}`,
    lines: slideText(slide)
      .split('\n')
      .filter((line) => line.length > 0),
    notes: slide.notes,
  }))
}

function itemOf(id: string, label: string, doc: PresentationDoc | null): StageItem {
  return {
    id,
    label,
    doc,
    slides: doc ? slidesOf(doc) : [placeholderSlide(id, label || 'Missing presentation')],
  }
}

/**
 * Read-only mirror of the desktop live session for the stage window. It polls the
 * same persisted snapshot the operator writes, so the stage stays in sync without
 * owning the authority.
 */
export function useStageSession(options: StageLoadOptions = {}) {
  const state = ref<LiveState | null>(null)
  const items = ref<StageItem[]>([])
  const loading = ref(true)
  const error = ref('')
  let loadedKey = ''

  const current = computed(() =>
    state.value ? stageSlideAt(items.value, state.value.itemIndex, state.value.slideIndex) : null,
  )
  const next = computed(() =>
    state.value ? stageNextSlide(items.value, state.value.itemIndex, state.value.slideIndex) : null,
  )
  const stageMessage = computed(() => state.value?.stageMessage ?? '')
  const timers = computed(() => state.value?.timers ?? [])
  const mode = computed(() => state.value?.mode ?? 'live')
  const hasSession = computed(() => state.value !== null)
  const safeArea = computed(() => current.value?.item.doc?.settings.safeArea ?? 0.05)

  async function loadSources(playlistId: string | null, presentationId: string | null): Promise<void> {
    error.value = ''
    if (playlistId) {
      const record = await getPlaylist(playlistId)
      if (!record) {
        items.value = []
        error.value = 'Playlist not found.'
        return
      }
      const docs = await Promise.all(
        record.doc.items.map((item) =>
          item.kind === 'presentation' ? getPresentation(item.presentationId) : null,
        ),
      )
      items.value = record.doc.items.map((item, index) => {
        const doc = docs[index]?.doc ?? null
        return itemOf(item.id, item.label || doc?.title || item.kind, doc)
      })
      return
    }
    if (presentationId) {
      const record = await getPresentation(presentationId)
      if (!record) {
        items.value = []
        error.value = 'Presentation not found.'
        return
      }
      items.value = [itemOf(`item_${record.id}`, record.doc.title, record.doc)]
      return
    }
    items.value = []
  }

  async function refresh(): Promise<void> {
    try {
      const stored = await loadLiveSession()
      const playlistId = stored?.playlistId ?? options.playlistId ?? null
      const presentationId = stored?.presentationId ?? options.presentationId ?? null
      state.value =
        stored?.state ?? (playlistId || presentationId ? newLiveState(playlistId) : null)
      const key = `${playlistId ?? ''}|${presentationId ?? ''}`
      if (key !== loadedKey) {
        loadedKey = key
        await loadSources(playlistId, presentationId)
      }
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
      loading.value = false
    }
  }

  return {
    state,
    items,
    loading,
    error,
    current,
    next,
    stageMessage,
    timers,
    mode,
    hasSession,
    safeArea,
    refresh,
  }
}
