<script setup lang="ts">
import { paintToCss } from '@lumen/core'
import type { Background, TextStyle, Theme } from '@lumen/schema'
import { css } from 'styled-system/css'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ theme: Theme; compact?: boolean }>(), { compact: false })

function backgroundCss(background: Background): string {
  switch (background.kind) {
    case 'solid':
      return background.color
    case 'gradient':
      return paintToCss(background.paint)
    case 'transparent':
      return 'transparent'
    case 'image':
    case 'video':
      return '#101828'
  }
}

const background = computed(() => backgroundCss(props.theme.background))
const isMedia = computed(
  () => props.theme.background.kind === 'image' || props.theme.background.kind === 'video',
)

/** Theme sizes are authored against a 1920px slide; `cqw` keeps the preview proportional. */
function fontSize(style: TextStyle): string {
  return `${((style.fontSize / 1920) * 100).toFixed(3)}cqw`
}

function textStyle(style: TextStyle): Record<string, string> {
  return {
    color: style.color,
    fontSize: fontSize(style),
    fontWeight: String(style.weight),
    fontStyle: style.italic ? 'italic' : 'normal',
    lineHeight: String(style.lineHeight),
    letterSpacing: `${style.letterSpacing}px`,
    textAlign: style.align,
    fontFamily: style.fontId,
  }
}

const titleStyle = computed(() => textStyle(props.theme.textStyles.title))
const bodyStyle = computed(() => textStyle(props.theme.textStyles.body))

const root = css({ display: 'flex', flexDirection: 'column', gap: '2' })
const frame = css({
  position: 'relative',
  containerType: '[inline-size]',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: '[2cqw]',
  aspectRatio: 'video',
  overflow: 'hidden',
  borderRadius: 'md',
  borderWidth: '1px',
  borderColor: 'border.default',
  px: '[7cqw]',
  py: '[5cqw]',
})
const mediaLabel = css({
  position: 'absolute',
  top: '2',
  right: '2',
  px: '1.5',
  py: '0.5',
  borderRadius: 'full',
  bg: 'bg.app/70',
  color: 'fg.muted',
  textStyle: 'ui.xs',
  backdropFilter: '[blur(8px)]',
})
const title = css({ margin: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const body = css({ margin: '0', overflow: 'hidden' })
const meta = css({ display: 'flex', alignItems: 'center', gap: '2', textStyle: 'ui.xs', color: 'fg.subtle' })
const dot = css({ w: '2', h: '2', borderRadius: 'full', flexShrink: '0' })
</script>

<template>
  <div :class="root">
    <div :class="frame" :style="{ background }">
      <span v-if="isMedia" :class="mediaLabel">{{ theme.background.kind === 'video' ? 'Video' : 'Image' }} background</span>
      <p :class="title" :style="titleStyle">Title style</p>
      <p :class="body" :style="bodyStyle">Body text for lyrics and content</p>
    </div>
    <div v-if="!compact" :class="meta">
      <span :class="dot" :style="{ background }" />
      <span>{{ theme.background.kind === 'solid' ? theme.background.color : theme.background.kind }}</span>
      <span>· {{ theme.transition.kind }} {{ theme.transition.durationMs }}ms</span>
    </div>
  </div>
</template>
