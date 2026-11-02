import { compositionToScene, createScreen, emptyLive, liveComposition, type ShowMediaLike } from '@lumen/core'
import type { Composition, PresentationDoc, Scene, ShowDoc } from '@lumen/schema'
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { isTauriRuntime, previewRender } from '~/control/render'
import { useShowLive } from '~/show/useShowLive'

/** Preview width while dragging a handle (doc 02 § Preview flow). */
export const DRAG_PREVIEW_WIDTH = 640
/** Preview width at rest; capped so a 4K canvas stays cheap over IPC. */
export const REST_PREVIEW_WIDTH = 1280

export interface ComposePreviewFrame {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

export interface ComposePreviewOptions {
  show: Ref<ShowDoc>
  media: Ref<readonly ShowMediaLike[]>
  presentation?: (id: string) => PresentationDoc | null
  dragging: Ref<boolean>
}

/**
 * The v1 scene for the whole canvas, as a full-canvas virtual screen sees it.
 * `resolve` plays the live clips and rundown content; without it the
 * composition shows its own layer sources.
 */
export function composeCanvasScene(
  show: ShowDoc,
  composition: Composition,
  media: readonly ShowMediaLike[],
  presentation: (id: string) => PresentationDoc | null = () => null,
  resolve?: (show: ShowDoc) => Composition,
): Scene {
  const next = { ...show, composition }
  const resolved = resolve ? resolve(next) : liveComposition(next, emptyLive(), { media, presentation, theme: null })
  const screen = createScreen({ id: 'compose-preview', name: 'Compose', size: composition.canvas })
  return compositionToScene(resolved, screen)
}

/** Pixel size of a preview render for a canvas, keeping its aspect ratio. */
export function previewSize(canvas: { width: number; height: number }, maxWidth: number): { width: number; height: number } {
  const width = Math.max(1, Math.min(Math.round(canvas.width), maxWidth))
  const height = Math.max(1, Math.round((width * canvas.height) / canvas.width))
  return { width, height }
}

/**
 * Renders the composition through the Rust preview renderer whenever it
 * changes. One render runs at a time; changes during a render coalesce into one
 * follow-up. Outside Tauri `available` is false and the page draws its own
 * approximation.
 */
export function useComposePreview(options: ComposePreviewOptions) {
  const available = isTauriRuntime()
  const live = useShowLive()
  const presentation = (id: string) => options.presentation?.(id) ?? live.presentation(id)
  const frame = shallowRef<ComposePreviewFrame | null>(null)
  const error = ref('')
  let running = false
  let queued = false
  let disposed = false

  async function renderOnce(): Promise<void> {
    const show = options.show.value
    const composition = show.composition
    const scene = composeCanvasScene(show, composition, options.media.value, presentation, (value) =>
      live.composition(value, { media: options.media.value, presentation }),
    )
    const size = previewSize(composition.canvas, options.dragging.value ? DRAG_PREVIEW_WIDTH : REST_PREVIEW_WIDTH)
    const decoded = await previewRender(scene, size.width, size.height)
    if (disposed) return
    frame.value = {
      width: decoded.width,
      height: decoded.height,
      rgba: new Uint8ClampedArray(decoded.rgba.buffer, decoded.rgba.byteOffset, decoded.rgba.byteLength),
    }
    error.value = ''
  }

  async function render(): Promise<void> {
    if (!available || disposed) return
    if (running) {
      queued = true
      return
    }
    running = true
    try {
      do {
        queued = false
        try {
          await renderOnce()
        } catch (reason) {
          error.value = reason instanceof Error ? reason.message : String(reason)
        }
      } while (queued && !disposed)
    } finally {
      running = false
    }
  }

  watch([() => options.show.value.composition, options.media, options.dragging, live.version], () => void render(), {
    immediate: true,
  })
  onBeforeUnmount(() => {
    disposed = true
  })

  return { available, frame, error, render }
}
