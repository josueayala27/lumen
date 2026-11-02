import { createShowDoc, touchComposition } from '@lumen/core'
import type { Composition, Screen, ShowDoc } from '@lumen/schema'
import { computed, ref, shallowRef } from 'vue'
import { loadShow, saveShow } from '~/data/shows'
import { commitHistory, createHistory, redoHistory, undoHistory, type EditHistory } from '~/timeline/lib'

export interface ShowDocumentIO {
  load: () => Promise<ShowDoc>
  save: (show: ShowDoc) => Promise<void>
}

export interface ShowUpdateOptions {
  /** false applies the change without an undo step (live tweaks, selection-like state). */
  history?: boolean
  /**
   * Edits with the same key inside `COALESCE_MS` share one undo step, so a
   * slider drag is undone in one go.
   */
  coalesce?: string
}

export const SAVE_DELAY_MS = 300
export const COALESCE_MS = 800

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * The current show document with undo/redo, revision bumps and debounced
 * saving. Every page that edits the show (Show, Compose, Screens) shares one
 * instance through `useShowDocument()`.
 */
export function createShowDocument(io: ShowDocumentIO = { load: loadShow, save: saveShow }, saveDelayMs = SAVE_DELAY_MS) {
  const current = shallowRef<ShowDoc>(createShowDoc())
  const history = shallowRef<EditHistory>(createHistory(JSON.stringify(current.value)))
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref('')
  let loadPromise: Promise<void> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> = Promise.resolve()
  let maxRevision = current.value.composition.revision
  let lastCoalesce: { key: string; at: number } | null = null

  function reset(show: ShowDoc): void {
    current.value = show
    history.value = createHistory(JSON.stringify(show))
    maxRevision = Math.max(maxRevision, show.composition.revision)
    lastCoalesce = null
  }

  /** Loads the stored show once; later calls return the same promise. */
  function load(): Promise<void> {
    if (!loadPromise) {
      loading.value = true
      loadPromise = io
        .load()
        .then((show) => {
          reset(show)
          loaded.value = true
        })
        .catch((reason) => {
          error.value = message(reason)
        })
        .finally(() => {
          loading.value = false
        })
    }
    return loadPromise
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void flush(), saveDelayMs)
  }

  /** Saves now, cancelling a pending debounced save. */
  function flush(): Promise<void> {
    clearTimeout(saveTimer)
    saveTimer = undefined
    const snapshot = current.value
    pending = pending
      .then(() => io.save(snapshot))
      .then(() => {
        error.value = ''
      })
      .catch((reason) => {
        error.value = message(reason)
      })
    return pending
  }

  /** Sets the show with a fresh composition revision and schedules a save. */
  function apply(show: ShowDoc): void {
    maxRevision += 1
    current.value = { ...show, composition: touchComposition(show.composition, maxRevision) }
    scheduleSave()
  }

  /** Applies a pure show edit. Returning the same object is a no-op. */
  function update(edit: (show: ShowDoc) => ShowDoc, options: ShowUpdateOptions = {}): void {
    const next = edit(current.value)
    if (next === current.value) return
    apply(next)
    const snapshot = JSON.stringify(current.value)
    const now = Date.now()
    if (options.history === false) {
      history.value = { ...history.value, present: snapshot }
      lastCoalesce = null
      return
    }
    const key = options.coalesce
    if (key && lastCoalesce?.key === key && now - lastCoalesce.at < COALESCE_MS && history.value.past.length > 0) {
      history.value = { ...history.value, present: snapshot, future: [] }
    } else {
      history.value = commitHistory(history.value, snapshot)
    }
    lastCoalesce = key ? { key, at: now } : null
  }

  function updateComposition(edit: (composition: Composition) => Composition, options?: ShowUpdateOptions): void {
    update((show) => {
      const composition = edit(show.composition)
      return composition === show.composition ? show : { ...show, composition }
    }, options)
  }

  function updateScreens(edit: (screens: Screen[]) => Screen[], options?: ShowUpdateOptions): void {
    update((show) => {
      const screens = edit(show.screens)
      return screens === show.screens ? show : { ...show, screens }
    }, options)
  }

  function restore(next: EditHistory): void {
    if (next === history.value) return
    history.value = next
    lastCoalesce = null
    apply(JSON.parse(next.present) as ShowDoc)
  }

  function undo(): void {
    restore(undoHistory(history.value))
  }

  function redo(): void {
    restore(redoHistory(history.value))
  }

  /** Replaces the whole show (new or imported) and clears undo history. */
  function replace(show: ShowDoc): void {
    reset(show)
    apply(show)
    history.value = createHistory(JSON.stringify(current.value))
  }

  const show = computed(() => current.value)
  return {
    show,
    composition: computed(() => current.value.composition),
    screens: computed(() => current.value.screens),
    grid: computed(() => current.value.grid),
    loaded,
    loading,
    error,
    canUndo: computed(() => history.value.past.length > 0),
    canRedo: computed(() => history.value.future.length > 0),
    load,
    update,
    updateComposition,
    updateScreens,
    undo,
    redo,
    replace,
    flush,
  }
}

export type ShowDocument = ReturnType<typeof createShowDocument>

let shared: ShowDocument | null = null

/** The shared show document. Call `load()` before reading; it is idempotent. */
export function useShowDocument(): ShowDocument {
  shared ??= createShowDocument()
  return shared
}
