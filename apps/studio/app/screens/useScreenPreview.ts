import type { Composition, PresentationDoc, Scene, SceneLayer, Screen, ShowDoc } from '@lumen/schema'
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { previewRenderComposition, type DecodedCompositionPreview } from '~/control/render'
import type { MediaAsset } from '~/data/media'
import { isTauri } from '~/output/api'
import { schematicScene } from '~/show/showModel'
import { useShowLive } from '~/show/useShowLive'

/** Longest side of the native preview frame, in pixels. */
export const PREVIEW_MAX = 960

export interface ScreenPreviewOptions {
  show: Readonly<Ref<ShowDoc>>
  screen: Readonly<Ref<Screen | null>>
  media: Readonly<Ref<MediaAsset[]>>
  presentation?: (id: string) => PresentationDoc | null
}

/** One scene layer as a box for the browser fallback, which has no renderer. */
export interface SchematicLayer {
  id: string
  kind: SceneLayer['kind']
  x: number
  y: number
  w: number
  h: number
  opacity: number
  fill: string | null
  text: string
}

/** Preview frame size for a screen: its aspect, at most `max` on the long side. */
export function previewSize(screen: Pick<Screen, 'size'>, max = PREVIEW_MAX): { width: number; height: number } {
  const { width, height } = screen.size
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Boxes for each scene layer, bottom to top, when the native renderer is not there. */
export function schematicLayers(scene: Scene): SchematicLayer[] {
  return [...scene.layers]
    .sort((a, b) => a.z - b.z)
    .map((layer) => ({
      id: layer.id,
      kind: layer.kind,
      x: layer.frame.x,
      y: layer.frame.y,
      w: layer.frame.w,
      h: layer.frame.h,
      opacity: layer.opacity,
      fill: layer.kind === 'shape' ? layer.fill : null,
      text: layer.kind === 'text' ? layer.runs.map((run) => run.text).join('') : '',
    }))
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * What the selected screen shows, with the clips and rundown content playing
 * now (shared live state; the output mode is left out). Inside the desktop app
 * the v2 compositor renders the screen as its output does: layout, corner
 * pin, mesh, edge blend, colour, output masks and test pattern. In the browser
 * the caller draws `schematic` from `scene` (v1 adapter, no mapping).
 */
export function useScreenPreview(options: ScreenPreviewOptions) {
  const native = isTauri()
  const live = useShowLive()
  const composition = shallowRef<Composition | null>(null)
  const scene = shallowRef<Scene | null>(null)
  const frame = shallowRef<DecodedCompositionPreview | null>(null)
  const error = ref('')
  let token = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function compose(): Composition {
    // Library media and documents from the caller win; live documents fill in.
    return live.frameComposition('content', options.show.value, {
      media: options.media.value.length ? options.media.value : live.session.media.value,
      presentation: (id) => options.presentation?.(id) ?? live.presentation(id),
    })
  }

  async function render(): Promise<void> {
    const screen = options.screen.value
    const run = ++token
    if (!screen) {
      composition.value = null
      scene.value = null
      frame.value = null
      return
    }
    try {
      const next = compose()
      composition.value = next
      error.value = ''
      if (!native) {
        scene.value = schematicScene(next, screen, { theme: live.session.theme.value })
        return
      }
      const size = previewSize(screen)
      const result = await previewRenderComposition(next, screen, size.width, size.height)
      if (run === token) frame.value = result
    } catch (reason) {
      if (run === token) {
        frame.value = null
        error.value = message(reason)
      }
    }
  }

  function schedule(): void {
    clearTimeout(timer)
    timer = setTimeout(() => void render(), 60)
  }

  watch(
    () => [options.show.value, options.screen.value, options.media.value, live.version.value] as const,
    schedule,
    { immediate: true },
  )
  onBeforeUnmount(() => clearTimeout(timer))

  return { native, composition, scene, frame, error, compose, render }
}
