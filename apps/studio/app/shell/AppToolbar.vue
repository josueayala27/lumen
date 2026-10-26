<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon, NuxtLink } from '#components'
import { ref } from 'vue'
import { Button, IconButton, Input } from '~/ui'

const search = ref('')

const root = css({
  display: 'flex',
  alignItems: 'center',
  gap: '3',
  h: 'toolbar',
  px: '3',
  flexShrink: '0',
  bg: 'bg.panel',
  borderBottomWidth: '1px',
  borderColor: 'border.default',
})
const brand = css({ display: 'flex', alignItems: 'center', gap: '2', minW: '[164px]' })
const mark = css({
  display: 'grid',
  placeItems: 'center',
  w: '6',
  h: '6',
  borderRadius: 'sm',
  background: '[token(gradients.sheen), token(colors.accent.default)]',
  color: 'fg.onAccent',
  textStyle: 'ui.xs',
  fontWeight: 'bold',
  letterSpacing: 'tight',
})
const wordmark = css({ textStyle: 'ui.title', color: 'fg.default' })
const divider = css({ w: '[1px]', h: '5', bg: 'border.default', flexShrink: '0' })
const spacer = css({ flex: '1' })
const searchBox = css({ w: '[320px]', maxW: '[34vw]' })
const status = css({
  display: 'flex',
  alignItems: 'center',
  gap: '1.5',
  h: 'control.md',
  px: '2.5',
  borderRadius: 'full',
  bg: 'success.muted',
  color: 'success.default',
  textStyle: 'ui.xs',
})
const dot = css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: 'success.default' })
</script>

<template>
  <header :class="root">
    <NuxtLink to="/" :class="brand" aria-label="Lumen library">
      <span :class="mark">L</span>
      <span :class="wordmark">Lumen</span>
    </NuxtLink>
    <span :class="divider" />
    <Button variant="ghost" size="sm" icon="lucide:chevrons-up-down">Riverside Church</Button>
    <span :class="spacer" />
    <Input v-model="search" type="search" size="md" placeholder="Search presentations, songs, media…" :class="searchBox">
      <template #prefix><Icon name="lucide:search" :size="14" /></template>
    </Input>
    <span :class="status"><span :class="dot" />Offline ready</span>
    <NuxtLink to="/live"><Button variant="primary" size="md" icon="lucide:play">Go Live</Button></NuxtLink>
    <IconButton icon="lucide:settings" label="Settings" variant="ghost" size="md" />
    <span :class="css({ w: '6', h: '6', borderRadius: 'full', background: '[token(gradients.blaze)]', flexShrink: '0' })" />
  </header>
</template>
