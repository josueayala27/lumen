<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { Button } from '~/ui'

withDefaults(defineProps<{ title: string; description?: string; icon?: string; action?: string }>(), {
  description: 'This workspace lands in the next build phase.',
  icon: 'lucide:sparkles',
  action: undefined,
})

const root = css({ display: 'grid', placeItems: 'center', h: 'full', p: '6' })
const card = css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3', maxW: '[520px]', textAlign: 'center' })
const well = css({ display: 'grid', placeItems: 'center', w: '[56px]', h: '[56px]', borderRadius: 'lg', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default', color: 'accent.default' })
const title = css({ textStyle: 'display.md', color: 'fg.default' })
const text = css({ textStyle: 'ui.sm', color: 'fg.muted', lineHeight: '1.6' })
</script>

<template>
  <div :class="root">
    <div :class="card">
      <span :class="well"><Icon :name="icon" :size="24" /></span>
      <h1 :class="title">{{ title }}</h1>
      <p :class="text">{{ description }}</p>
      <Button v-if="action" variant="primary" icon="lucide:plus">{{ action }}</Button>
    </div>
  </div>
</template>
