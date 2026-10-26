<script setup lang="ts">
import { css } from 'styled-system/css'
import SkeletonBlock from './SkeletonBlock.vue'

withDefaults(defineProps<{ count?: number; min?: string; height?: string; label?: string }>(), {
  count: 6,
  min: '240px',
  height: '160px',
  label: 'Loading',
})

const grid = css({ display: 'grid', gap: '3', alignContent: 'start' })
</script>

<template>
  <div
    :class="grid"
    :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))` }"
    role="status"
    :aria-label="label"
  >
    <SkeletonBlock v-for="n in count" :key="n" :height="height" />
  </div>
</template>
