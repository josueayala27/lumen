<script setup lang="ts">
import {
  addMasterEffect,
  createEffect,
  moveMasterEffect,
  removeMasterEffect,
  setCanvasSize,
  setMasterOpacity,
  updateMasterEffect,
} from '@lumen/core'
import type { Composition, EffectKind, ParamValue } from '@lumen/schema'
import { css } from 'styled-system/css'
import { PanelSection, PropertyRow, Select, Slider, type SelectOption } from '~/ui'
import { useShowDocument } from '~/show/useShowDocument'
import EffectChain from './EffectChain.vue'
import NumField from './NumField.vue'

/** Inspector with nothing selected: canvas size and the master stage. */
const props = defineProps<{ composition: Composition }>()

const doc = useShowDocument()

const PRESETS: Record<string, { width: number; height: number }> = {
  '1920x1080': { width: 1920, height: 1080 },
  '3840x2160': { width: 3840, height: 2160 },
  '1280x720': { width: 1280, height: 720 },
  '1080x1920': { width: 1080, height: 1920 },
  '1920x1200': { width: 1920, height: 1200 },
  '1024x768': { width: 1024, height: 768 },
}
const presetOptions: SelectOption[] = [
  ...Object.entries(PRESETS).map(([value, size]) => ({ value, label: `${size.width} × ${size.height}` })),
  { value: 'custom', label: 'Custom' },
]

function presetOf(composition: Composition): string {
  const key = `${composition.canvas.width}x${composition.canvas.height}`
  return key in PRESETS ? key : 'custom'
}

function setCanvas(width: number, height: number): void {
  doc.updateComposition((composition) => setCanvasSize(composition, { width, height }))
}

function setPreset(value: string | undefined): void {
  const size = value ? PRESETS[value] : undefined
  if (size) setCanvas(size.width, size.height)
}

function setOpacity(opacity: number): void {
  doc.updateComposition((composition) => setMasterOpacity(composition, opacity), { coalesce: 'master:opacity' })
}

function addEffect(kind: EffectKind): void {
  doc.updateComposition((composition) => addMasterEffect(composition, createEffect(kind)))
}

function setParam(effectId: string, name: string, value: ParamValue): void {
  doc.updateComposition((composition) => updateMasterEffect(composition, effectId, { params: { [name]: value } }), {
    coalesce: `master:${effectId}:${name}`,
  })
}

const pair = css({ display: 'grid', gridTemplateColumns: '[1fr 1fr]', gap: '1', w: 'full' })
const sliderRow = css({ display: 'grid', gridTemplateColumns: '[minmax(0, 1fr) token(sizes.16)]', alignItems: 'center', gap: '2', w: 'full' })
const note = css({ textStyle: 'ui.xs', color: 'fg.subtle', py: '1' })
</script>

<template>
  <div>
    <PanelSection title="Canvas">
      <PropertyRow label="Preset">
        <Select :model-value="presetOf(props.composition)" :options="presetOptions" size="sm" aria-label="Canvas preset" @update:model-value="setPreset" />
      </PropertyRow>
      <PropertyRow label="Size">
        <div :class="pair">
          <NumField label="W" :value="composition.canvas.width" :min="16" :max="16384" :decimals="0" unit="px" @change="setCanvas($event, composition.canvas.height)" />
          <NumField label="H" :value="composition.canvas.height" :min="16" :max="16384" :decimals="0" unit="px" @change="setCanvas(composition.canvas.width, $event)" />
        </div>
      </PropertyRow>
      <PropertyRow label="Layers">
        <span :class="note">{{ composition.layers.length }} layers, {{ composition.sources.length }} sources</span>
      </PropertyRow>
    </PanelSection>
    <PanelSection title="Master">
      <PropertyRow label="Opacity">
        <div :class="sliderRow">
          <Slider :model-value="composition.master.opacity" :min="0" :max="1" :step="0.01" aria-label="Master opacity" @update:model-value="setOpacity" />
          <NumField :value="composition.master.opacity" :min="0" :max="1" :scale="100" unit="%" :decimals="0" aria-label="Master opacity" @change="setOpacity" />
        </div>
      </PropertyRow>
    </PanelSection>
    <PanelSection title="Master effects">
      <EffectChain
        :effects="composition.master.effects"
        list-id="master-effects"
        @add="addEffect"
        @remove="(id) => doc.updateComposition((value) => removeMasterEffect(value, id))"
        @move="(id, index) => doc.updateComposition((value) => moveMasterEffect(value, id, index))"
        @toggle="(id, enabled) => doc.updateComposition((value) => updateMasterEffect(value, id, { enabled }))"
        @param="setParam"
      />
      <p :class="note">Master effects render in the desktop app.</p>
    </PanelSection>
  </div>
</template>
