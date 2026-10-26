<script setup lang="ts">
import { css } from 'styled-system/css'
import AppSidebar from '~/shell/AppSidebar.vue'
import AppToolbar from '~/shell/AppToolbar.vue'

const shell = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', bg: 'bg.app', color: 'fg.default', overflow: 'hidden' })
const body = css({ display: 'flex', flex: '1', minH: '0' })
const sidebar = css({ w: 'sidebar', flexShrink: '0', h: 'full', bg: 'bg.panel', borderRightWidth: '1px', borderColor: 'border.default' })
const main = css({ flex: '1', minW: '0', h: 'full', minH: '0', overflow: 'hidden' })
</script>

<template>
  <div :class="shell">
    <AppToolbar />
    <div :class="body">
      <aside :class="sidebar" aria-label="Library navigation"><AppSidebar /></aside>
      <main :class="main"><slot><NuxtPage /></slot></main>
    </div>
  </div>
</template>
