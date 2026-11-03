<script setup lang="ts">
import { css, cx } from 'styled-system/css'
import { Icon } from '#components'
import type { Composition, Screen } from '@lumen/schema'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isTauriRuntime, previewRenderComposition, type DecodedCompositionPreview } from '~/control/render'
import { compositionHasVideo, useVideoRefresh, VIDEO_REFRESH_MS } from '~/control/videoRefresh'
import { schematicFrame } from './schematic'

/**
 * Draws one composition as a screen shows it (layout, mapping, blackout, test
 * pattern), or the bare canvas when `screen` is null: through the v2
 * compositor (`preview_render_composition`) in the desktop app, as a schematic
 * of its layers in the browser. Renders coalesce so a burst of changes costs
 * at most one follow-up render; `throttleMs` spaces renders further for
 * thumbnails.
 */
const props = withDefaults(
  defineProps<{
    composition: Composition | null
    screen?: Screen | null
    maxWidth?: number
    label?: string
    throttleMs?: number
  }>(),
  {
    screen: null,
    maxWidth: 960,
    label: 'Composition preview',
    throttleMs: 0,
  },
)

const native = isTauriRuntime()
const canvasEl = ref<HTMLCanvasElement | null>(null)
const frame = ref<DecodedCompositionPreview | null>(null)
let running = false
let queued = false
let disposed = false

const outputSize = computed(() => props.screen?.size ?? props.composition?.canvas ?? { width: 16, height: 9 })
const aspect = computed(() => `${outputSize.value.width} / ${outputSize.value.height}`)
const drawn = computed(() => (!native && props.composition ? schematicFrame(props.composition, props.screen) : null))
const background = computed(() => drawn.value?.background ?? '#000000')
const schematic = computed(() => drawn.value?.layers ?? [])

function sizeFor(size: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, props.maxWidth / Math.max(1, size.width))
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function render(): Promise<void> {
  if (!native || disposed) return
  if (running) {
    queued = true
    return
  }
  running = true
  try {
    do {
      queued = false
      const composition = props.composition
      if (!composition) {
        frame.value = null
        continue
      }
      const size = sizeFor(outputSize.value)
      try {
        const result = await previewRenderComposition(composition, props.screen, size.width, size.height)
        if (!disposed) frame.value = result
      } catch {
        if (!disposed) frame.value = null
      }
      if (props.throttleMs > 0 && !disposed) await pause(props.throttleMs)
    } while (queued && !disposed)
  } finally {
    running = false
  }
}

// Screens are often rebuilt per render (mode applied); compare them by value.
const screenKey = computed(() => (props.screen ? JSON.stringify(props.screen) : ''))
watch(() => [props.composition, screenKey.value] as const, () => void render(), { immediate: true })
// Playing video only changes frames, not the composition: keep rendering.
useVideoRefresh(
  () => native && compositionHasVideo(props.composition),
  render,
  Math.max(VIDEO_REFRESH_MS, props.throttleMs),
)

watch(frame, async (value) => {
  await nextTick()
  const canvas = canvasEl.value
  if (!canvas || !value) return
  canvas.width = value.width
  canvas.height = value.height
  const context = canvas.getContext('2d')
  if (!context) return
  const image = context.createImageData(value.width, value.height)
  image.data.set(value.rgba)
  context.putImageData(image, 0, 0)
})

onBeforeUnmount(() => {
  disposed = true
})

const root = css({ position: 'relative', w: 'full', overflow: 'hidden', borderRadius: 'sm', containerType: 'inline-size' })
const surface = css({ position: 'absolute', inset: '0', w: 'full', h: 'full' })
const layerBox = css({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  textAlign: 'center',
  color: '[#ffffff]',
  fontSize: '[clamp(7px, 3.2cqw, 22px)]',
  lineHeight: '[1.2]',
  whiteSpace: 'pre-line',
})
const mediaBox = css({ borderWidth: '1px', borderStyle: 'dashed', borderColor: '[rgba(255,255,255,0.5)]', color: '[rgba(255,255,255,0.7)]', gap: '1' })
</script>

<template>
  <div :class="root" :style="{ aspectRatio: aspect, background }">
    <canvas v-if="native && frame" ref="canvasEl" :class="surface" :aria-label="label" />
    <div v-else :class="surface" role="img" :aria-label="`${label} (schematic)`">
      <div
        v-for="layer in schematic"
        :key="layer.id"
        :class="cx(layerBox, (layer.kind === 'image' || layer.kind === 'video') && mediaBox)"
        :style="{
          left: `${layer.x * 100}%`,
          top: `${layer.y * 100}%`,
          width: `${layer.w * 100}%`,
          height: `${layer.h * 100}%`,
          opacity: String(layer.opacity),
          background: layer.fill ?? undefined,
        }"
      >
        <template v-if="layer.kind === 'text'">{{ layer.text }}</template>
        <template v-else-if="layer.kind === 'image' || layer.kind === 'video'">
          <Icon :name="layer.kind === 'video' ? 'lucide:film' : 'lucide:image'" :size="14" aria-hidden="true" />
        </template>
      </div>
    </div>
    <slot />
  </div>
</template>
