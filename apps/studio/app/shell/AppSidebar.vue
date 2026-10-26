<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon, NuxtLink } from '#components'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Button } from '~/ui'

interface NavItem {
  label: string
  href: string
  icon: string
  badge?: string
}

const route = useRoute()
const sections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Library',
    items: [
      { label: 'Presentations', href: '/', icon: 'lucide:presentation' },
      { label: 'Songs', href: '/songs', icon: 'lucide:music' },
      { label: 'Media', href: '/media', icon: 'lucide:image' },
      { label: 'Themes', href: '/themes', icon: 'lucide:palette' },
      { label: 'Playlists', href: '/playlists', icon: 'lucide:list-music' },
    ],
  },
  {
    title: 'Service',
    items: [
      { label: 'Live', href: '/live', icon: 'lucide:radio' },
      { label: 'Settings', href: '/settings', icon: 'lucide:settings-2' },
    ],
  },
]

const active = computed(() => route.path)
const root = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0' })
const nav = css({ flex: '1', minH: '0', overflowY: 'auto', px: '2', py: '3' })
const section = css({ display: 'flex', flexDirection: 'column', gap: '0.5', mb: '5' })
const sectionTitle = css({ px: '2', mb: '1', textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase' })
const link = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2.5',
  h: 'control.lg',
  px: '2',
  borderLeftWidth: '2px',
  borderColor: 'transparent',
  borderRadius: 'sm',
  color: 'fg.muted',
  textStyle: 'ui.sm',
  transitionProperty: 'background, color',
  transitionDuration: 'fast',
  transitionTimingFunction: 'standard',
  _hover: { bg: 'bg.hover', color: 'fg.default' },
})
const linkActive = css({ bg: 'bg.subtle', color: 'fg.default', borderColor: 'accent.default' })
const badge = css({ ml: 'auto', textStyle: 'ui.xs', color: 'fg.subtle' })
const footer = css({ flexShrink: '0', p: '3', borderTopWidth: '1px', borderColor: 'border.default' })
const storage = css({ mt: '3', p: '2.5', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default' })
const storageTop = css({ display: 'flex', justifyContent: 'space-between', mb: '2', textStyle: 'ui.xs', color: 'fg.muted' })
const track = css({ h: '1', borderRadius: 'full', bg: 'bg.subtle', overflow: 'hidden' })
const fill = css({ h: 'full', w: '[62%]', borderRadius: 'full', background: '[token(gradients.blaze)]' })
</script>

<template>
  <div :class="root">
    <nav :class="nav">
      <div v-for="sectionGroup in sections" :key="sectionGroup.title" :class="section">
        <p :class="sectionTitle">{{ sectionGroup.title }}</p>
        <NuxtLink
          v-for="item in sectionGroup.items"
          :key="item.href"
          :to="item.href"
          :class="[link, active === item.href ? linkActive : '']"
        >
          <Icon :name="item.icon" :size="15" />
          <span>{{ item.label }}</span>
          <span v-if="item.badge" :class="badge">{{ item.badge }}</span>
        </NuxtLink>
      </div>
    </nav>
    <div :class="footer">
      <Button variant="secondary" size="md" block icon="lucide:plus">New library</Button>
      <div :class="storage">
        <div :class="storageTop"><span>Local media</span><span>62%</span></div>
        <div :class="track"><div :class="fill" /></div>
        <p :class="css({ mt: '2', textStyle: 'ui.xs', color: 'fg.subtle' })">38.4 GB of 64 GB</p>
      </div>
    </div>
  </div>
</template>
