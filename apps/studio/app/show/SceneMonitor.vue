<script setup lang="ts">
import { css, cx } from 'styled-system/css'
import { Icon } from '#components'
import type { Scene } from '@lumen/schema'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isTauriRuntime, previewRender, type DecodedPreview } from '~/control/render'
import { schematicLayers } from '~/screens/useScreenPreview'

/**
 * Draws one scene: through the native preview renderer in the desktop app, as
 * a schematic of its layers in the browser. Renders coalesce so a burst of
 * changes costs at most one follow-up render.
 */
const props = withDefaults(defineProps<{ scene: Scene | null; maxWidth?: number; label?: string }>(), {
  maxWidth: 960,
  label: 'Scene preview',
})

const native = isTauriRuntime()
const canvasEl = ref<HTMLCanvasElement | null>(null)
const frame = ref<DecodedPreview | null>(null)
let running = false
let queued = false
let disposed = false

const aspect = computed(() => {
  const viewport = props.scene?.viewport
  return viewport ? `${viewport.width} / ${viewport.height}` : '16 / 9'
})
const background = computed(() => {
  const layer = props.scene?.background
  return layer?.kind === 'shape' ? layer.fill : '#000000'
})
const schematic = computed(() => (props.scene ? schematicLayers(props.scene) : []))

function sizeFor(scene: Scene): { width: number; height: number } {
  const { width, height } = scene.viewport
  const scale = Math.min(1, props.maxWidth / Math.max(1, width))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
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
      const scene = props.scene
      if (!scene) {
        frame.value = null
        continue
      }
      const size = sizeFor(scene)
      try {
        const result = await previewRender(scene, size.width, size.height)
        if (!disposed) frame.value = result
      } catch {
        if (!disposed) frame.value = null
      }
    } while (queued && !disposed)
  } finally {
    running = false
  }
}

watch(() => props.scene, () => void render(), { immediate: true })

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
