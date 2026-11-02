<script setup lang="ts">
import { css, cx } from 'styled-system/css'
import { sideBySideRegions, updateScreenLayout } from '@lumen/core'
import type { Region, Screen } from '@lumen/schema'
import { computed, ref } from 'vue'
import { Button, NumberField, Tooltip } from '~/ui'
import { useShowDocument } from '~/show/useShowDocument'
import { RESIZE_HANDLES, dragRegion, regionPixels, snapRegion, snapTargets, type RegionHandle, type SnapGuide } from './geometry'

defineProps<{ selectedId: string | null }>()
const emit = defineEmits<{ select: [id: string] }>()

/** Snap distance in screen pixels. */
const SNAP_PX = 8

const showDocument = useShowDocument()
const composition = computed(() => showDocument.composition.value)
const screens = computed(() => showDocument.screens.value)
const canvasEl = ref<HTMLElement | null>(null)
const guides = ref<SnapGuide[]>([])
const overlapPercent = ref('0')

interface Drag {
  screenId: string
  handle: RegionHandle
  start: Region
  startX: number
  startY: number
  rect: DOMRect
  pointerId: number
  target: HTMLElement
}
let drag: Drag | null = null

/** Fits the canvas inside the stage at the composition's aspect (the stage is a size container). */
const canvasStyle = computed(() => {
  const { width, height } = composition.value.canvas
  const ratio = width / height
  return { aspectRatio: `${width} / ${height}`, width: `min(100cqw, calc(100cqh * ${ratio}))` }
})

function setRegion(screenId: string, region: Region): void {
  showDocument.update((show) => updateScreenLayout(show, screenId, { region }), { coalesce: `region:${screenId}` })
}

function onPointerDown(event: PointerEvent, screen: Screen, handle: RegionHandle): void {
  if (event.button !== 0 || !canvasEl.value || !(event.currentTarget instanceof HTMLElement)) return
  event.preventDefault()
  event.stopPropagation()
  emit('select', screen.id)
  const target = event.currentTarget
  target.setPointerCapture(event.pointerId)
  drag = {
    screenId: screen.id,
    handle,
    start: { ...screen.layout.region },
    startX: event.clientX,
    startY: event.clientY,
    rect: canvasEl.value.getBoundingClientRect(),
    pointerId: event.pointerId,
    target,
  }
  target.addEventListener('pointermove', onPointerMove)
  target.addEventListener('pointerup', onPointerUp)
  target.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || drag.rect.width <= 0 || drag.rect.height <= 0) return
  const dx = (event.clientX - drag.startX) / drag.rect.width
  const dy = (event.clientY - drag.startY) / drag.rect.height
  const moved = dragRegion(drag.start, drag.handle, dx, dy)
  let region = moved
  if (event.altKey) {
    guides.value = []
  } else {
    const others = screens.value.filter((screen) => screen.id !== drag?.screenId).map((screen) => screen.layout.region)
    const snapped = snapRegion(moved, drag.handle, snapTargets(others), SNAP_PX / drag.rect.width)
    region = snapped.region
    guides.value = snapped.guides
  }
  setRegion(drag.screenId, region)
}

function onPointerUp(): void {
  if (!drag) return
  const { target } = drag
  target.removeEventListener('pointermove', onPointerMove)
  target.removeEventListener('pointerup', onPointerUp)
  target.removeEventListener('pointercancel', onPointerUp)
  if (target.hasPointerCapture(drag.pointerId)) target.releasePointerCapture(drag.pointerId)
  drag = null
  guides.value = []
}

/** Arrow keys nudge the region of a focused screen; Shift moves ten times as far. */
function onKeydown(event: KeyboardEvent, screen: Screen): void {
  const step = event.shiftKey ? 0.01 : 0.001
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const delta = moves[event.key]
  if (!delta) return
  event.preventDefault()
  setRegion(screen.id, dragRegion(screen.layout.region, 'move', delta[0], delta[1]))
}

const enabledScreens = computed(() => screens.value.filter((screen) => screen.enabled))

/** Splits the canvas across the enabled screens, in list order. */
function splitSideBySide(): void {
  const targets = enabledScreens.value
  if (targets.length === 0) return
  const overlap = Math.min(0.5, Math.max(0, (Number.parseFloat(overlapPercent.value) || 0) / 100))
  const regions = sideBySideRegions(targets.length, overlap)
  showDocument.update((show) =>
    targets.reduce((next, screen, index) => updateScreenLayout(next, screen.id, { region: regions[index]! }), show),
  )
}

function fillCanvas(): void {
  showDocument.update((show) =>
    enabledScreens.value.reduce((next, screen) => updateScreenLayout(next, screen.id, { region: { x: 0, y: 0, w: 1, h: 1 } }), show),
  )
}

function boxStyle(region: Region): Record<string, string> {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.w * 100}%`,
    height: `${region.h * 100}%`,
  }
}

function handleStyle(handle: RegionHandle): Record<string, string> {
  const x = handle.includes('w') ? '0%' : handle.includes('e') ? '100%' : '50%'
  const y = handle.includes('n') ? '0%' : handle.includes('s') ? '100%' : '50%'
  const cursor = handle === 'n' || handle === 's' ? 'ns-resize' : handle === 'e' || handle === 'w' ? 'ew-resize' : handle === 'ne' || handle === 'sw' ? 'nesw-resize' : 'nwse-resize'
  return { left: x, top: y, cursor }
}

function sizeLabel(region: Region): string {
  const pixels = regionPixels(region, composition.value.canvas)
  return `${pixels.width}×${pixels.height}`
}

const root = css({ flex: '1', minH: '0', display: 'flex', flexDirection: 'column' })
const bar = css({ display: 'flex', alignItems: 'center', gap: '2', px: '3', py: '2', flexWrap: 'wrap' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const overlapField = css({ w: '[96px]' })
const stage = css({ flex: '1', minH: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3', p: '8', overflow: 'hidden', containerType: 'size' })
const canvas = css({
  position: 'relative',
  flexShrink: '0',
  bg: 'bg.subtle',
  borderWidth: '1px',
  borderColor: 'border.strong',
  borderRadius: 'sm',
  backgroundImage: '[linear-gradient(var(--colors-border-default) 1px, transparent 1px), linear-gradient(90deg, var(--colors-border-default) 1px, transparent 1px)]',
  backgroundSize: '[10% 10%]',
})
const region = css({
  position: 'absolute',
  borderWidth: '1px',
  borderColor: 'accent.default',
  bg: 'accent.soft',
  cursor: 'move',
  touchAction: 'none',
  outline: 'none',
  _focusVisible: { boxShadow: '[0 0 0 2px var(--colors-accent-default)]' },
})
const regionSelected = css({ borderWidth: '2px', bg: 'accent.muted', zIndex: '1' })
const regionOff = css({ borderStyle: 'dashed', borderColor: 'border.strong', bg: 'transparent' })
const label = css({
  position: 'absolute',
  top: '1',
  left: '1',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5',
  px: '1.5',
  py: '1',
  borderRadius: 'sm',
  bg: 'bg.panel',
  textStyle: 'ui.xs',
  color: 'fg.default',
  pointerEvents: 'none',
  maxW: '[calc(100% - 8px)]',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
})
const labelMeta = css({ color: 'fg.subtle', textStyle: 'ui.mono' })
const handle = css({
  position: 'absolute',
  w: '[10px]',
  h: '[10px]',
  ml: '[-5px]',
  mt: '[-5px]',
  borderRadius: 'xs',
  borderWidth: '1px',
  borderColor: 'accent.default',
  bg: 'bg.panel',
  touchAction: 'none',
})
const guide = css({ position: 'absolute', bg: 'accent.default', pointerEvents: 'none', zIndex: '2' })
const empty = css({ textStyle: 'ui.sm', color: 'fg.subtle' })
</script>

<template>
  <div :class="root">
    <div :class="bar">
      <Tooltip content="Give each enabled screen an equal slice of the canvas, left to right in list order">
        <Button size="sm" variant="secondary" icon="lucide:columns-3" :disabled="enabledScreens.length === 0" @click="splitSideBySide">
          Split side by side
        </Button>
      </Tooltip>
      <NumberField
        v-model="overlapPercent"
        :units="['%']"
        :min="0"
        :max="50"
        :decimals="1"
        label="Overlap"
        size="sm"
        aria-label="Overlap between neighbours"
        :class="overlapField"
      />
      <Button size="sm" variant="ghost" icon="lucide:maximize" :disabled="enabledScreens.length === 0" @click="fillCanvas">Fill canvas</Button>
      <span :class="hint">
        Canvas {{ composition.canvas.width }}×{{ composition.canvas.height }} · drag to move, handles to resize · Alt turns snapping off
      </span>
    </div>

    <div :class="stage">
      <div ref="canvasEl" :class="canvas" :style="canvasStyle" role="group" aria-label="Composition canvas">
        <div
          v-for="screen in screens"
          :key="screen.id"
          :class="cx(region, screen.id === selectedId && regionSelected, !screen.enabled && regionOff)"
          :style="boxStyle(screen.layout.region)"
          tabindex="0"
          role="button"
          :aria-label="`${screen.name || 'Screen'} region`"
          :aria-pressed="screen.id === selectedId"
          @pointerdown="onPointerDown($event, screen, 'move')"
          @keydown="onKeydown($event, screen)"
          @focus="emit('select', screen.id)"
        >
          <span :class="label">
            {{ screen.name || 'Screen' }}
            <span :class="labelMeta">{{ sizeLabel(screen.layout.region) }} → {{ screen.size.width }}×{{ screen.size.height }}</span>
          </span>
          <template v-if="screen.id === selectedId">
            <span
              v-for="name in RESIZE_HANDLES"
              :key="name"
              :class="handle"
              :style="handleStyle(name)"
              :aria-label="`Resize ${name}`"
              @pointerdown="onPointerDown($event, screen, name)"
            />
          </template>
        </div>
        <span
          v-for="(line, index) in guides"
          :key="index"
          :class="guide"
          :style="line.axis === 'x'
            ? { left: `${line.position * 100}%`, top: '0', bottom: '0', width: '1px' }
            : { top: `${line.position * 100}%`, left: '0', right: '0', height: '1px' }"
        />
      </div>
      <p v-if="screens.length === 0" :class="empty">Add a screen to place it on the canvas.</p>
    </div>
  </div>
</template>
