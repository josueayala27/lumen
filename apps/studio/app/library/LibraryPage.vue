<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { computed, ref } from 'vue'
import { Button, IconButton, Tabs } from '~/ui'

type Filter = 'all' | 'presentations' | 'songs'

interface Item {
  id: string
  title: string
  kind: 'presentation' | 'song'
  slides: number
  updated: string
  theme: string
  tone: 'graphite' | 'ember' | 'blaze' | 'dawn'
}

const items: Item[] = [
  { id: 'p1', title: 'Sunday Gathering', kind: 'presentation', slides: 18, updated: '2 hours ago', theme: 'Sunday Morning', tone: 'graphite' },
  { id: 's1', title: 'Great Are You Lord', kind: 'song', slides: 9, updated: 'Yesterday', theme: 'Lyrics — Warm', tone: 'ember' },
  { id: 's2', title: 'Way Maker', kind: 'song', slides: 12, updated: 'Yesterday', theme: 'Lyrics — Warm', tone: 'blaze' },
  { id: 'p2', title: 'Youth Night', kind: 'presentation', slides: 24, updated: '3 days ago', theme: 'Night Lights', tone: 'dawn' },
  { id: 's3', title: 'Build My Life', kind: 'song', slides: 8, updated: '4 days ago', theme: 'Lyrics — Warm', tone: 'ember' },
  { id: 'p3', title: 'Christmas Eve', kind: 'presentation', slides: 31, updated: 'Last week', theme: 'Candlelight', tone: 'graphite' },
  { id: 's4', title: 'Goodness of God', kind: 'song', slides: 10, updated: 'Last week', theme: 'Lyrics — Warm', tone: 'blaze' },
  { id: 'p4', title: 'Baptism Sunday', kind: 'presentation', slides: 14, updated: '2 weeks ago', theme: 'Sunday Morning', tone: 'dawn' },
]

const filter = ref<Filter>('all')
const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'presentations', label: 'Presentations' },
  { value: 'songs', label: 'Songs' },
]
const visible = computed(() => {
  if (filter.value === 'all') return items
  const kind = filter.value === 'songs' ? 'song' : 'presentation'
  return items.filter((item) => item.kind === kind)
})

const root = css({ display: 'flex', h: 'full', minH: '0' })
const content = css({ flex: '1', minW: '0', h: 'full', overflowY: 'auto', px: '6', py: '5' })
const inspector = css({ w: 'inspector', flexShrink: '0', h: 'full', overflowY: 'auto', bg: 'bg.panel', borderLeftWidth: '1px', borderColor: 'border.default', px: '4', py: '4' })
const header = css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '4', mb: '5' })
const eyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const title = css({ textStyle: 'display.md', color: 'fg.default' })
const subtitle = css({ mt: '1', textStyle: 'ui.sm', color: 'fg.muted' })
const actions = css({ display: 'flex', alignItems: 'center', gap: '2' })
const filtersRow = css({ display: 'flex', alignItems: 'center', gap: '2', mb: '4' })
const grid = css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '3' })
const card = css({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 'md',
  bg: 'bg.panel',
  borderWidth: '1px',
  borderColor: 'border.default',
  cursor: 'pointer',
  transitionProperty: 'border-color, transform, background',
  transitionDuration: 'normal',
  transitionTimingFunction: 'standard',
  _hover: { borderColor: 'accent.default', transform: 'translateY(-1px)' },
})
const thumb = css({ position: 'relative', aspectRatio: 'video', borderBottomWidth: '1px', borderColor: 'border.default' })
const tone = {
  graphite: css({ background: '[token(gradients.graphite)]' }),
  ember: css({ background: '[token(gradients.ember)]' }),
  blaze: css({ background: '[token(gradients.blaze)]' }),
  dawn: css({ background: '[token(gradients.dawn)]' }),
}
const kindBadge = css({
  position: 'absolute',
  top: '2',
  left: '2',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  h: '5',
  px: '1.5',
  borderRadius: 'full',
  bg: 'bg.app/70',
  color: 'fg.default',
  textStyle: 'ui.xs',
  backdropFilter: '[blur(8px)]',
})
const slideCount = css({ position: 'absolute', right: '2', bottom: '2', textStyle: 'ui.mono', color: 'fg.muted' })
const cardBody = css({ display: 'flex', flexDirection: 'column', gap: '1', p: '3' })
const cardTitle = css({ textStyle: 'ui.title', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const cardMeta = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const inspectorTitle = css({ textStyle: 'ui.title', color: 'fg.default', mb: '3' })
const stat = css({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', py: '2.5', borderBottomWidth: '1px', borderColor: 'border.default' })
const statLabel = css({ textStyle: 'ui.sm', color: 'fg.muted' })
const statValue = css({ textStyle: 'ui.title', color: 'fg.default' })
const cardBox = css({ mt: '4', p: '3', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default' })
const boxTitle = css({ display: 'flex', alignItems: 'center', gap: '2', textStyle: 'ui.sm', color: 'fg.default', mb: '2' })
const boxText = css({ textStyle: 'ui.xs', color: 'fg.muted', lineHeight: 'normal' })
const liveDot = css({ w: '1.5', h: '1.5', borderRadius: 'full', bg: 'success.default' })
</script>

<template>
  <div :class="root">
    <section :class="content">
      <header :class="header">
        <div>
          <p :class="eyebrow">Riverside Church</p>
          <h1 :class="title">Presentations</h1>
          <p :class="subtitle">24 presentations and 86 songs in your library. Ready for Sunday.</p>
        </div>
        <div :class="actions">
          <Button variant="secondary" size="md" icon="lucide:import">Import</Button>
          <Button variant="primary" size="md" icon="lucide:plus">New presentation</Button>
        </div>
      </header>

      <div :class="filtersRow">
        <Tabs v-model="filter" :tabs="filters" size="sm" />
        <span :class="css({ flex: '1' })" />
        <IconButton icon="lucide:arrow-up-down" label="Sort" size="md" />
        <IconButton icon="lucide:layout-grid" label="Grid view" size="md" active />
      </div>

      <div :class="grid">
        <article v-for="item in visible" :key="item.id" :class="card">
          <div :class="[thumb, tone[item.tone]]">
            <span :class="kindBadge">
              <Icon :name="item.kind === 'song' ? 'lucide:music' : 'lucide:presentation'" :size="11" />
              {{ item.kind === 'song' ? 'Song' : 'Slides' }}
            </span>
            <span :class="slideCount">{{ item.slides }} slides</span>
          </div>
          <div :class="cardBody">
            <h2 :class="cardTitle">{{ item.title }}</h2>
            <p :class="cardMeta">{{ item.theme }} · {{ item.updated }}</p>
          </div>
        </article>
      </div>
    </section>

    <aside :class="inspector" aria-label="Library inspector">
      <h2 :class="inspectorTitle">Service readiness</h2>
      <div :class="stat"><span :class="statLabel">Presentations</span><span :class="statValue">24</span></div>
      <div :class="stat"><span :class="statLabel">Songs</span><span :class="statValue">86</span></div>
      <div :class="stat"><span :class="statLabel">Media assets</span><span :class="statValue">132</span></div>
      <div :class="stat"><span :class="statLabel">Themes</span><span :class="statValue">8</span></div>
      <div :class="cardBox">
        <p :class="boxTitle"><span :class="liveDot" />Display connected</p>
        <p :class="boxText">Audience output is assigned to “Stage Left” at 1920×1080. Stage display is available on this machine.</p>
      </div>
      <div :class="cardBox">
        <p :class="boxTitle"><Icon name="lucide:cloud" :size="14" />Cloud backup</p>
        <p :class="boxText">Local changes saved. Last sync 4 minutes ago. Media stays on this machine until you upload it.</p>
      </div>
      <div :class="cardBox">
        <p :class="boxTitle"><Icon name="lucide:keyboard" :size="14" />Shortcuts</p>
        <p :class="boxText">Space next slide · B black · C clear · L logo · F freeze</p>
      </div>
    </aside>
  </div>
</template>
