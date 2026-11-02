<script setup lang="ts">
import { css } from 'styled-system/css'
import { EmptyState, Panel } from '~/ui'
import PageHeader from '~/library/PageHeader.vue'
import OutputPanel from '~/output/OutputPanel.vue'

const page = css({ h: 'full', overflowY: 'auto', p: '6' })
const column = css({ display: 'flex', flexDirection: 'column', gap: '6', maxW: '[720px]' })
const panel = css({ h: 'auto' })
</script>

<template>
  <div :class="page">
    <div :class="column">
      <PageHeader
        eyebrow="Build"
        title="Screens"
        subtitle="Assign outputs, then give each screen its own layout and mapping."
      />

      <OutputPanel />

      <Panel title="Layouts and mapping" bordered="all" :class="panel">
        <EmptyState
          size="sm"
          icon="lucide:monitor"
          title="Per-screen layouts and mapping"
          description="Layer filters, canvas regions, text presets, corner pin, mesh warp and edge blend arrive with the v2 screen model. See docs/architecture/10-screens-and-mapping.md."
        />
      </Panel>
    </div>
  </div>
</template>
