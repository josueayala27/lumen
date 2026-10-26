<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon, NuxtLink } from '#components'

const page = css({ minH: '[100vh]', bg: 'bg.app', color: 'fg.default' })
const nav = css({ display: 'flex', alignItems: 'center', gap: '3', h: 'toolbar', px: '6', borderBottomWidth: '1px', borderColor: 'border.default', bg: 'bg.panel' })
const mark = css({ display: 'grid', placeItems: 'center', w: '6', h: '6', borderRadius: 'sm', background: '[token(gradients.sheen), token(colors.accent.default)]', color: 'fg.onAccent', textStyle: 'ui.xs', fontWeight: 'bold' })
const wordmark = css({ textStyle: 'ui.title' })
const spacer = css({ flex: '1' })
const hero = css({ maxW: '[1100px]', mx: 'auto', px: '6', pt: '[120px] pb-[96px]' })
const eyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '4' })
const title = css({ textStyle: 'display.hero', maxW: '[980px]' })
const body = css({ mt: '6', maxW: '[620px]', textStyle: 'body.lg', color: 'fg.muted' })
const actions = css({ display: 'flex', gap: '3', mt: '8' })
const primary = css({ display: 'inline-flex', alignItems: 'center', gap: '2', h: 'control.lg', px: '4', borderRadius: 'sm', background: '[token(gradients.sheen), token(colors.accent.default)]', color: 'fg.onAccent', textStyle: 'ui.sm', fontWeight: 'semibold' })
const secondary = css({ display: 'inline-flex', alignItems: 'center', gap: '2', h: 'control.lg', px: '4', borderRadius: 'sm', bg: 'bg.subtle', color: 'fg.default', borderWidth: '1px', borderColor: 'border.default', textStyle: 'ui.sm' })
const grid = css({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3', mt: '[96px]' })
const card = css({ p: '4', borderRadius: 'md', bg: 'bg.panel', borderWidth: '1px', borderColor: 'border.default' })
const cardTitle = css({ textStyle: 'ui.title', mb: '2' })
const cardText = css({ textStyle: 'ui.sm', color: 'fg.muted', lineHeight: 'relaxed' })
</script>

<template>
  <div :class="page">
    <header :class="nav">
      <span :class="mark">L</span>
      <span :class="wordmark">Lumen</span>
      <span :class="spacer" />
      <NuxtLink to="/desktop-auth" :class="secondary">Desktop sign-in</NuxtLink>
    </header>
    <section :class="hero">
      <p :class="eyebrow">Live presentation, without the friction</p>
      <h1 :class="title">Run the service. Not the software.</h1>
      <p :class="body">Lumen keeps songs, slides, media and playlists on the machine in front of you. The audience output is native, the stage display stays readable, and Sunday works even when the network does not.</p>
      <div :class="actions">
        <a href="#" :class="primary"><Icon name="lucide:download" :size="15" />Download for macOS</a>
        <a href="#" :class="secondary"><Icon name="lucide:monitor" :size="15" />Windows build</a>
      </div>
      <div :class="grid">
        <article :class="card"><h2 :class="cardTitle">Offline by default</h2><p :class="cardText">Local SQLite, local media, native output. Cloud sync catches up when the network returns.</p></article>
        <article :class="card"><h2 :class="cardTitle">Native audience output</h2><p :class="cardText">No browser window on the congregation screen. Rust renders every frame.</p></article>
        <article :class="card"><h2 :class="cardTitle">Built for volunteers</h2><p :class="cardText">Clear next-slide preview, one-key black and clear, and a stage display that reads across the room.</p></article>
      </div>
    </section>
  </div>
</template>
