import { emptyLive, liveComposition, type ShowMediaLike } from '@lumen/core'
import type { Composition, CompositionBounds, PresentationDoc, ShowDoc } from '@lumen/schema'
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { isTauriRuntime, previewRenderComposition } from '~/control/render'
import { useShowLive } from '~/show/useShowLive'

/** Preview width while dragging a handle (doc 02 § Preview flow). */
export const DRAG_PREVIEW_WIDTH = 640
/** Preview width at rest; capped so a 4K canvas stays cheap over IPC. */
export const REST_PREVIEW_WIDTH = 1280

export interface ComposePreviewFrame {
  width: number
  height: number
  rgba: Uint8ClampedArray
  /** Layer boxes and slide elements as the compositor laid them out, normalized to the canvas. */
  bounds: CompositionBounds[]
}

export interface ComposePreviewOptions {
  show: Ref<ShowDoc>
  media: Ref<readonly ShowMediaLike[]>
  presentation?: (id: string) => PresentationDoc | null
  dragging: Ref<boolean>
}

/**
 * The composition the canvas preview renders. `resolve` plays the live clips
 * and rundown content; without it the composition shows its own layer sources.
 */
export function composeCanvasComposition(
  show: ShowDoc,
  composition: Composition,
  media: readonly ShowMediaLike[],
  presentation: (id: string) => PresentationDoc | null = () => null,
  resolve?: (show: ShowDoc) => Composition,
): Composition {
  const next = { ...show, composition }
  return resolve ? resolve(next) : liveComposition(next, emptyLive(), { media, presentation, theme: null })
}

/** Pixel size of a preview render for a canvas, keeping its aspect ratio. */
export function previewSize(canvas: { width: number; height: number }, maxWidth: number): { width: number; height: number } {
  const width = Math.max(1, Math.min(Math.round(canvas.width), maxWidth))
  const height = Math.max(1, Math.round((width * canvas.height) / canvas.width))
  return { width, height }
}

/**
 * Renders the bare canvas (no screen) through the v2 compositor whenever the
 * composition changes: blend modes, effects, masks and generators included. One render runs at a time; changes during a render coalesce into one
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
  const resolvedComposition = shallowRef<Composition | null>(null)

  async function renderOnce(): Promise<void> {
    const show = options.show.value
    const composition = show.composition
    const resolved = composeCanvasComposition(show, composition, options.media.value, presentation, (value) =>
      live.composition(value, { media: options.media.value, presentation }),
    )
    resolvedComposition.value = resolved
    const size = previewSize(composition.canvas, options.dragging.value ? DRAG_PREVIEW_WIDTH : REST_PREVIEW_WIDTH)
    const decoded = await previewRenderComposition(resolved, null, size.width, size.height)
    if (disposed) return
    frame.value = {
      width: decoded.width,
      height: decoded.height,
      rgba: new Uint8ClampedArray(decoded.rgba.buffer, decoded.rgba.byteOffset, decoded.rgba.byteLength),
      bounds: decoded.layout.bounds,
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
  // Playing video only changes frames, not the composition: keep rendering.
  useVideoRefresh(
    () => available && !options.dragging.value && compositionHasVideo(resolvedComposition.value),
    render,
  )
  onBeforeUnmount(() => {
    disposed = true
  })

  return { available, frame, error, render }
}
