<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { useRequestURL } from '#imports'

const url = useRequestURL()
const code = url.searchParams.get('code') ?? ''

const page = css({ minH: '[100vh]', display: 'grid', placeItems: 'center', bg: 'bg.app', color: 'fg.default', p: '6' })
const card = css({ w: 'full', maxW: '[520px]', p: '6', borderRadius: 'lg', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default', boxShadow: 'popover' })
const mark = css({ display: 'grid', placeItems: 'center', w: '8', h: '8', borderRadius: 'md', background: '[token(gradients.sheen), token(colors.accent.default)]', color: 'fg.onAccent', textStyle: 'ui.md', fontWeight: 'bold', mb: '5' })
const title = css({ textStyle: 'display.md', mb: '2' })
const text = css({ textStyle: 'ui.sm', color: 'fg.muted', lineHeight: 'relaxed', mb: '5' })
const codeBox = css({ p: '3', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default', textStyle: 'ui.mono', color: 'fg.default', mb: '4' })
const button = css({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2', w: 'full', h: 'control.lg', borderRadius: 'sm', background: '[token(gradients.sheen), token(colors.accent.default)]', color: 'fg.onAccent', textStyle: 'ui.sm', fontWeight: 'semibold', mb: '2' })
const secondary = css({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2', w: 'full', h: 'control.lg', borderRadius: 'sm', bg: 'bg.subtle', color: 'fg.default', textStyle: 'ui.sm' })
</script>

<template>
  <div :class="page">
    <div :class="card">
      <span :class="mark">L</span>
      <h1 :class="title">Connect this device</h1>
      <p :class="text">Sign in to Lumen in this browser, then return to the desktop app. The app stores its session in the operating system keychain.</p>
      <div v-if="code" :class="codeBox">Device code {{ code }}</div>
      <a href="/api/auth/sign-in/social/google" :class="button"><Icon name="lucide:chrome" :size="15" />Continue with Google</a>
      <a href="#" :class="secondary"><Icon name="lucide:mail" :size="15" />Email me a sign-in link</a>
      <p :class="css({ mt: '4', textStyle: 'ui.xs', color: 'fg.subtle' })">Desktop handoff lands in Phase 0. This page is the callback surface.</p>
    </div>
  </div>
</template>
