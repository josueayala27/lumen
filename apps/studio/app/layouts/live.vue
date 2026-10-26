<script setup lang="ts">
import { css } from 'styled-system/css'
import AppToolbar from '~/shell/AppToolbar.vue'

const shell = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', bg: 'bg.app', color: 'fg.default', overflow: 'hidden' })
const main = css({ flex: '1', minH: '0', overflow: 'hidden' })
</script>

<template>
  <div :class="shell">
    <AppToolbar />
    <main :class="main"><slot /></main>
  </div>
</template>
