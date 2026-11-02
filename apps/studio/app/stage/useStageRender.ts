import { slideComposition } from '@lumen/core'
import type { PresentationDoc, Screen, Theme } from '@lumen/schema'
import { ref, watch, type Ref } from 'vue'
import { isTauriRuntime, previewRenderComposition, type DecodedCompositionPreview } from '~/control/render'
import { getTheme } from '~/data/themes'
import { stageSlideScreen } from './stageModel'

const STAGE_RENDER_WIDTH = 960
let revision = 0

function rgbaToDataUrl(frame: DecodedCompositionPreview): string | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d')
  if (!context) return null
  const pixels = new Uint8ClampedArray(frame.rgba)
  context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0)
  return canvas.toDataURL('image/png')
}

const themeCache = new Map<string, Theme | null>()

async function themeFor(doc: PresentationDoc): Promise<Theme | null> {
  if (!doc.themeId) return null
  const cached = themeCache.get(doc.themeId)
  if (cached !== undefined) return cached
  const record = await getTheme(doc.themeId)
  const theme = record?.theme ?? null
  themeCache.set(doc.themeId, theme)
  return theme
}

async function renderSlide(doc: PresentationDoc, slideIndex: number, screen: Screen | null): Promise<string | null> {
  const width = STAGE_RENDER_WIDTH
  const height = Math.round((width * doc.settings.height) / doc.settings.width) || 540
  revision += 1
  const composition = slideComposition(doc, slideIndex, await themeFor(doc), { revision })
  const frame = await previewRenderComposition(composition, stageSlideScreen(screen, composition.canvas), width, height)
  return rgbaToDataUrl(frame)
}

/**
 * Renders a stage slide through the compositor (`preview_render_composition`)
 * as a one-slide composition, through the stage screen's text override when
 * there is one. Outside Tauri, or when the render or theme lookup fails,
 * `image` stays null and the view falls back to DOM slide text.
 */
export function useStageRender(
  doc: Ref<PresentationDoc | null>,
  slideIndex: Ref<number>,
  key: Ref<string>,
  screen: Ref<Screen | null> = ref(null),
) {
  const image = ref<string | null>(null)
  const error = ref('')
  let token = 0

  async function render(): Promise<void> {
    const run = ++token
    const presentation = doc.value
    if (!isTauriRuntime() || !presentation || !key.value) {
      image.value = null
      error.value = ''
      return
    }
    try {
      const url = await renderSlide(presentation, slideIndex.value, screen.value)
      if (run !== token) return
      image.value = url
      error.value = url ? '' : 'Preview renderer unavailable.'
    } catch (reason) {
      if (run !== token) return
      image.value = null
      error.value = reason instanceof Error ? reason.message : String(reason)
    }
  }

  watch([doc, slideIndex, key, screen], () => void render(), { immediate: true })

  return { image, error, render }
}
