import { buildScene } from '@lumen/core'
import type { PresentationDoc, Theme } from '@lumen/schema'
import { ref, watch, type Ref } from 'vue'
import { getTheme } from '~/data/themes'

const STAGE_RENDER_WIDTH = 960
let revision = 0

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export interface PreviewFrame {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

/** Decodes the binary `preview_render` IPC payload: width, height, layout length, layout, RGBA. */
export function parsePreviewFrame(buffer: ArrayBuffer): PreviewFrame | null {
  if (buffer.byteLength < 12) return null
  const view = new DataView(buffer)
  const width = view.getUint32(0, true)
  const height = view.getUint32(4, true)
  const layoutLength = view.getUint32(8, true)
  const offset = 12 + layoutLength
  if (width === 0 || height === 0) return null
  if (offset + width * height * 4 > buffer.byteLength) return null
  return { width, height, rgba: new Uint8ClampedArray(buffer, offset, width * height * 4) }
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
  }
  return null
}

function rgbaToDataUrl(frame: PreviewFrame): string | null {
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

async function renderSlide(doc: PresentationDoc, slideIndex: number): Promise<string | null> {
  const width = STAGE_RENDER_WIDTH
  const height = Math.round((width * doc.settings.height) / doc.settings.width) || 540
  const scene = buildScene(
    doc,
    await themeFor(doc),
    slideIndex,
    { width, height, scale: 1 },
    { assets: [], fonts: [], revision: (revision += 1), role: 'stage' },
  )
  const { invoke } = await import('@tauri-apps/api/core')
  const response = await invoke<ArrayBuffer>('preview_render', { scene, width, height })
  const buffer = toArrayBuffer(response)
  const frame = buffer ? parsePreviewFrame(buffer) : null
  return frame ? rgbaToDataUrl(frame) : null
}

/**
 * Renders a stage slide through the Rust preview renderer. Outside Tauri, or when
 * the command or theme lookup fails, `image` stays null and the view falls back
 * to DOM slide text.
 */
export function useStageRender(
  doc: Ref<PresentationDoc | null>,
  slideIndex: Ref<number>,
  key: Ref<string>,
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
      const url = await renderSlide(presentation, slideIndex.value)
      if (run !== token) return
      image.value = url
      error.value = url ? '' : 'Preview renderer unavailable.'
    } catch (reason) {
      if (run !== token) return
      image.value = null
      error.value = reason instanceof Error ? reason.message : String(reason)
    }
  }

  watch([doc, slideIndex, key], () => void render(), { immediate: true })

  return { image, error, render }
}
