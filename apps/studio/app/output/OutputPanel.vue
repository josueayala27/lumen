<script setup lang="ts">
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { Badge, Button, Panel, PanelSection } from '~/ui'
import { isTauri, type DisplayInfo } from './api'
import { displayMeta } from './screens'
import { useOutputScreens } from './useOutputScreens'
import { onMounted } from 'vue'

const {
  displays,
  outputs,
  loading,
  error,
  refresh,
  ensureLoaded,
  assignAudience,
  openDisplay,
  closeDisplay,
  outputFor,
  isAudience,
} = useOutputScreens()

const desktop = isTauri()

onMounted(async () => {
  await ensureLoaded()
  await refresh()
})

function closeFor(display: DisplayInfo): void {
  const output = outputFor(display.index)
  if (output) void closeDisplay(output.label)
}

function displayName(index: number): string {
  return displays.value.find((display) => display.index === index)?.name ?? `Display ${index + 1}`
}

const panel = css({ h: 'auto', maxH: '[520px]' })
const note = css({ textStyle: 'ui.xs', color: 'fg.subtle', py: '1' })
const row = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  py: '2',
  borderBottomWidth: '1px',
  borderColor: 'border.default',
  _last: { borderBottomWidth: '0' },
})
const monitorIcon = css({ color: 'fg.subtle', flexShrink: '0' })
const meta = css({ flex: '1', minW: '0' })
const title = css({ display: 'flex', alignItems: 'center', gap: '1.5', textStyle: 'ui.sm', color: 'fg.default' })
const subtitle = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const failure = css({ mt: '2', textStyle: 'ui.xs', color: 'danger.default' })
</script>

<template>
  <Panel title="Screens" bordered="all" :class="panel">
    <template #actions>
      <Button variant="ghost" size="sm" icon="lucide:refresh-cw" :loading="loading" @click="refresh">Refresh</Button>
    </template>

    <PanelSection title="Audience screen">
      <p v-if="!desktop" :class="note">Screen control is available in the desktop app.</p>
      <template v-else>
        <p :class="note">Choose the monitor that feeds the live audience output. The window is native, with no webview.</p>
        <p v-if="loading && displays.length === 0" :class="note">Looking for displays…</p>
        <p v-else-if="displays.length === 0" :class="note">No displays found. Connect a projector and refresh.</p>
        <div v-for="display in displays" :key="display.index" :class="row">
          <Icon name="lucide:monitor" :size="16" :class="monitorIcon" aria-hidden="true" />
          <div :class="meta">
            <p :class="title">
              {{ display.name }}
              <Badge v-if="display.primary" size="sm" label="Primary" />
            </p>
            <p :class="subtitle">{{ displayMeta(display) }}</p>
          </div>
          <Badge v-if="isAudience(display)" tone="info" label="Audience" />
          <Badge v-if="outputFor(display.index)" tone="success" dot label="Live" />
          <Button v-if="!isAudience(display)" variant="ghost" size="sm" @click="assignAudience(display)">Use</Button>
          <Button
            v-if="!outputFor(display.index)"
            variant="secondary"
            size="sm"
            icon="lucide:play"
            @click="openDisplay(display.index)"
          >
            Open
          </Button>
          <Button v-else variant="ghost" size="sm" icon="lucide:square" @click="closeFor(display)">Close</Button>
        </div>
      </template>
    </PanelSection>

    <PanelSection title="Open outputs" flush>
      <p v-if="!desktop" :class="note">Nothing to show outside the desktop app.</p>
      <p v-else-if="outputs.length === 0" :class="note">No audience windows are open.</p>
      <div v-for="output in outputs" :key="output.label" :class="row">
        <Icon name="lucide:app-window" :size="16" :class="monitorIcon" aria-hidden="true" />
        <div :class="meta">
          <p :class="title">{{ displayName(output.display_index) }}</p>
          <p :class="subtitle">{{ output.label }} · {{ output.width }}×{{ output.height }}</p>
        </div>
        <Button variant="ghost" size="sm" icon="lucide:square" @click="closeDisplay(output.label)">Close</Button>
      </div>
    </PanelSection>
  </Panel>

  <p v-if="error" :class="failure">{{ error }}</p>
</template>
