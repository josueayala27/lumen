<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon, NuxtLink } from '#components'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { formatBytes } from '~/ui'
import { useShellStats } from './useShellStats'

interface NavItem {
  label: string
  href: string
  icon: string
  /** Extra path prefixes that keep this item highlighted (e.g. editor routes). */
  also?: string[]
}

withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })

const route = useRoute()
const { media, mediaBytes } = useShellStats()

const sections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Library',
    items: [
      { label: 'Library', href: '/', icon: 'lucide:presentation', also: ['/editor'] },
      { label: 'Songs', href: '/songs', icon: 'lucide:music' },
      { label: 'Media', href: '/media', icon: 'lucide:image' },
      { label: 'Themes', href: '/themes', icon: 'lucide:palette' },
      { label: 'Playlists', href: '/playlists', icon: 'lucide:list-music' },
      { label: 'Timelines', href: '/timeline', icon: 'lucide:film' },
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

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function isActive(item: NavItem): boolean {
  const path = route.path
  if (item.href === '/') return path === '/' || (item.also ?? []).some((prefix) => matches(path, prefix))
  return matches(path, item.href)
}

const mediaLabel = computed(() => {
  const count = media.value.length
  if (count === 0) return 'No media imported'
  return `${count} ${count === 1 ? 'file' : 'files'} · ${formatBytes(mediaBytes.value)}`
})

const root = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0' })
const nav = css({ flex: '1', minH: '0', overflowY: 'auto', px: '2', py: '3' })
const section = css({ display: 'flex', flexDirection: 'column', gap: '0.5', mb: '5' })
const sectionTitle = css({ px: '2', mb: '1', textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase' })
const divider = css({ h: '[1px]', mx: '2', mb: '2', bg: 'border.default' })
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
  _focusVisible: { outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'accent.default', outlineOffset: '[-2px]' },
})
const linkCollapsed = css({ justifyContent: 'center', px: '0' })
const linkActive = css({ bg: 'bg.subtle', color: 'fg.default', borderColor: 'accent.default' })
const footer = css({ flexShrink: '0', p: '3', borderTopWidth: '1px', borderColor: 'border.default' })
const storage = css({ display: 'flex', alignItems: 'center', gap: '2.5', p: '2.5', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default', color: 'fg.subtle' })
const storageText = css({ minW: '0' })
const storageTitle = css({ textStyle: 'ui.xs', color: 'fg.muted' })
const storageDetail = css({ textStyle: 'ui.xs', color: 'fg.subtle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const srOnly = css({ position: 'absolute', w: '[1px]', h: '[1px]', overflow: 'hidden', clip: '[rect(0 0 0 0)]', whiteSpace: 'nowrap' })
</script>

<template>
  <div :class="root">
    <nav :class="nav" aria-label="Primary">
      <div v-for="(sectionGroup, index) in sections" :key="sectionGroup.title" :class="section">
        <p v-if="!collapsed" :class="sectionTitle">{{ sectionGroup.title }}</p>
        <span v-else-if="index > 0" :class="divider" />
        <NuxtLink
          v-for="item in sectionGroup.items"
          :key="item.href"
          :to="item.href"
          :title="collapsed ? item.label : undefined"
          :aria-current="isActive(item) ? 'page' : undefined"
          :class="[link, collapsed ? linkCollapsed : '', isActive(item) ? linkActive : '']"
        >
          <Icon :name="item.icon" :size="15" aria-hidden="true" />
          <span :class="collapsed ? srOnly : ''">{{ item.label }}</span>
        </NuxtLink>
      </div>
    </nav>
    <div v-if="!collapsed" :class="footer">
      <div :class="storage" role="status">
        <Icon name="lucide:hard-drive" :size="16" aria-hidden="true" />
        <div :class="storageText">
          <p :class="storageTitle">Local media</p>
          <p :class="storageDetail">{{ mediaLabel }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
