<script setup lang="ts">
import { computed } from 'vue'
import { NumberField } from '~/ui'

/**
 * Numeric wrapper over `NumberField` (which edits strings). `scale` maps the
 * stored value to the shown one, e.g. 100 to show a 0..1 value as percent.
 */
const props = withDefaults(
  defineProps<{
    value: number
    min?: number
    max?: number
    step?: number
    decimals?: number
    scale?: number
    unit?: '' | '%' | 'deg' | 'px'
    label?: string
    icon?: string
    ariaLabel?: string
    disabled?: boolean
  }>(),
  { min: undefined, max: undefined, step: 1, decimals: 2, scale: 1, unit: '', label: undefined, icon: undefined, ariaLabel: undefined, disabled: false },
)

const emit = defineEmits<{ change: [value: number]; scrubStart: []; scrubEnd: [] }>()

const text = computed(() => `${Number((props.value * props.scale).toFixed(props.decimals))}${props.unit}`)

function onUpdate(raw: string): void {
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return
  const next = parsed / props.scale
  if (next !== props.value) emit('change', next)
}
</script>

<template>
  <NumberField
    :model-value="text"
    :units="[unit]"
    :min="min === undefined ? undefined : min * scale"
    :max="max === undefined ? undefined : max * scale"
    :step="step"
    :decimals="decimals"
    :label="label"
    :icon="icon"
    :aria-label="ariaLabel ?? label"
    :disabled="disabled"
    size="sm"
    @update:model-value="onUpdate"
    @scrub-start="emit('scrubStart')"
    @scrub-end="emit('scrubEnd')"
  />
</template>
