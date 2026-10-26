<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { useRoute } from 'vue-router'

const route = useRoute()
const code = String(route.params.code ?? '')

const page = css({ minH: '[100vh]', bg: 'bg.app', color: 'fg.default', p: '4' })
const top = css({ display: 'flex', alignItems: 'center', gap: '2', mb: '4' })
const pill = css({ display: 'inline-flex', alignItems: 'center', gap: '1.5', h: 'control.sm', px: '2', borderRadius: 'full', bg: 'live.muted', color: 'live.default', textStyle: 'ui.xs', fontWeight: 'semibold' })
const slide = css({ aspectRatio: 'video', borderRadius: 'md', background: '[token(gradients.ember)]', display: 'grid', placeItems: 'center', p: '6', textAlign: 'center', mb: '4' })
const lyric = css({ textStyle: 'display.md', color: 'ink.0' })
const controls = css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2' })
const control = css({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2', h: '[56px]', borderRadius: 'md', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default', textStyle: 'ui.sm', color: 'fg.default' })
const primary = css({ gridColumn: 'span 2', background: '[token(gradients.sheen), token(colors.accent.default)]', color: 'fg.onAccent', borderColor: 'transparent', fontWeight: 'semibold' })
</script>

<template>
  <div :class="page">
    <div :class="top">
      <span :class="pill"><span :class="css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: 'live.default' })" />Live</span>
      <span :class="css({ textStyle: 'ui.sm', color: 'fg.muted' })">Session {{ code }}</span>
    </div>
    <div :class="slide"><p :class="lyric">Great are You Lord</p></div>
    <div :class="controls">
      <button :class="control"><Icon name="lucide:skip-back" :size="18" />Previous</button>
      <button :class="control"><Icon name="lucide:square" :size="18" />Black</button>
      <button :class="[control, primary]"><Icon name="lucide:skip-forward" :size="18" />Next slide</button>
    </div>
    <p :class="css({ mt: '4', textStyle: 'ui.xs', color: 'fg.subtle', textAlign: 'center' })">Remote control lands after the native output spike.</p>
  </div>
</template>
