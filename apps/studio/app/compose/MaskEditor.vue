<script setup lang="ts">
import type { Mask } from '@lumen/schema'
import { css } from 'styled-system/css'
import { computed } from 'vue'
import { IconButton, PropertyRow, SegmentedControl, Select, Switch, type SegmentOption, type SelectOption } from '~/ui'
import { defaultMask, type MaskKind } from './composeModel'
import NumField from './NumField.vue'

/** Layer mask editor: none, rect, polygon (point list) or an image matte. Coordinates are normalized to the layer. */
const props = defineProps<{
  mask: Mask | null
  images: readonly { id: string; name: string; sha256: string }[]
}>()

/** `field` names the edited value so slider drags coalesce into one undo step. */
const emit = defineEmits<{ change: [mask: Mask | null, field?: string] }>()

const kind = computed<MaskKind>(() => props.mask?.kind ?? 'none')

const kindOptions: SegmentOption<MaskKind>[] = [
  { value: 'none', label: 'None' },
  { value: 'rect', label: 'Rect' },
  { value: 'polygon', label: 'Polygon' },
  { value: 'image', label: 'Image' },
]

const imageOptions = computed<SelectOption[]>(() => props.images.map((image) => ({ value: image.id, label: image.name })))

function setKind(next: MaskKind | undefined): void {
  if (!next || next === kind.value) return
  const first = props.images[0]
  emit('change', defaultMask(next, first ? { assetId: first.id, hash: first.sha256 } : undefined))
}

function patch(values: Partial<Mask>, field?: string): void {
  if (!props.mask) return
  emit('change', { ...props.mask, ...values } as Mask, field)
}

function setPoint(index: number, axis: 0 | 1, value: number): void {
  if (props.mask?.kind !== 'polygon') return
  const points = props.mask.points.map((point, at) => {
    if (at !== index) return point
    const next: [number, number] = [point[0], point[1]]
    next[axis] = value
    return next
  })
  patch({ points }, `point:${index}:${axis}`)
}

function addPoint(): void {
  if (props.mask?.kind !== 'polygon') return
  const points = props.mask.points
  const last = points[points.length - 1]!
  const first = points[0]!
  patch({ points: [...points, [(last[0] + first[0]) / 2, (last[1] + first[1]) / 2]] })
}

function removePoint(index: number): void {
  if (props.mask?.kind !== 'polygon' || props.mask.points.length <= 3) return
  patch({ points: props.mask.points.filter((_, at) => at !== index) })
}

function setImage(id: string | undefined): void {
  const image = props.images.find((entry) => entry.id === id)
  if (image) patch({ asset: { assetId: image.id, hash: image.sha256 } })
}

const pointRow = css({ display: 'grid', gridTemplateColumns: '[minmax(0, 1fr) minmax(0, 1fr) auto]', gap: '1', alignItems: 'center', w: 'full' })
const pair = css({ display: 'grid', gridTemplateColumns: '[1fr 1fr]', gap: '1', w: 'full' })
const note = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
</script>

<template>
  <div>
    <PropertyRow label="Kind">
      <SegmentedControl :model-value="kind" :options="kindOptions" size="sm" fill aria-label="Mask kind" @update:model-value="setKind" />
    </PropertyRow>
    <p v-if="kind === 'image' && !mask" :class="note">Import an image in Media to use it as a matte.</p>

    <template v-if="mask?.kind === 'rect'">
      <PropertyRow label="Position">
        <div :class="pair">
          <NumField label="X" :value="mask.x" :scale="100" unit="%" :decimals="1" @change="patch({ x: $event }, 'x')" />
          <NumField label="Y" :value="mask.y" :scale="100" unit="%" :decimals="1" @change="patch({ y: $event }, 'y')" />
        </div>
      </PropertyRow>
      <PropertyRow label="Size">
        <div :class="pair">
          <NumField label="W" :value="mask.w" :min="0" :scale="100" unit="%" :decimals="1" @change="patch({ w: $event }, 'w')" />
          <NumField label="H" :value="mask.h" :min="0" :scale="100" unit="%" :decimals="1" @change="patch({ h: $event }, 'h')" />
        </div>
      </PropertyRow>
      <PropertyRow label="Radius">
        <NumField :value="mask.radius" :min="0" :max="0.5" :step="0.01" :scale="100" unit="%" :decimals="1" aria-label="Radius" @change="patch({ radius: $event }, 'radius')" />
      </PropertyRow>
    </template>

    <template v-if="mask?.kind === 'polygon'">
      <PropertyRow v-for="(point, index) in mask.points" :key="index" :label="`Point ${index + 1}`">
        <div :class="pointRow">
          <NumField label="X" :value="point[0]" :scale="100" unit="%" :decimals="1" @change="setPoint(index, 0, $event)" />
          <NumField label="Y" :value="point[1]" :scale="100" unit="%" :decimals="1" @change="setPoint(index, 1, $event)" />
          <IconButton icon="lucide:minus" label="Remove point" size="sm" :disabled="mask.points.length <= 3" @click="removePoint(index)" />
        </div>
      </PropertyRow>
      <PropertyRow label="">
        <IconButton icon="lucide:plus" label="Add point" size="sm" @click="addPoint" />
      </PropertyRow>
    </template>

    <template v-if="mask?.kind === 'image'">
      <PropertyRow label="Image">
        <Select :model-value="mask.asset.assetId" :options="imageOptions" size="sm" placeholder="Pick an image" aria-label="Mask image" @update:model-value="setImage" />
      </PropertyRow>
    </template>

    <PropertyRow v-if="mask && mask.kind !== 'image'" label="Feather">
      <NumField :value="mask.feather" :min="0" :max="1" :step="0.01" :scale="100" unit="%" :decimals="1" aria-label="Feather" @change="patch({ feather: $event }, 'feather')" />
    </PropertyRow>
    <PropertyRow v-if="mask" label="Invert">
      <Switch :model-value="mask.invert" size="sm" aria-label="Invert mask" @update:model-value="patch({ invert: $event })" />
    </PropertyRow>
  </div>
</template>
