<script setup lang="ts">
import { css } from 'styled-system/css'
import { EmptyState } from '~/ui'
import PageHeader from '~/library/PageHeader.vue'

const page = css({ display: 'flex', flexDirection: 'column', h: 'full', overflowY: 'auto', p: '6' })
const body = css({ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' })
</script>

<template>
  <div :class="page">
    <PageHeader
      eyebrow="Build"
      title="Compose"
      subtitle="Stack sources into layers, then set blend modes, effects and masks for the show's composition."
    />
    <div :class="body">
      <EmptyState
        icon="lucide:layers"
        title="Composition editor"
        description="Layers, sources, blend modes, effects and masks arrive with render contract v2. See docs/architecture/11-ui.md."
      />
    </div>
  </div>
</template>
