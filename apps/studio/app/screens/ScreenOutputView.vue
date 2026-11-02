<script setup lang="ts">
import { css, cx } from 'styled-system/css'
import { Icon } from '#components'
import { identityCornerPin, meshForCornerPin, updateScreenMapping, type CornerPin } from '@lumen/core'
import type { Mesh, Point, Screen } from '@lumen/schema'
import { computed, nextTick, ref, toRef, watch } from 'vue'
import { Button, EmptyState, SegmentedControl, Switch, type SegmentOption } from '~/ui'
import type { MediaAsset } from '~/data/media'
import { useShowDocument } from '~/show/useShowDocument'
import { dragPoint, meshLines, replacePoint } from './geometry'
import { useScreenPreview } from './useScreenPreview'

const props = defineProps<{ screen: Screen | null; media: MediaAsset[] }>()

type Mode = 'pin' | 'mesh'

const showDocument = useShowDocument()
const mode = ref<Mode>('pin')
const showGrid = ref(true)
const frameEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const modeOptions: SegmentOption<Mode>[] = [
  { value: 'pin', label: 'Corner pin' },
  { value: 'mesh', label: 'Mesh' },
]

const preview = useScreenPreview({ show: showDocument.show, screen: toRef(props, 'screen'), media: toRef(props, 'media') })
const schematic = computed(() => preview.schematic.value?.layers ?? [])
const background = computed(() => preview.schematic.value?.background ?? '#000000')

watch(
  () => preview.frame.value,
  async (frame) => {
    await nextTick()
    const canvas = canvasEl.value
    if (!canvas || !frame) return
    canvas.width = frame.width
    canvas.height = frame.height
    const context = canvas.getContext('2d')
    if (!context) return
    const image = context.createImageData(frame.width, frame.height)
    image.data.set(frame.rgba)
    context.putImageData(image, 0, 0)
  },
)

const pin = computed<CornerPin>(() => (props.screen?.mapping.cornerPin as CornerPin | null) ?? identityCornerPin())
const mesh = computed<Mesh | null>(() => props.screen?.mapping.mesh ?? null)
const edgeBlend = computed(() => props.screen?.mapping.edgeBlend ?? null)
const lines = computed(() => (mesh.value ? meshLines(mesh.value.cols, mesh.value.rows) : []))

const frameStyle = computed(() => {
  const size = props.screen?.size ?? { width: 16, height: 9 }
  const ratio = size.width / size.height
  return { aspectRatio: `${size.width} / ${size.height}`, width: `min(100cqw, calc(100cqh * ${ratio}))` }
})

function polyline(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

const meshPolylines = computed(() => {
  const value = mesh.value
  if (!value) return []
  return lines.value.map((indexes) => polyline(indexes.map((index) => value.points[index]!)))
})

// --- Dragging handles --------------------------------------------------------

interface Drag {
  kind: Mode
  index: number
  start: Point
  startX: number
  startY: number
  rect: DOMRect
  pointerId: number
  target: HTMLElement
}
let drag: Drag | null = null

function setPoint(kind: Mode, index: number, point: Point): void {
  const screen = props.screen
  if (!screen) return
  showDocument.update(
    (show) => {
      if (kind === 'pin') return updateScreenMapping(show, screen.id, { cornerPin: replacePoint(pin.value, index, point) })
      const current = screen.mapping.mesh
      if (!current) return show
      return updateScreenMapping(show, screen.id, { mesh: { ...current, points: replacePoint([...current.points], index, point) } })
    },
    { coalesce: `${kind}:${screen.id}:${index}` },
  )
}

function onPointerDown(event: PointerEvent, kind: Mode, index: number, start: Point): void {
  if (event.button !== 0 || !frameEl.value || !(event.currentTarget instanceof HTMLElement)) return
  event.preventDefault()
  const target = event.currentTarget
  target.setPointerCapture(event.pointerId)
  drag = { kind, index, start, startX: event.clientX, startY: event.clientY, rect: frameEl.value.getBoundingClientRect(), pointerId: event.pointerId, target }
  target.addEventListener('pointermove', onPointerMove)
  target.addEventListener('pointerup', onPointerUp)
  target.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || drag.rect.width <= 0 || drag.rect.height <= 0) return
  const scale = event.shiftKey ? 0.1 : 1
  const dx = ((event.clientX - drag.startX) / drag.rect.width) * scale
  const dy = ((event.clientY - drag.startY) / drag.rect.height) * scale
  setPoint(drag.kind, drag.index, dragPoint(drag.start, dx, dy))
}

function onPointerUp(): void {
  if (!drag) return
  const { target } = drag
  target.removeEventListener('pointermove', onPointerMove)
  target.removeEventListener('pointerup', onPointerUp)
  target.removeEventListener('pointercancel', onPointerUp)
  if (target.hasPointerCapture(drag.pointerId)) target.releasePointerCapture(drag.pointerId)
  drag = null
}

/** Arrow keys nudge a focused handle; Shift moves ten times as far. */
function onHandleKey(event: KeyboardEvent, kind: Mode, index: number, start: Point): void {
  const step = event.shiftKey ? 0.01 : 0.001
  const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  const delta = moves[event.key]
  if (!delta) return
  event.preventDefault()
  setPoint(kind, index, dragPoint(start, delta[0], delta[1]))
}

function addMesh(): void {
  const screen = props.screen
  if (!screen) return
  showDocument.update((show) => updateScreenMapping(show, screen.id, { mesh: meshForCornerPin(4, 3, screen.mapping.cornerPin) }))
}

function resetPin(): void {
  const screen = props.screen
  if (!screen) return
  showDocument.update((show) => updateScreenMapping(show, screen.id, { cornerPin: null }))
}

const pinNames = ['Top left', 'Top right', 'Bottom right', 'Bottom left']

function handleStyle(point: Point): Record<string, string> {
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` }
}

function blendStyle(side: 'left' | 'right' | 'top' | 'bottom', width: number): Record<string, string> {
  const percent = `${width * 100}%`
  const direction = { left: 'to right', right: 'to left', top: 'to bottom', bottom: 'to top' }[side]
  const box: Record<string, string> =
    side === 'left' || side === 'right'
      ? { top: '0', bottom: '0', width: percent, [side]: '0' }
      : { left: '0', right: '0', height: percent, [side]: '0' }
  return { ...box, backgroundImage: `linear-gradient(${direction}, rgba(0,0,0,0.85), rgba(0,0,0,0))` }
}

const blendSides = computed(() => {
  const blend = edgeBlend.value
  if (!blend) return []
  return (['left', 'right', 'top', 'bottom'] as const).filter((side) => blend[side].width > 0).map((side) => ({ side, width: blend[side].width }))
})

const root = css({ flex: '1', minH: '0', display: 'flex', flexDirection: 'column' })
const bar = css({ display: 'flex', alignItems: 'center', gap: '3', px: '3', py: '2', flexWrap: 'wrap' })
const modeControl = css({ w: '[200px]', flexShrink: '0' })
const toggle = css({ display: 'flex', alignItems: 'center', gap: '1.5', textStyle: 'ui.xs', color: 'fg.muted' })
const note = css({ display: 'flex', alignItems: 'center', gap: '1.5', px: '3', pb: '2', textStyle: 'ui.xs', color: 'fg.subtle' })
const stage = css({ flex: '1', minH: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', p: '12', overflow: 'hidden', containerType: 'size' })
const frame = css({ position: 'relative', flexShrink: '0', borderWidth: '1px', borderColor: 'border.strong', overflow: 'visible' })
const layerBox = css({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  textAlign: 'center',
  color: '[#ffffff]',
  fontSize: '[clamp(8px, 1.6cqw, 22px)]',
  lineHeight: '[1.2]',
  whiteSpace: 'pre-line',
})
const mediaBox = css({ borderWidth: '1px', borderStyle: 'dashed', borderColor: '[rgba(255,255,255,0.5)]', color: '[rgba(255,255,255,0.7)]', gap: '1' })
const surface = css({ position: 'absolute', inset: '0', w: 'full', h: 'full' })
const overlay = css({ position: 'absolute', inset: '0', w: 'full', h: 'full', overflow: 'visible', pointerEvents: 'none' })
const blend = css({ position: 'absolute', pointerEvents: 'none' })
const handle = css({
  position: 'absolute',
  w: '[14px]',
  h: '[14px]',
  ml: '[-7px]',
  mt: '[-7px]',
  borderRadius: 'full',
  borderWidth: '2px',
  borderColor: 'accent.default',
  bg: 'bg.panel',
  cursor: 'grab',
  touchAction: 'none',
  outline: 'none',
  zIndex: '[2]',
  _focusVisible: { boxShadow: '[0 0 0 3px var(--colors-accent-muted)]' },
  _active: { cursor: 'grabbing' },
})
const meshHandle = css({ w: '[10px]', h: '[10px]', ml: '[-5px]', mt: '[-5px]', borderWidth: '1px' })
</script>

<template>
  <div v-if="!screen" :class="root">
    <EmptyState icon="lucide:monitor" title="No screen selected" description="Pick a screen in the list to edit its mapping." />
  </div>
  <div v-else :class="root">
    <div :class="bar">
      <div :class="modeControl">
        <SegmentedControl v-model="mode" :options="modeOptions" size="sm" aria-label="Handles" />
      </div>
      <label :class="toggle">
        <Switch v-model="showGrid" size="sm" aria-label="Show warp grid" />
        Warp grid
      </label>
      <Button v-if="mode === 'mesh' && !mesh" size="sm" variant="secondary" icon="lucide:grid-3x3" @click="addMesh">Add 4×3 mesh</Button>
      <Button v-if="mode === 'pin' && screen.mapping.cornerPin" size="sm" variant="ghost" icon="lucide:rotate-ccw" @click="resetPin">Reset corner pin</Button>
    </div>
    <p :class="note">
      <Icon name="lucide:info" :size="12" aria-hidden="true" />
      <template v-if="preview.native">The frame is the compositor's output with this mapping; handles are an overlay. Image output masks and stage layouts are not rendered.</template>
      <template v-else>The browser shows an unmapped schematic; the desktop app renders the mapped output.</template>
    </p>

    <div :class="stage">
      <div ref="frameEl" :class="frame" :style="{ ...frameStyle, background }">
        <canvas v-if="preview.native && preview.frame.value" ref="canvasEl" :class="surface" aria-label="Screen preview" />
        <div v-else :class="surface" aria-label="Screen preview (schematic)">
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
              <Icon :name="layer.kind === 'video' ? 'lucide:film' : 'lucide:image'" :size="16" aria-hidden="true" />
              {{ layer.kind === 'video' ? 'Video' : 'Image' }}
            </template>
          </div>
        </div>

        <span v-for="entry in blendSides" :key="entry.side" :class="blend" :style="blendStyle(entry.side, entry.width)" />

        <svg :class="overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          <polygon
            :points="polyline(pin)"
            fill="none"
            stroke="var(--colors-accent-default)"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />
          <template v-if="showGrid && mesh">
            <polyline
              v-for="(points, index) in meshPolylines"
              :key="index"
              :points="points"
              fill="none"
              stroke="var(--colors-warning-default)"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          </template>
        </svg>

        <template v-if="mode === 'pin'">
          <span
            v-for="(point, index) in pin"
            :key="`pin-${index}`"
            :class="handle"
            :style="handleStyle(point)"
            role="slider"
            tabindex="0"
            :aria-label="`${pinNames[index]} corner`"
            :aria-valuetext="`${point.x.toFixed(3)}, ${point.y.toFixed(3)}`"
            @pointerdown="onPointerDown($event, 'pin', index, point)"
            @keydown="onHandleKey($event, 'pin', index, point)"
          />
        </template>
        <template v-else-if="mesh">
          <span
            v-for="(point, index) in mesh.points"
            :key="`mesh-${index}`"
            :class="cx(handle, meshHandle)"
            :style="handleStyle(point)"
            role="slider"
            tabindex="0"
            :aria-label="`Mesh point ${index + 1}`"
            :aria-valuetext="`${point.x.toFixed(3)}, ${point.y.toFixed(3)}`"
            @pointerdown="onPointerDown($event, 'mesh', index, point)"
            @keydown="onHandleKey($event, 'mesh', index, point)"
          />
        </template>
      </div>
    </div>
  </div>
</template>
