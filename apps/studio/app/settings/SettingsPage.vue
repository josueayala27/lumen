<script setup lang="ts">
import { css } from 'styled-system/css'
import { computed, onMounted } from 'vue'
import { Kbd, Panel, PanelSection, formatBytes } from '~/ui'
import { isTauri } from '~/data/db'
import OutputPanel from '~/output/OutputPanel.vue'
import ShowControlPanel from '~/settings/ShowControlPanel.vue'
import { useShellStats } from '~/shell/useShellStats'

const { presentations, playlists, media, mediaBytes, refresh } = useShellStats()
onMounted(() => void refresh())

const desktop = isTauri()
const songs = computed(() => presentations.value.filter((item) => item.kind === 'song').length)
const slideDecks = computed(() => presentations.value.length - songs.value)
const missing = computed(() => media.value.filter((asset) => asset.missing).length)

const stats = computed(() => [
  { label: 'Presentations', value: String(slideDecks.value) },
  { label: 'Songs', value: String(songs.value) },
  { label: 'Playlists', value: String(playlists.value.length) },
  {
    label: 'Media files',
    value: `${media.value.length} · ${formatBytes(mediaBytes.value)}${missing.value ? ` (${missing.value} missing)` : ''}`,
  },
  { label: 'Storage', value: desktop ? 'Local database on this device' : 'Browser storage (preview only)' },
])

const groups: { title: string; items: { keys: string; action: string }[] }[] = [
  {
    title: 'Anywhere',
    items: [{ keys: 'Mod+K', action: 'Focus search' }],
  },
  {
    title: 'Live',
    items: [
      { keys: 'ArrowRight', action: 'Next slide (Space also works)' },
      { keys: 'ArrowLeft', action: 'Previous slide' },
      { keys: 'Enter', action: 'Take' },
      { keys: ']', action: 'Next item' },
      { keys: '[', action: 'Previous item' },
      { keys: 'B', action: 'Black' },
      { keys: 'C', action: 'Clear' },
      { keys: 'L', action: 'Logo' },
      { keys: 'F', action: 'Freeze / unfreeze' },
    ],
  },
  {
    title: 'Editor',
    items: [
      { keys: 'Mod+S', action: 'Save' },
      { keys: 'Mod+Z', action: 'Undo' },
      { keys: 'Mod+C', action: 'Copy selection' },
      { keys: 'Mod+V', action: 'Paste' },
      { keys: 'Mod+D', action: 'Duplicate' },
      { keys: 'Delete', action: 'Delete selection' },
      { keys: 'Escape', action: 'Clear selection' },
    ],
  },
]

const page = css({ h: 'full', overflowY: 'auto', p: '6' })
const column = css({ display: 'flex', flexDirection: 'column', gap: '6', maxW: '[720px]' })
const heading = css({ textStyle: 'display.md', color: 'fg.default' })
const lead = css({ mt: '1', textStyle: 'ui.sm', color: 'fg.muted' })
const panel = css({ h: 'auto' })
const row = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3', py: '1.5', textStyle: 'ui.sm', color: 'fg.default' })
const rowLabel = css({ color: 'fg.muted' })
const groupTitle = css({ textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase', mt: '2', mb: '1' })
</script>

<template>
  <div :class="page">
    <div :class="column">
      <div>
        <h1 :class="heading">Settings</h1>
        <p :class="lead">Library overview, audience displays, shortcuts and show control.</p>
      </div>

      <Panel title="Library" bordered="all" :class="panel">
        <PanelSection title="On this device">
          <div v-for="stat in stats" :key="stat.label" :class="row">
            <span :class="rowLabel">{{ stat.label }}</span>
            <span>{{ stat.value }}</span>
          </div>
        </PanelSection>
      </Panel>

      <OutputPanel />

      <Panel title="Keyboard shortcuts" bordered="all" :class="panel">
        <PanelSection title="Reference">
          <template v-for="group in groups" :key="group.title">
            <p :class="groupTitle">{{ group.title }}</p>
            <div v-for="item in group.items" :key="item.keys" :class="row">
              <span>{{ item.action }}</span>
              <Kbd :shortcut="item.keys" />
            </div>
          </template>
        </PanelSection>
      </Panel>

      <ShowControlPanel />
    </div>
  </div>
</template>
