<script setup lang="ts">
import { css, cx } from 'styled-system/css'
import { Icon } from '#components'
import { addScreen, createScreen, moveScreen, removeScreen, updateScreen, type ScreenPatch } from '@lumen/core'
import type { Screen } from '@lumen/schema'
import { computed } from 'vue'
import { Badge, IconButton, Panel, SortableList, type BadgeTone, type SortableMove } from '~/ui'
import { useShowDocument } from '~/show/useShowDocument'
import { screenStatus } from './screenStatus'
import { useScreenOutputs } from './useScreenOutputs'

const props = defineProps<{ selectedId: string | null }>()
const emit = defineEmits<{ select: [id: string | null] }>()

const showDocument = useShowDocument()
const outputs = useScreenOutputs()
const screens = computed(() => showDocument.screens.value)

function patch(screen: Screen, value: ScreenPatch): void {
  showDocument.update((show) => updateScreen(show, screen.id, value))
}

function add(): void {
  const screen = createScreen({ name: `Screen ${screens.value.length + 1}` })
  showDocument.update((show) => addScreen(show, screen))
  emit('select', screen.id)
}

function remove(screen: Screen): void {
  const index = screens.value.findIndex((entry) => entry.id === screen.id)
  showDocument.update((show) => removeScreen(show, screen.id))
  if (props.selectedId === screen.id) {
    const next = screens.value[Math.min(index, screens.value.length - 1)]
    emit('select', next?.id ?? null)
  }
}

function onMove(move: SortableMove): void {
  const screen = screens.value[move.from.index]
  if (screen) showDocument.update((show) => moveScreen(show, screen.id, move.to.index))
}

function toggleIdentify(screen: Screen): void {
  patch(screen, { testPattern: screen.testPattern ? null : 'identify' })
}

const tones: Record<string, BadgeTone> = { live: 'success', ready: 'info', offline: 'warning', virtual: 'neutral', off: 'neutral' }

const list = css({ display: 'flex', flexDirection: 'column', gap: '1', p: '2' })
const row = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  flex: '1',
  minW: '0',
  py: '1.5',
  px: '2',
  borderRadius: 'md',
  borderWidth: '1px',
  borderColor: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
  _hover: { bg: 'bg.hover' },
})
const selectedRow = css({ bg: 'bg.active', borderColor: 'border.strong', _hover: { bg: 'bg.active' } })
const disabledRow = css({ opacity: 0.55 })
const meta = css({ flex: '1', minW: '0', display: 'flex', flexDirection: 'column', gap: '0.5' })
const name = css({ textStyle: 'ui.sm', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const sub = css({ textStyle: 'ui.xs', color: 'fg.subtle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const icon = css({ color: 'fg.subtle', flexShrink: '0' })
const item = css({ display: 'flex', flexDirection: 'column', flex: '1', minW: '0' })
const actions = css({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5', px: '1', pb: '1' })
const empty = css({ p: '3', textStyle: 'ui.xs', color: 'fg.subtle' })
</script>

<template>
  <Panel title="Screens">
    <template #actions>
      <IconButton icon="lucide:refresh-cw" label="Refresh displays" size="sm" @click="outputs.refresh()" />
      <IconButton icon="lucide:plus" label="Add screen" size="sm" @click="add" />
    </template>

    <p v-if="screens.length === 0" :class="empty">No screens yet. Add one to plan a layout, or pick a display for it.</p>
    <SortableList
      v-else
      :items="screens"
      list-id="screens"
      item-key="id"
      :item-label="(screen: Screen) => screen.name || 'Screen'"
      aria-label="Screens"
      :class="list"
      @move="onMove"
    >
      <template #default="{ item: screen }">
        <div :class="item">
          <div
            role="button"
            tabindex="0"
            :class="cx(row, screen.id === selectedId && selectedRow, !screen.enabled && disabledRow)"
            :aria-current="screen.id === selectedId || undefined"
            @click="emit('select', screen.id)"
            @keydown.enter="emit('select', screen.id)"
          >
            <Icon
              :name="screen.target.kind === 'display' ? 'lucide:monitor' : screen.role === 'stage' ? 'lucide:presentation' : 'lucide:square-dashed'"
              :size="16"
              :class="icon"
              aria-hidden="true"
            />
            <div :class="meta">
              <span :class="name">{{ screen.name || 'Screen' }}</span>
              <span :class="sub">{{ screen.size.width }}×{{ screen.size.height }} · {{ screen.role === 'stage' ? 'Stage' : 'Audience' }}</span>
            </div>
            <Badge
              :tone="tones[screenStatus(screen, outputs.displays.value, outputs.outputFor).kind]"
              dot
              :label="screenStatus(screen, outputs.displays.value, outputs.outputFor).label"
            />
          </div>
          <div v-if="screen.id === selectedId" :class="actions">
            <IconButton
              icon="lucide:scan-eye"
              label="Identify"
              size="sm"
              :active="screen.testPattern !== null"
              @click="toggleIdentify(screen)"
            />
            <IconButton
              icon="lucide:moon"
              label="Blackout"
              size="sm"
              :active="screen.blackout"
              @click="patch(screen, { blackout: !screen.blackout })"
            />
            <IconButton
              :icon="screen.enabled ? 'lucide:eye' : 'lucide:eye-off'"
              :label="screen.enabled ? 'Disable' : 'Enable'"
              size="sm"
              @click="patch(screen, { enabled: !screen.enabled })"
            />
            <IconButton icon="lucide:trash-2" label="Remove screen" shortcut="Delete" size="sm" @click="remove(screen)" />
          </div>
        </div>
      </template>
    </SortableList>
  </Panel>
</template>
