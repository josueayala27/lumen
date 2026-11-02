import type { PresentationDoc, Scene, SceneLayer, Screen, ShowDoc } from '@lumen/schema'
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { previewRender, type DecodedPreview } from '~/control/render'
import type { MediaAsset } from '~/data/media'
import { sceneRevision } from '~/live/liveScene'
import { isTauri } from '~/output/api'
import { composeScreenScene, emptyLive } from '~/show/showModel'

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
 * What the selected screen shows, through the same composition adapter the
 * Show page sends to outputs. Without live clips: the Screens workspace
 * previews the composition's own layer sources. Inside the desktop app the
 * scene is rendered by the native preview renderer; in the browser the caller
 * draws `schematic` instead.
 */
export function useScreenPreview(options: ScreenPreviewOptions) {
  const native = isTauri()
  const scene = shallowRef<Scene | null>(null)
  const frame = shallowRef<DecodedPreview | null>(null)
  const error = ref('')
  let token = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function compose(screen: Screen): Scene {
    return composeScreenScene(options.show.value, emptyLive(), screen, {
      media: options.media.value,
      presentation: options.presentation ?? (() => null),
      theme: null,
      revision: sceneRevision(),
    })
  }

  async function render(): Promise<void> {
    const screen = options.screen.value
    const run = ++token
    if (!screen) {
      scene.value = null
      frame.value = null
      return
    }
    try {
      const next = compose(screen)
      scene.value = next
      error.value = ''
      if (!native) return
      const size = previewSize(screen)
      const result = await previewRender(next, size.width, size.height)
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
    () => [options.show.value, options.screen.value, options.media.value] as const,
    schedule,
    { immediate: true },
  )
  onBeforeUnmount(() => clearTimeout(timer))

  return { native, scene, frame, error, compose, render }
}
