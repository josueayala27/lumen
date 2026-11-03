<script setup lang="ts">
import {
  addLayerEffect,
  createEffect,
  moveLayerEffect,
  removeLayerEffect,
  setLayerMask,
  setLayerSource,
  updateCompositionLayer,
  updateLayerEffect,
  type LayerPatch,
} from '@lumen/core'
import { BLEND_MODES, type BlendMode, type EffectKind, type Fit, type Layer, type LayerTransform, type Mask, type ParamValue, type Source } from '@lumen/schema'
import { css } from 'styled-system/css'
import { isTauri } from '~/output/api'
import { computed } from 'vue'
import { PanelSection, PropertyRow, SegmentedControl, Select, Slider, type SegmentOption, type SelectOption } from '~/ui'
import { useShowDocument } from '~/show/useShowDocument'
import { sourceLabel } from './composeModel'
import EffectChain from './EffectChain.vue'
import MaskEditor from './MaskEditor.vue'
import NumField from './NumField.vue'

/** The browser preview approximates; the desktop compositor renders everything. */
const desktop = isTauri()

const props = defineProps<{
  layer: Layer
  sources: Source[]
  images: readonly { id: string; name: string; sha256: string }[]
}>()

const doc = useShowDocument()

const NO_SOURCE = '__none__'

const sourceOptions = computed<SelectOption[]>(() => [
  { value: NO_SOURCE, label: 'None' },
  ...props.sources.map((source) => ({ value: source.id, label: sourceLabel(source) })),
])

const fitOptions: SegmentOption<Fit>[] = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'stretch', label: 'Stretch' },
]

const blendOptions: SelectOption[] = BLEND_MODES.map((mode) => ({ value: mode, label: mode === 'alpha' ? 'Alpha matte' : mode[0]!.toUpperCase() + mode.slice(1) }))

function patch(values: LayerPatch, field?: string): void {
  const id = props.layer.id
  doc.updateComposition((composition) => updateCompositionLayer(composition, id, values), field ? { coalesce: `layer:${id}:${field}` } : {})
}

function setTransform(field: keyof LayerTransform, value: number): void {
  patch({ transform: { [field]: value } }, `transform.${field}`)
}

function setSource(id: string | undefined): void {
  const layerId = props.layer.id
  doc.updateComposition((composition) => setLayerSource(composition, layerId, !id || id === NO_SOURCE ? null : id))
}

function setMask(mask: Mask | null, field?: string): void {
  const id = props.layer.id
  doc.updateComposition((composition) => setLayerMask(composition, id, mask), field ? { coalesce: `mask:${id}:${field}` } : {})
}

function addEffect(kind: EffectKind): void {
  const id = props.layer.id
  doc.updateComposition((composition) => addLayerEffect(composition, id, createEffect(kind)))
}

function removeEffect(effectId: string): void {
  const id = props.layer.id
  doc.updateComposition((composition) => removeLayerEffect(composition, id, effectId))
}

function moveEffect(effectId: string, index: number): void {
  const id = props.layer.id
  doc.updateComposition((composition) => moveLayerEffect(composition, id, effectId, index))
}

function toggleEffect(effectId: string, enabled: boolean): void {
  const id = props.layer.id
  doc.updateComposition((composition) => updateLayerEffect(composition, id, effectId, { enabled }))
}

function setEffectParam(effectId: string, name: string, value: ParamValue): void {
  const id = props.layer.id
  doc.updateComposition((composition) => updateLayerEffect(composition, id, effectId, { params: { [name]: value } }), {
    coalesce: `effect:${effectId}:${name}`,
  })
}

const pair = css({ display: 'grid', gridTemplateColumns: '[1fr 1fr]', gap: '1', w: 'full' })
const sliderRow = css({ display: 'grid', gridTemplateColumns: '[minmax(0, 1fr) token(sizes.16)]', alignItems: 'center', gap: '2', w: 'full' })
const note = css({ textStyle: 'ui.xs', color: 'fg.subtle', py: '1' })
</script>

<template>
  <div>
    <PanelSection title="Source">
      <PropertyRow label="Source">
        <Select :model-value="layer.sourceId ?? NO_SOURCE" :options="sourceOptions" size="sm" aria-label="Layer source" @update:model-value="setSource" />
      </PropertyRow>
      <PropertyRow label="Fit">
        <SegmentedControl :model-value="layer.fit" :options="fitOptions" size="sm" fill aria-label="Fit" @update:model-value="$event && patch({ fit: $event })" />
      </PropertyRow>
    </PanelSection>

    <PanelSection title="Transform">
      <PropertyRow label="Position">
        <div :class="pair">
          <NumField label="X" :value="layer.transform.x" :scale="100" unit="%" :decimals="1" :step="0.5" @change="setTransform('x', $event)" />
          <NumField label="Y" :value="layer.transform.y" :scale="100" unit="%" :decimals="1" :step="0.5" @change="setTransform('y', $event)" />
        </div>
      </PropertyRow>
      <PropertyRow label="Size">
        <div :class="pair">
          <NumField label="W" :value="layer.transform.w" :min="0" :scale="100" unit="%" :decimals="1" :step="0.5" @change="setTransform('w', $event)" />
          <NumField label="H" :value="layer.transform.h" :min="0" :scale="100" unit="%" :decimals="1" :step="0.5" @change="setTransform('h', $event)" />
        </div>
      </PropertyRow>
      <PropertyRow label="Rotation">
        <NumField icon="lucide:rotate-cw" :value="layer.transform.rotation" :min="-360" :max="360" unit="deg" :decimals="1" aria-label="Rotation" @change="setTransform('rotation', $event)" />
      </PropertyRow>
      <PropertyRow label="Anchor">
        <div :class="pair">
          <NumField label="X" :value="layer.transform.anchorX" :scale="100" unit="%" :decimals="0" @change="setTransform('anchorX', $event)" />
          <NumField label="Y" :value="layer.transform.anchorY" :scale="100" unit="%" :decimals="0" @change="setTransform('anchorY', $event)" />
        </div>
      </PropertyRow>
    </PanelSection>

    <PanelSection title="Blend">
      <PropertyRow label="Opacity">
        <div :class="sliderRow">
          <Slider :model-value="layer.opacity" :min="0" :max="1" :step="0.01" aria-label="Opacity" @update:model-value="patch({ opacity: $event }, 'opacity')" />
          <NumField :value="layer.opacity" :min="0" :max="1" :scale="100" unit="%" :decimals="0" aria-label="Opacity" @change="patch({ opacity: $event }, 'opacity')" />
        </div>
      </PropertyRow>
      <PropertyRow label="Mode">
        <Select :model-value="layer.blend" :options="blendOptions" size="sm" aria-label="Blend mode" @update:model-value="$event && patch({ blend: $event as BlendMode })" />
      </PropertyRow>
    </PanelSection>

    <PanelSection title="Effects">
      <EffectChain
        :effects="layer.effects"
        :list-id="`effects-${layer.id}`"
        @add="addEffect"
        @remove="removeEffect"
        @move="moveEffect"
        @toggle="toggleEffect"
        @param="setEffectParam"
      />
    </PanelSection>

    <PanelSection title="Mask">
      <MaskEditor :mask="layer.mask" :images="images" @change="setMask" />
      <p v-if="!desktop" :class="note">Blend modes, effects and masks render in the desktop app; the browser preview approximates them.</p>
    </PanelSection>
  </div>
</template>
