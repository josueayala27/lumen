<script setup lang="ts">
import type { ParamValue } from '@lumen/schema'
import { css } from 'styled-system/css'
import { ColorField, PropertyRow, Select, Slider, Switch } from '~/ui'
import { coerceParam, type ParamEntry } from './composeModel'
import NumField from './NumField.vue'

/** Typed controls for a list of effect or generator parameters. */
defineProps<{ entries: ParamEntry[] }>()

const emit = defineEmits<{ change: [name: string, value: ParamValue] }>()

function set(entry: ParamEntry, value: unknown): void {
  const next = coerceParam(entry.spec, value)
  if (next !== entry.value) emit('change', entry.spec.name, next)
}

function decimalsFor(step: number): number {
  return step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)))
}

const numberRow = css({ display: 'grid', gridTemplateColumns: '[minmax(0, 1fr) token(sizes.16)]', alignItems: 'center', gap: '2', w: 'full' })
</script>

<template>
  <PropertyRow v-for="entry in entries" :key="entry.spec.name" :label="entry.spec.label">
    <div v-if="entry.spec.type === 'number'" :class="numberRow">
      <Slider
        :model-value="entry.value as number"
        :min="entry.spec.min"
        :max="entry.spec.max"
        :step="entry.spec.step"
        :aria-label="entry.spec.label"
        @update:model-value="set(entry, $event)"
      />
      <NumField
        :value="entry.value as number"
        :min="entry.spec.min"
        :max="entry.spec.max"
        :step="entry.spec.step"
        :decimals="decimalsFor(entry.spec.step)"
        :aria-label="entry.spec.label"
        @change="set(entry, $event)"
      />
    </div>
    <ColorField
      v-else-if="entry.spec.type === 'color'"
      :model-value="entry.value as string"
      size="sm"
      :aria-label="entry.spec.label"
      @update:model-value="set(entry, $event)"
    />
    <Switch
      v-else-if="entry.spec.type === 'boolean'"
      :model-value="entry.value as boolean"
      size="sm"
      :aria-label="entry.spec.label"
      @update:model-value="set(entry, $event)"
    />
    <Select
      v-else-if="entry.spec.type === 'enum'"
      :model-value="entry.value as string"
      :options="entry.spec.options.map((option) => ({ value: option, label: option }))"
      size="sm"
      :aria-label="entry.spec.label"
      @update:model-value="set(entry, $event)"
    />
  </PropertyRow>
</template>
