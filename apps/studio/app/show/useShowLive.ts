import type { Composition, PresentationDoc, Scene, Screen, ShowDoc } from '@lumen/schema'
import { computed, ref, shallowRef, watch } from 'vue'
import { getPresentation } from '~/data/presentations'
import { sceneRevision, type LiveSceneTransform } from '~/live/liveScene'
import { saveLiveSession } from '~/live/liveSessionStore'
import { useLiveSession, type LiveLoadOptions } from '~/live/useLiveSession'
import {
  clearLayer,
  emptyLive,
  launchClip,
  launchColumn,
  stepLyrics,
  type ComposeContext,
  type ShowClip,
  type ShowLive,
} from './showModel'
import {
  canvasScreen,
  cueAt,
  nextCue,
  programComposition,
  releaseContentLayer,
  showScreenScene,
  type ShowFrame,
} from './showLive'
import { useShowDocument } from './useShowDocument'

/**
 * Which state a scene shows: on air (`program`, with the output mode), the
 * previewed cue, the on-air content without the mode (build workspaces), or
 * the next cue (preloading).
 */
export type FrameKind = 'program' | 'preview' | 'content' | 'next'

/**
 * The live state of the show, shared by every workspace: the rundown session
 * (`useLiveSession`, the reducer in `packages/core/src/live.ts`) and the clip
 * grid (`ShowLive`). The Show workspace drives it; Screens and Compose read it
 * so their previews show what is playing.
 */
function createShowLive() {
  const document = useShowDocument()
  const session = useLiveSession()
  const grid = ref<ShowLive>(emptyLive())
  const docs = shallowRef(new Map<string, PresentationDoc>())
  const docsVersion = ref(0)
  /** Timeline media and keyframes, set by the Show workspace while it runs. */
  const sceneTransform = shallowRef<LiveSceneTransform | null>(null)
  const sessionLoaded = ref(false)
  let sessionKey: string | null = null

  const state = session.state
  const mode = computed(() => state.value.mode)
  const programCue = computed(() => cueAt(session.items.value, state.value.itemIndex, state.value.slideIndex))
  const previewCue = computed(() =>
    cueAt(session.items.value, state.value.previewItemIndex, state.value.previewSlideIndex),
  )
  const upNext = computed(() => nextCue(session.items.value, state.value.itemIndex, state.value.slideIndex))
  const program = computed<ShowFrame>(() => ({ cue: programCue.value, mode: mode.value }))
  const preview = computed<ShowFrame>(() => ({ cue: previewCue.value, mode: 'live' }))
  /** Program content without the output mode, for build workspaces. */
  const content = computed<ShowFrame>(() => ({ cue: programCue.value, mode: 'live' }))

  /** Changes whenever any live input of a scene changes. */
  const version = computed(() => [
    grid.value,
    programCue.value?.key ?? '',
    previewCue.value?.key ?? '',
    mode.value,
    session.items.value,
    session.media.value,
    session.theme.value,
    docsVersion.value,
    sceneTransform.value?.key ?? '',
  ])

  // A new rundown slide on air takes the content layer back from the grid.
  watch(
    () => programCue.value?.key ?? null,
    (key, previous) => {
      if (key === null || previous === null || previous === undefined) return
      grid.value = releaseContentLayer(document.show.value, grid.value)
    },
  )

  function presentation(id: string): PresentationDoc | null {
    return docs.value.get(id) ?? session.items.value.find((item) => item.presentationId === id)?.doc ?? null
  }

  async function ensureDoc(id: string): Promise<void> {
    if (docs.value.has(id)) return
    const record = await getPresentation(id)
    if (!record) return
    docs.value = new Map(docs.value).set(id, record.doc)
    docsVersion.value++
  }

  /** Loads every document the clip grid launches. */
  async function ensureGridDocs(show: ShowDoc = document.show.value): Promise<void> {
    await Promise.all(
      show.grid.clips.flatMap((clip) =>
        clip.content.kind === 'presentation' ? [ensureDoc(clip.content.presentationId)] : [],
      ),
    )
  }

  /**
   * Loads a rundown or a presentation into the session. Without ids the
   * current session stays; the first load opens the latest rundown and
   * restores the last position after a crash.
   */
  async function loadSession(options: LiveLoadOptions = {}): Promise<void> {
    const key = `${options.playlistId ?? ''}|${options.presentationId ?? ''}`
    const explicit = Boolean(options.playlistId || options.presentationId)
    if (sessionLoaded.value && (!explicit || key === sessionKey)) return
    await session.load(options)
    sessionKey = explicit ? key : `${session.playlist.value?.id ?? ''}|${session.presentation.value?.id ?? ''}`
    sessionLoaded.value = true
    // Publish the restored position so a stage window opened later starts in sync.
    void saveLiveSession({
      playlistId: session.playlist.value?.id ?? null,
      presentationId: session.presentation.value?.id ?? null,
      state: state.value,
    })
  }

  function context(revision = sceneRevision()): ComposeContext {
    return { media: session.media.value, presentation, theme: session.theme.value, revision }
  }

  function frameOf(kind: FrameKind): ShowFrame {
    switch (kind) {
      case 'program':
        return program.value
      case 'preview':
        return preview.value
      case 'content':
        return content.value
      case 'next':
        return { cue: upNext.value, mode: 'live' }
    }
  }

  /** What a screen shows for a frame; the timeline transform applies to the program only. */
  function screenScene(
    screen: Screen,
    kind: FrameKind = 'program',
    show: ShowDoc = document.show.value,
    overrides: Partial<ComposeContext> = {},
  ): Scene {
    const transform = kind === 'program' ? sceneTransform.value : null
    return showScreenScene(show, grid.value, screen, frameOf(kind), { ...context(), ...overrides }, { transform })
  }

  /** The whole canvas for a frame, as the Preview and Program monitors show it. */
  function canvasScene(kind: FrameKind = 'program', show: ShowDoc = document.show.value): Scene {
    return screenScene(canvasScreen(show), kind, show)
  }

  /** The playing composition (clips and rundown content), without the output mode. */
  function composition(show: ShowDoc = document.show.value, overrides: Partial<ComposeContext> = {}): Composition {
    return programComposition(show, grid.value, content.value, { ...context(), ...overrides })
  }

  // Clip grid

  function launch(clip: ShowClip): void {
    grid.value = launchClip(grid.value, clip)
  }

  function launchGridColumn(column: number): void {
    grid.value = launchColumn(document.show.value, grid.value, column)
  }

  function clearGridLayer(layerId: string): void {
    grid.value = clearLayer(grid.value, layerId)
  }

  function clearClips(): void {
    grid.value = emptyLive()
  }

  function stepClip(clip: ShowClip, delta: number): void {
    if (clip.content.kind !== 'presentation') return
    const count = presentation(clip.content.presentationId)?.slides.length ?? 0
    grid.value = stepLyrics(grid.value, clip.id, delta, count)
  }

  return {
    session,
    grid,
    docs,
    docsVersion,
    sceneTransform,
    sessionLoaded,
    mode,
    programCue,
    previewCue,
    upNext,
    program,
    preview,
    content,
    version,
    presentation,
    ensureDoc,
    ensureGridDocs,
    loadSession,
    context,
    screenScene,
    canvasScene,
    composition,
    launch,
    launchColumn: launchGridColumn,
    clearLayer: clearGridLayer,
    clearClips,
    stepClip,
  }
}

export type ShowLiveStore = ReturnType<typeof createShowLive>

let shared: ShowLiveStore | null = null

/** The shared live state. The Show workspace loads it; other workspaces only read it. */
export function useShowLive(): ShowLiveStore {
  shared ??= createShowLive()
  return shared
}
