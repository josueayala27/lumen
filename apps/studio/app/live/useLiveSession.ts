import { liveReducer } from '@lumen/core'
import type { LiveCommand, LiveState, OutputMode } from '@lumen/schema'
import { computed, ref } from 'vue'
import {
  getPresentation,
  listPresentations,
  type PresentationRecord,
} from '~/data/presentations'
import { getPlaylist, listPlaylists, type PlaylistRecord } from '~/data/playlists'
import {
  buildLiveItems,
  clampLiveState,
  liveContext,
  newLiveState,
  nextLiveSlide,
  presentationLiveItem,
  resolveLiveSlide,
  type LiveItem,
} from './liveSession'
import { loadLiveSession, saveLiveSession } from './liveSessionStore'

export interface LiveLoadOptions {
  playlistId?: string
  presentationId?: string
}

/** Owns the real LiveState and hydrates it from a playlist or a single presentation. */
export function useLiveSession() {
  const state = ref<LiveState>(newLiveState(null))
  const items = ref<LiveItem[]>([])
  const playlist = ref<PlaylistRecord | null>(null)
  const presentation = ref<PresentationRecord | null>(null)
  const loading = ref(true)
  const error = ref('')

  const context = computed(() => liveContext(items.value))
  const current = computed(() =>
    resolveLiveSlide(items.value, state.value.itemIndex, state.value.slideIndex),
  )
  const preview = computed(() =>
    resolveLiveSlide(items.value, state.value.previewItemIndex, state.value.previewSlideIndex),
  )
  const nextSlide = computed(() =>
    nextLiveSlide(items.value, state.value.itemIndex, state.value.slideIndex),
  )
  const currentItem = computed(() => current.value?.item ?? null)
  const currentSlide = computed(() => current.value?.slide ?? null)
  const previewItem = computed(() => preview.value?.item ?? null)
  const previewSlide = computed(() => preview.value?.slide ?? null)
  const slideCount = computed(() => items.value.reduce((sum, item) => sum + item.slides.length, 0))

  function snapshot() {
    return {
      playlistId: playlist.value?.id ?? null,
      presentationId: presentation.value?.id ?? null,
      state: state.value,
    }
  }

  function persist(): void {
    void saveLiveSession(snapshot())
  }

  function dispatch(command: LiveCommand): LiveState {
    state.value = liveReducer(state.value, command, context.value)
    persist()
    return state.value
  }

  function reset(itemsValue: LiveItem[], playlistValue: PlaylistRecord | null, presentationValue: PresentationRecord | null): void {
    items.value = itemsValue
    playlist.value = playlistValue
    presentation.value = presentationValue
  }

  async function restore(
    playlistValue: PlaylistRecord | null,
    presentationValue: PresentationRecord | null,
  ): Promise<void> {
    const stored = await loadLiveSession()
    const playlistId = playlistValue?.id ?? null
    const presentationId = presentationValue?.id ?? null
    if (
      stored &&
      stored.playlistId === playlistId &&
      stored.presentationId === presentationId
    ) {
      state.value = clampLiveState(stored.state, context.value)
    } else {
      state.value = newLiveState(playlistId)
    }
  }

  async function loadPresentation(id: string): Promise<void> {
    const record = await getPresentation(id)
    if (!record) {
      reset([], null, null)
      state.value = newLiveState(null)
      error.value = 'Presentation not found.'
      return
    }
    reset([presentationLiveItem(record.doc, `item_${record.id}`)], null, record)
    await restore(null, record)
  }

  async function loadPlaylistRecord(record: PlaylistRecord): Promise<void> {
    const docs = new Map<string, PresentationRecord | null>()
    await Promise.all(
      record.doc.items.map(async (item) => {
        if (item.kind === 'presentation') {
          docs.set(item.presentationId, await getPresentation(item.presentationId))
        }
      }),
    )
    reset(buildLiveItems(record.doc, (id) => docs.get(id)?.doc ?? null), record, null)
    await restore(record, null)
  }

  async function load(options: LiveLoadOptions = {}): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      if (options.presentationId) {
        await loadPresentation(options.presentationId)
        return
      }

      let record: PlaylistRecord | null = null
      if (options.playlistId) {
        record = await getPlaylist(options.playlistId)
        if (!record) {
          reset([], null, null)
          state.value = newLiveState(null)
          error.value = 'Playlist not found.'
          return
        }
      } else {
        const list = await listPlaylists()
        const latest = list[0]
        if (latest) record = await getPlaylist(latest.id)
      }

      if (record) {
        await loadPlaylistRecord(record)
        return
      }

      const presentations = await listPresentations()
      const latest = presentations[0]
      if (latest) {
        await loadPresentation(latest.id)
        return
      }

      reset([], null, null)
      state.value = newLiveState(null)
    } catch (reason) {
      reset([], null, null)
      state.value = newLiveState(null)
      error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
      loading.value = false
    }
  }

  function next(): void {
    dispatch({ type: 'next' })
  }

  function prev(): void {
    dispatch({ type: 'prev' })
  }

  function nextItem(): void {
    dispatch({ type: 'nextItem' })
  }

  function prevItem(): void {
    dispatch({ type: 'prevItem' })
  }

  function take(): void {
    dispatch({ type: 'take' })
  }

  function goTo(itemIndex: number, slideIndex: number): void {
    dispatch({ type: 'previewGoTo', itemIndex, slideIndex })
  }

  function setMode(mode: OutputMode): void {
    dispatch({ type: 'setMode', mode })
  }

  function setStageMessage(message: string): void {
    dispatch({ type: 'setMessage', message })
  }

  return {
    state,
    items,
    playlist,
    presentation,
    loading,
    error,
    context,
    currentItem,
    currentSlide,
    previewItem,
    previewSlide,
    nextSlide,
    slideCount,
    load,
    dispatch,
    next,
    prev,
    nextItem,
    prevItem,
    take,
    goTo,
    setMode,
    setStageMessage,
  }
}
