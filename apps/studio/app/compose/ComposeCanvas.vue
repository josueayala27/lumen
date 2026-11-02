<script setup lang="ts">
import { Icon } from '#components'
import type { Composition, LayerTransform, Source } from '@lumen/schema'
import { css, cx } from 'styled-system/css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  RESIZE_HANDLES,
  SNAP_DISTANCE,
  dragTransform,
  normalizedDelta,
  roundTransform,
  sourceCss,
  sourceIcon,
  sourceLabel,
  transformStyle,
  type TransformHandle,
} from './composeModel'
import type { ComposePreviewFrame } from './useComposePreview'

/**
 * The canvas preview with selection and transform handles. Inside Tauri it
 * shows the Rust render; in a browser it draws an approximation from the
 * composition (solids, gradients and labelled boxes).
 */
const props = defineProps<{
  composition: Composition
  selectedId: string | null
  frame: ComposePreviewFrame | null
  rendered: boolean
}>()

const emit = defineEmits<{
  select: [layerId: string | null]
  dragStart: []
  transform: [layerId: string, transform: LayerTransform]
  dragEnd: []
}>()

const host = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const hostSize = ref({ width: 0, height: 0 })
let observer: ResizeObserver | null = null

const stageSize = computed(() => {
  const { width, height } = hostSize.value
  const ratio = props.composition.canvas.width / props.composition.canvas.height
  if (width <= 0 || height <= 0 || !Number.isFinite(ratio)) return { width: 0, height: 0 }
  return width / height > ratio ? { width: height * ratio, height } : { width, height: width / ratio }
})

const sources = computed(() => new Map(props.composition.sources.map((source) => [source.id, source])))
const visibleLayers = computed(() =>
  props.composition.layers.filter((layer) => layer.enabled).map((layer) => ({ layer, source: layer.sourceId ? sources.value.get(layer.sourceId) ?? null : null })),
)
const selected = computed(() => props.composition.layers.find((layer) => layer.id === props.selectedId) ?? null)

function draw(): void {
  const frame = props.frame
  const element = canvas.value
  if (!frame || !element) return
  element.width = frame.width
  element.height = frame.height
  element.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0)
}

watch(() => props.frame, draw)

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry) hostSize.value = { width: entry.contentRect.width, height: entry.contentRect.height }
  })
  if (host.value) observer.observe(host.value)
  draw()
})

interface Drag {
  layerId: string
  handle: TransformHandle
  start: LayerTransform
  x: number
  y: number
  moved: boolean
}
let drag: Drag | null = null

function onPointerDown(event: PointerEvent, layerId: string, handle: TransformHandle): void {
  if (event.button !== 0) return
  const layer = props.composition.layers.find((entry) => entry.id === layerId)
  if (!layer) return
  event.preventDefault()
  event.stopPropagation()
  if (layerId !== props.selectedId) emit('select', layerId)
  drag = { layerId, handle, start: { ...layer.transform }, x: event.clientX, y: event.clientY, moved: false }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent): void {
  const rect = stage.value?.getBoundingClientRect()
  if (!drag || !rect) return
  const dxPx = event.clientX - drag.x
  const dyPx = event.clientY - drag.y
  if (!drag.moved) {
    if (Math.hypot(dxPx, dyPx) < 3) return
    drag.moved = true
    emit('dragStart')
  }
  const { dx, dy } = normalizedDelta(dxPx, dyPx, rect)
  const next = dragTransform(drag.start, drag.handle, dx, dy, {
    keepAspect: event.shiftKey,
    fromCenter: event.altKey,
    snap: event.metaKey || event.ctrlKey ? 0 : SNAP_DISTANCE,
  })
  emit('transform', drag.layerId, roundTransform(next))
}

function onPointerUp(): void {
  if (drag?.moved) emit('dragEnd')
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

onBeforeUnmount(() => {
  observer?.disconnect()
  onPointerUp()
})

function fallbackStyle(source: Source, opacity: number): Record<string, string> {
  const background = sourceCss(source)
  return { ...(background ? { background } : {}), opacity: String(opacity * props.composition.master.opacity) }
}

const HANDLE_POSITIONS: Record<string, Record<string, string>> = {
  nw: { left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', cursor: 'ew-resize' },
}

const hostClass = css({ position: 'relative', flex: '1', minH: '0', minW: '0', display: 'grid', placeItems: 'center' })
const stageClass = css({ position: 'relative', bg: '[#000000]', boxShadow: 'md', overflow: 'visible' })
const clip = css({ position: 'absolute', inset: '0', overflow: 'hidden' })
const canvasClass = css({ position: 'absolute', inset: '0', w: 'full', h: 'full' })
const box = css({ position: 'absolute', transformOrigin: 'center' })
const placeholder = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '1.5',
  bg: '[rgba(255, 255, 255, 0.06)]',
  borderWidth: '1px',
  borderStyle: 'dashed',
  borderColor: '[rgba(255, 255, 255, 0.25)]',
  color: '[rgba(255, 255, 255, 0.7)]',
  textStyle: 'ui.xs',
  overflow: 'hidden',
})
const hit = css({ position: 'absolute', transformOrigin: 'center', cursor: 'move' })
const outline = css({ outlineWidth: '1px', outlineStyle: 'solid', outlineColor: 'accent.default' })
const handleClass = css({
  position: 'absolute',
  w: '2',
  h: '2',
  bg: 'fg.onAccent',
  borderWidth: '1px',
  borderColor: 'accent.default',
  borderRadius: 'xs',
  transform: 'translate(-50%, -50%)',
})
</script>

<template>
  <div ref="host" :class="hostClass" @pointerdown.self="emit('select', null)">
    <div
      ref="stage"
      :class="stageClass"
      :style="{ width: `${stageSize.width}px`, height: `${stageSize.height}px` }"
      @pointerdown.self="emit('select', null)"
    >
      <div :class="clip">
        <canvas v-if="rendered" ref="canvas" :class="canvasClass" aria-label="Composition preview" />
        <template v-else>
          <template v-for="{ layer, source } in visibleLayers" :key="layer.id">
            <div
              v-if="source"
              :class="cx(box, !sourceCss(source) && placeholder)"
              :style="{ ...transformStyle(layer.transform), ...fallbackStyle(source, layer.opacity) }"
            >
              <template v-if="!sourceCss(source)">
                <Icon :name="sourceIcon(source)" :size="14" aria-hidden="true" />
                {{ sourceLabel(source) }}
              </template>
            </div>
          </template>
        </template>
      </div>
      <div
        v-for="{ layer } in visibleLayers"
        :key="`hit-${layer.id}`"
        :class="hit"
        :style="transformStyle(layer.transform)"
        :aria-label="`Select ${layer.name}`"
        @pointerdown="onPointerDown($event, layer.id, 'move')"
      />
      <div v-if="selected" :class="cx(hit, outline)" :style="transformStyle(selected.transform)" @pointerdown="onPointerDown($event, selected.id, 'move')">
        <span
          v-for="handle in RESIZE_HANDLES"
          :key="handle"
          :class="handleClass"
          :style="HANDLE_POSITIONS[handle]"
          :aria-label="`Resize ${handle}`"
          @pointerdown="onPointerDown($event, selected.id, handle)"
        />
      </div>
    </div>
  </div>
</template>
