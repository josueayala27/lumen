<script setup lang="ts">
import { SHADER_IDS, type GradientSource, type ParamValue, type Source } from '@lumen/schema'
import { css } from 'styled-system/css'
import { isTauri } from '~/output/api'
import { computed } from 'vue'
import { ColorField, IconButton, Input, PropertyRow, SegmentedControl, Select, Slider, Switch, type SelectOption } from '~/ui'
import {
  SHADER_CATALOG,
  addGradientStop,
  defaultShaderParams,
  paramEntries,
  removeGradientStop,
  shaderParamSpecs,
  sourceKindLabel,
  updateGradientStop,
} from './composeModel'
import NumField from './NumField.vue'
import ParamFields from './ParamFields.vue'

/** The browser preview approximates; the desktop compositor renders everything. */
const desktop = isTauri()

/** Edits one composition source. `field` names the value so drags coalesce into one undo step. */
const props = defineProps<{ source: Source; assetName?: string }>()

const emit = defineEmits<{ patch: [patch: Partial<Source>, field?: string] }>()

const shaderOptions: SelectOption[] = SHADER_IDS.map((id) => ({ value: id, label: SHADER_CATALOG[id].label }))

const shaderEntries = computed(() =>
  props.source.kind === 'shader' ? paramEntries(shaderParamSpecs(props.source.shaderId), props.source.params) : [],
)

function patch(values: Partial<Source>, field?: string): void {
  emit('patch', values, field)
}

function setShader(id: string | undefined): void {
  if (!id || props.source.kind !== 'shader' || id === props.source.shaderId) return
  patch({ shaderId: id, params: defaultShaderParams(id) } as Partial<Source>)
}

function setShaderParam(name: string, value: ParamValue): void {
  if (props.source.kind !== 'shader') return
  patch({ params: { ...props.source.params, [name]: value } } as Partial<Source>, `param:${name}`)
}

function gradient(): GradientSource | null {
  return props.source.kind === 'gradient' ? props.source : null
}

function setStop(index: number, values: { at?: number; color?: string }, field: string): void {
  const source = gradient()
  if (source) patch({ stops: updateGradientStop(source, index, values) } as Partial<Source>, `stop:${index}:${field}`)
}

function addStop(): void {
  const source = gradient()
  if (source) patch({ stops: addGradientStop(source) } as Partial<Source>)
}

function removeStop(index: number): void {
  const source = gradient()
  if (source) patch({ stops: removeGradientStop(source, index) } as Partial<Source>)
}

const stopRow = css({ display: 'grid', gridTemplateColumns: '[minmax(0, 1fr) token(sizes.16) auto]', gap: '1', alignItems: 'center', w: 'full' })
const sliderRow = css({ display: 'grid', gridTemplateColumns: '[minmax(0, 1fr) token(sizes.16)]', alignItems: 'center', gap: '2', w: 'full' })
const note = css({ textStyle: 'ui.xs', color: 'fg.subtle', py: '1' })
const kindLabel = css({ textStyle: 'ui.sm', color: 'fg.muted' })
</script>

<template>
  <div>
    <PropertyRow label="Name">
      <Input :model-value="source.name" size="sm" placeholder="Untitled" aria-label="Source name" @commit="patch({ name: $event })" />
    </PropertyRow>
    <PropertyRow label="Kind">
      <span :class="kindLabel">{{ sourceKindLabel(source) }}</span>
    </PropertyRow>

    <PropertyRow v-if="source.kind === 'solid'" label="Colour">
      <ColorField :model-value="source.color" size="sm" aria-label="Colour" @update:model-value="patch({ color: $event } as Partial<Source>, 'color')" />
    </PropertyRow>

    <template v-else-if="source.kind === 'gradient'">
      <PropertyRow label="Shape">
        <SegmentedControl
          :model-value="source.gradient"
          :options="[
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
          ]"
          size="sm"
          fill
          aria-label="Gradient shape"
          @update:model-value="$event && patch({ gradient: $event } as Partial<Source>)"
        />
      </PropertyRow>
      <PropertyRow label="Angle">
        <NumField :value="source.angle" :min="-360" :max="360" unit="deg" :decimals="0" aria-label="Angle" @change="patch({ angle: $event } as Partial<Source>, 'angle')" />
      </PropertyRow>
      <PropertyRow v-for="(stop, index) in source.stops" :key="index" :label="`Stop ${index + 1}`">
        <div :class="stopRow">
          <ColorField :model-value="stop.color" size="sm" :aria-label="`Stop ${index + 1} colour`" @update:model-value="setStop(index, { color: $event }, 'color')" />
          <NumField :value="stop.at" :min="0" :max="1" :scale="100" unit="%" :decimals="0" :aria-label="`Stop ${index + 1} position`" @change="setStop(index, { at: $event }, 'at')" />
          <IconButton icon="lucide:minus" label="Remove stop" size="sm" :disabled="source.stops.length <= 2" @click="removeStop(index)" />
        </div>
      </PropertyRow>
      <PropertyRow label="">
        <IconButton icon="lucide:plus" label="Add stop" size="sm" @click="addStop" />
      </PropertyRow>
      <p v-if="source.gradient === 'radial'" :class="note">The current renderer draws radial gradients as their first colour.</p>
    </template>

    <template v-else-if="source.kind === 'shader'">
      <PropertyRow label="Generator">
        <Select :model-value="source.shaderId" :options="shaderOptions" size="sm" aria-label="Generator" @update:model-value="setShader" />
      </PropertyRow>
      <ParamFields :entries="shaderEntries" @change="setShaderParam" />
      <p v-if="!desktop" :class="note">Generators render in the desktop app.</p>
    </template>

    <template v-else-if="source.kind === 'video'">
      <PropertyRow label="File">
        <span :class="kindLabel">{{ assetName ?? source.asset.assetId }}</span>
      </PropertyRow>
      <PropertyRow label="Loop">
        <Switch :model-value="source.loop" size="sm" aria-label="Loop" @update:model-value="patch({ loop: $event } as Partial<Source>)" />
      </PropertyRow>
      <PropertyRow label="In">
        <NumField :value="source.inMs / 1000" :min="0" :step="0.1" :decimals="2" aria-label="In point (seconds)" @change="patch({ inMs: Math.round($event * 1000) } as Partial<Source>, 'in')" />
      </PropertyRow>
      <PropertyRow label="Out">
        <div :class="stopRow">
          <NumField
            :value="(source.outMs ?? 0) / 1000"
            :min="0"
            :step="0.1"
            :decimals="2"
            :disabled="source.outMs === null"
            aria-label="Out point (seconds)"
            @change="patch({ outMs: Math.round($event * 1000) } as Partial<Source>, 'out')"
          />
          <Switch
            :model-value="source.outMs === null"
            size="sm"
            aria-label="Play to the end"
            @update:model-value="patch({ outMs: $event ? null : source.inMs + 10000 } as Partial<Source>)"
          />
          <span :class="note">End</span>
        </div>
      </PropertyRow>
      <PropertyRow label="Rate">
        <NumField :value="source.rate" :min="0.05" :max="8" :step="0.05" :decimals="2" aria-label="Rate" @change="patch({ rate: $event } as Partial<Source>, 'rate')" />
      </PropertyRow>
      <PropertyRow label="Reverse">
        <Switch :model-value="source.reverse" size="sm" aria-label="Reverse" @update:model-value="patch({ reverse: $event } as Partial<Source>)" />
      </PropertyRow>
      <p :class="note">The compositor does not apply out point, rate or reverse yet.</p>
      <PropertyRow label="Muted">
        <Switch :model-value="source.muted" size="sm" aria-label="Muted" @update:model-value="patch({ muted: $event } as Partial<Source>)" />
      </PropertyRow>
      <PropertyRow label="Volume">
        <div :class="sliderRow">
          <Slider :model-value="source.volume" :min="0" :max="1" :step="0.01" aria-label="Volume" @update:model-value="patch({ volume: $event } as Partial<Source>, 'volume')" />
          <NumField :value="source.volume" :min="0" :max="1" :scale="100" unit="%" :decimals="0" aria-label="Volume" @change="patch({ volume: $event } as Partial<Source>, 'volume')" />
        </div>
      </PropertyRow>
    </template>

    <PropertyRow v-else-if="source.kind === 'image'" label="File">
      <span :class="kindLabel">{{ assetName ?? source.asset.assetId }}</span>
    </PropertyRow>

    <template v-else-if="source.kind === 'slide'">
      <PropertyRow label="Content">
        <span :class="kindLabel">{{ source.elements.length }} elements, {{ source.size.width }}×{{ source.size.height }}</span>
      </PropertyRow>
      <p :class="note">Slide content is edited in the content editor.</p>
    </template>

    <p v-else :class="note">This source kind is reserved for a later release.</p>
  </div>
</template>
