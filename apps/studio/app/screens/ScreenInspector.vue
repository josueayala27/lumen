<script setup lang="ts">
import { css } from 'styled-system/css'
import {
  displayTarget,
  identityCornerPin,
  meshForCornerPin,
  resampleMesh,
  updateScreen,
  updateScreenLayout,
  updateScreenMapping,
  type ScreenPatch,
} from '@lumen/core'
import type { EdgeBlendSide, Layout, Mapping, MappingColor, Point, Region, Screen, TextPreset } from '@lumen/schema'
import { computed } from 'vue'
import {
  Badge,
  Button,
  ColorField,
  EmptyState,
  IconButton,
  Input,
  MultiCombobox,
  Panel,
  PanelSection,
  PropertyRow,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  type ComboboxOption,
  type SegmentOption,
  type SelectOption,
} from '~/ui'
import { screenRef } from '~/output/screens'
import { useShowDocument } from '~/show/useShowDocument'
import { clampRegion, regionPixels } from './geometry'
import ScreenNumber from './ScreenNumber.vue'
import { screenStatus } from './screenStatus'
import { useScreenOutputs } from './useScreenOutputs'

const props = defineProps<{ screen: Screen | null }>()

const showDocument = useShowDocument()
const outputs = useScreenOutputs()
const composition = computed(() => showDocument.composition.value)

// --- Edits -------------------------------------------------------------------

function patch(value: ScreenPatch, coalesce?: string): void {
  const screen = props.screen
  if (!screen) return
  showDocument.update((show) => updateScreen(show, screen.id, value), coalesce ? { coalesce: `${coalesce}:${screen.id}` } : {})
}

function patchLayout(value: Partial<Layout>, coalesce?: string): void {
  const screen = props.screen
  if (!screen) return
  showDocument.update((show) => updateScreenLayout(show, screen.id, value), coalesce ? { coalesce: `${coalesce}:${screen.id}` } : {})
}

function patchMapping(value: Partial<Mapping>, coalesce?: string): void {
  const screen = props.screen
  if (!screen) return
  showDocument.update((show) => updateScreenMapping(show, screen.id, value), coalesce ? { coalesce: `${coalesce}:${screen.id}` } : {})
}

// --- Target, size, role ------------------------------------------------------

const SAVED = 'saved'
const targetValue = computed(() => {
  const screen = props.screen
  if (!screen || screen.target.kind !== 'display') return screen?.target.kind ?? 'virtual'
  const display = outputs.displayFor(screen)
  return display ? `display:${display.index}` : SAVED
})
const targetOptions = computed<SelectOption[]>(() => {
  const options: SelectOption[] = [{ value: 'virtual', label: 'Virtual (preview only)', icon: 'lucide:square-dashed' }]
  const screen = props.screen
  if (screen?.target.kind === 'display' && !outputs.displayFor(screen)) {
    options.push({ value: SAVED, label: `${screen.target.ref.name} (not connected)`, icon: 'lucide:monitor-off' })
  }
  if (screen?.target.kind === 'ndi') options.push({ value: 'ndi', label: `NDI · ${screen.target.name}`, icon: 'lucide:radio' })
  for (const display of outputs.displays.value) {
    options.push({
      value: `display:${display.index}`,
      label: `${display.name} · ${display.width}×${display.height}${display.primary ? ' · primary' : ''}`,
      icon: 'lucide:monitor',
    })
  }
  return options
})

function setTarget(value?: string): void {
  if (!value || value === targetValue.value || value === SAVED || value === 'ndi') return
  if (value === 'virtual') {
    patch({ target: { kind: 'virtual' } })
    return
  }
  const index = Number(value.slice('display:'.length))
  const display = outputs.displays.value.find((entry) => entry.index === index)
  if (display) patch({ target: displayTarget(screenRef(display)), size: { width: display.width, height: display.height } })
}

const followsMonitor = computed(() => props.screen?.target.kind === 'display')
const status = computed(() => (props.screen ? screenStatus(props.screen, outputs.displays.value, outputs.outputFor) : null))
const output = computed(() => (props.screen ? outputs.outputForScreen(props.screen) : null))
const canOpen = computed(() => (props.screen ? outputs.displayFor(props.screen) !== null : false))

function setSize(key: 'width' | 'height', value: number): void {
  const screen = props.screen
  if (!screen) return
  patch({ size: { ...screen.size, [key]: Math.max(1, Math.round(value)) } }, `size-${key}`)
}

const roleOptions: SegmentOption<Screen['role']>[] = [
  { value: 'audience', label: 'Audience' },
  { value: 'stage', label: 'Stage' },
]

function setRole(role?: Screen['role']): void {
  const screen = props.screen
  if (!screen || !role || role === screen.role) return
  showDocument.update((show) => {
    const next = updateScreen(show, screen.id, { role })
    const stage = role === 'stage' ? (screen.layout.stage ?? { show: ['current', 'next', 'clock'] as const }) : null
    return updateScreenLayout(next, screen.id, { stage: stage ? { show: [...stage.show] } : null })
  })
}

const patternOptions: SelectOption[] = [
  { value: 'none', label: 'None' },
  { value: 'identify', label: 'Identify' },
  { value: 'bars', label: 'Colour bars' },
  { value: 'grid', label: 'Grid' },
]

function setPattern(value?: string): void {
  if (!value) return
  patch({ testPattern: value === 'none' ? null : (value as Screen['testPattern']) })
}

// --- Layout --------------------------------------------------------------------

const layerModeOptions: SegmentOption<'all' | 'only'>[] = [
  { value: 'all', label: 'All layers' },
  { value: 'only', label: 'Only' },
]
const layerOptions = computed<ComboboxOption[]>(() =>
  composition.value.layers.map((layer) => ({ value: layer.id, label: layer.name || layer.id, icon: 'lucide:layers' })),
)
const tagOptions = computed<ComboboxOption[]>(() => {
  const tags = new Set(composition.value.layers.flatMap((layer) => layer.tags))
  const filter = props.screen?.layout.layers
  if (filter?.mode === 'only') for (const tag of filter.tags) tags.add(tag)
  return [...tags].sort().map((tag) => ({ value: tag, label: tag, icon: 'lucide:tag' }))
})
const onlyIds = computed(() => (props.screen?.layout.layers.mode === 'only' ? props.screen.layout.layers.ids : []))
const onlyTags = computed(() => (props.screen?.layout.layers.mode === 'only' ? props.screen.layout.layers.tags : []))

function setLayerMode(mode?: 'all' | 'only'): void {
  const screen = props.screen
  if (!screen || !mode || mode === screen.layout.layers.mode) return
  // Switching to "only" starts from every layer, so nothing disappears at once.
  patchLayout({ layers: mode === 'all' ? { mode: 'all' } : { mode: 'only', ids: composition.value.layers.map((layer) => layer.id), tags: [] } })
}

function setOnly(ids: string[], tags: string[]): void {
  patchLayout({ layers: { mode: 'only', ids, tags } })
}

function setRegion(key: keyof Region, value: number): void {
  const screen = props.screen
  if (!screen) return
  patchLayout({ region: clampRegion({ ...screen.layout.region, [key]: value }) }, `region-${key}`)
}

const regionSize = computed(() => (props.screen ? regionPixels(props.screen.layout.region, composition.value.canvas) : null))

function setSafeArea(key: keyof Layout['safeArea'], value: number): void {
  const screen = props.screen
  if (!screen) return
  patchLayout({ safeArea: { ...screen.layout.safeArea, [key]: Math.min(0.5, Math.max(0, value)) } }, `safe-${key}`)
}

const presetOptions: SegmentOption<TextPreset>[] = [
  { value: 'full', label: 'Full' },
  { value: 'lowerThird', label: 'Lower' },
  { value: 'strip', label: 'Strip' },
  { value: 'hidden', label: 'Hidden' },
]
const text = computed(() => props.screen?.layout.text ?? { preset: 'full' as const, scale: 1, color: null })

function setText(value: Partial<NonNullable<Layout['text']>>, coalesce?: string): void {
  patchLayout({ text: { ...text.value, ...value } }, coalesce)
}

// --- Mapping -------------------------------------------------------------------

const pin = computed(() => props.screen?.mapping.cornerPin ?? null)
const pinNames = ['Top left', 'Top right', 'Bottom right', 'Bottom left']

function setPinPoint(index: number, key: keyof Point, value: number): void {
  const current = pin.value
  if (!current) return
  const next = current.map((point, at) => (at === index ? { ...point, [key]: value } : point)) as typeof current
  patchMapping({ cornerPin: next }, `pin-${index}-${key}`)
}

const mesh = computed(() => props.screen?.mapping.mesh ?? null)

function setMeshSize(key: 'cols' | 'rows', value: number): void {
  const current = mesh.value
  if (!current) return
  const size = Math.min(16, Math.max(2, Math.round(value)))
  patchMapping({ mesh: resampleMesh(current, key === 'cols' ? size : current.cols, key === 'rows' ? size : current.rows) })
}

const SIDES = ['left', 'right', 'top', 'bottom'] as const
type Side = (typeof SIDES)[number]
const blend = computed(() => props.screen?.mapping.edgeBlend ?? null)
const defaultSide = (): EdgeBlendSide => ({ width: 0, gamma: 2.2, power: 1 })

function setBlendOn(on: boolean): void {
  patchMapping({ edgeBlend: on ? { left: defaultSide(), right: defaultSide(), top: defaultSide(), bottom: defaultSide() } : null })
}

function setBlend(side: Side, value: Partial<EdgeBlendSide>, coalesce: string): void {
  const current = blend.value
  if (!current) return
  patchMapping({ edgeBlend: { ...current, [side]: { ...current[side], ...value } } }, `blend-${side}-${coalesce}`)
}

const color = computed<MappingColor>(() => props.screen?.mapping.color ?? { brightness: 0, contrast: 1, gamma: 1, red: 1, green: 1, blue: 1 })
const colorRows: { key: keyof MappingColor; label: string; min: number; max: number; step: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01 },
  { key: 'gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01 },
  { key: 'red', label: 'Red', min: 0, max: 2, step: 0.01 },
  { key: 'green', label: 'Green', min: 0, max: 2, step: 0.01 },
  { key: 'blue', label: 'Blue', min: 0, max: 2, step: 0.01 },
]

function setColor(key: keyof MappingColor, value: number): void {
  patchMapping({ color: { ...color.value, [key]: value } }, `color-${key}`)
}

function resetColor(): void {
  patchMapping({ color: { brightness: 0, contrast: 1, gamma: 1, red: 1, green: 1, blue: 1 } })
}

const grid2 = css({ display: 'grid', gridTemplateColumns: '[1fr 1fr]', gap: '1.5', w: 'full' })
const grid4 = css({ display: 'grid', gridTemplateColumns: '[1fr 1fr 1fr 1fr]', gap: '1', w: 'full' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle', py: '1' })
const inline = css({ display: 'flex', alignItems: 'center', gap: '2', w: 'full' })
const grow = css({ flex: '1', minW: '0' })
const value = css({ textStyle: 'ui.mono', color: 'fg.muted', minW: '[40px]', textAlign: 'right' })
const sub = css({ textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase', pt: '2', pb: '1' })
const sectionBody = css({ display: 'flex', flexDirection: 'column', gap: '1.5' })
const maskRow = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textStyle: 'ui.xs', color: 'fg.muted', py: '0.5' })
</script>

<template>
  <Panel v-if="!screen" title="Screen">
    <EmptyState size="sm" icon="lucide:monitor" title="No screen selected" description="Add a screen or pick one in the list." />
  </Panel>
  <Panel v-else title="Screen">
    <template #actions>
      <Badge v-if="status" size="sm" :label="status.label" :tone="status.kind === 'live' ? 'success' : status.kind === 'offline' ? 'warning' : 'neutral'" dot />
    </template>

    <PanelSection title="Screen">
      <div :class="sectionBody">
        <PropertyRow label="Name">
          <Input :model-value="screen.name" size="sm" aria-label="Screen name" @update:model-value="(name: string) => patch({ name })" />
        </PropertyRow>
        <PropertyRow label="Target">
          <Select :model-value="targetValue" :options="targetOptions" size="sm" aria-label="Target" @update:model-value="setTarget" />
        </PropertyRow>
        <PropertyRow label="Size">
          <div :class="grid2">
            <ScreenNumber :value="screen.size.width" label="W" :min="1" :decimals="0" unit="px" :disabled="followsMonitor" aria-label="Width" @change="setSize('width', $event)" />
            <ScreenNumber :value="screen.size.height" label="H" :min="1" :decimals="0" unit="px" :disabled="followsMonitor" aria-label="Height" @change="setSize('height', $event)" />
          </div>
        </PropertyRow>
        <p v-if="followsMonitor" :class="hint">Display targets follow the monitor size.</p>
        <PropertyRow label="Role">
          <SegmentedControl :model-value="screen.role" :options="roleOptions" size="sm" aria-label="Role" @update:model-value="setRole" />
        </PropertyRow>
        <PropertyRow label="Enabled">
          <Switch :model-value="screen.enabled" size="sm" aria-label="Enabled" @update:model-value="(enabled: boolean) => patch({ enabled })" />
        </PropertyRow>
        <PropertyRow label="Blackout">
          <Switch :model-value="screen.blackout" size="sm" aria-label="Blackout" @update:model-value="(blackout: boolean) => patch({ blackout })" />
        </PropertyRow>
        <PropertyRow label="Pattern">
          <Select :model-value="screen.testPattern ?? 'none'" :options="patternOptions" size="sm" aria-label="Test pattern" @update:model-value="setPattern" />
        </PropertyRow>
        <PropertyRow v-if="canOpen" label="Output">
          <Button v-if="!output" size="sm" variant="secondary" icon="lucide:play" @click="outputs.open(screen)">Open window</Button>
          <Button v-else size="sm" variant="ghost" icon="lucide:square" @click="outputs.close(screen)">Close window</Button>
        </PropertyRow>
      </div>
    </PanelSection>

    <PanelSection title="Layout" collapsible storage-key="lumen.screens.layout">
      <div :class="sectionBody">
        <PropertyRow label="Layers">
          <SegmentedControl :model-value="screen.layout.layers.mode" :options="layerModeOptions" size="sm" aria-label="Layers" @update:model-value="setLayerMode" />
        </PropertyRow>
        <template v-if="screen.layout.layers.mode === 'only'">
          <PropertyRow label="Ids" align="start">
            <MultiCombobox
              :model-value="onlyIds"
              :options="layerOptions"
              :label-for="(id: string) => composition.layers.find((layer) => layer.id === id)?.name"
              placeholder="Pick layers"
              size="sm"
              aria-label="Layers by id"
              @update:model-value="(ids: string[]) => setOnly(ids, onlyTags)"
            />
          </PropertyRow>
          <PropertyRow label="Tags" align="start">
            <MultiCombobox
              :model-value="onlyTags"
              :options="tagOptions"
              creatable
              placeholder="Follow tags"
              size="sm"
              aria-label="Layers by tag"
              @update:model-value="(tags: string[]) => setOnly(onlyIds, tags)"
              @create="(tag: string) => setOnly(onlyIds, [...onlyTags, tag.trim()].filter(Boolean))"
            />
          </PropertyRow>
        </template>

        <p :class="sub">Region</p>
        <div :class="grid2">
          <ScreenNumber :value="screen.layout.region.x" label="X" :min="0" :max="1" :scale="100" unit="%" :decimals="1" @change="setRegion('x', $event)" />
          <ScreenNumber :value="screen.layout.region.y" label="Y" :min="0" :max="1" :scale="100" unit="%" :decimals="1" @change="setRegion('y', $event)" />
          <ScreenNumber :value="screen.layout.region.w" label="W" :min="0.02" :max="1" :scale="100" unit="%" :decimals="1" @change="setRegion('w', $event)" />
          <ScreenNumber :value="screen.layout.region.h" label="H" :min="0.02" :max="1" :scale="100" unit="%" :decimals="1" @change="setRegion('h', $event)" />
        </div>
        <p v-if="regionSize" :class="hint">{{ regionSize.width }}×{{ regionSize.height }} canvas pixels, scaled to {{ screen.size.width }}×{{ screen.size.height }}.</p>

        <p :class="sub">Safe area</p>
        <div :class="grid4">
          <ScreenNumber :value="screen.layout.safeArea.top" label="T" :min="0" :max="0.5" :scale="100" unit="%" :decimals="0" aria-label="Safe area top" @change="setSafeArea('top', $event)" />
          <ScreenNumber :value="screen.layout.safeArea.right" label="R" :min="0" :max="0.5" :scale="100" unit="%" :decimals="0" aria-label="Safe area right" @change="setSafeArea('right', $event)" />
          <ScreenNumber :value="screen.layout.safeArea.bottom" label="B" :min="0" :max="0.5" :scale="100" unit="%" :decimals="0" aria-label="Safe area bottom" @change="setSafeArea('bottom', $event)" />
          <ScreenNumber :value="screen.layout.safeArea.left" label="L" :min="0" :max="0.5" :scale="100" unit="%" :decimals="0" aria-label="Safe area left" @change="setSafeArea('left', $event)" />
        </div>

        <p :class="sub">Text</p>
        <PropertyRow label="Preset">
          <SegmentedControl
            :model-value="text.preset"
            :options="presetOptions"
            size="sm"
            aria-label="Text preset"
            @update:model-value="(preset?: TextPreset) => preset && setText({ preset })"
          />
        </PropertyRow>
        <PropertyRow label="Scale">
          <div :class="inline">
            <Slider
              :model-value="text.scale"
              :min="0.25"
              :max="3"
              :step="0.05"
              aria-label="Text scale"
              :class="grow"
              @update:model-value="(scale: number) => setText({ scale }, 'text-scale')"
            />
            <span :class="value">{{ text.scale.toFixed(2) }}×</span>
          </div>
        </PropertyRow>
        <PropertyRow label="Colour">
          <div :class="inline">
            <ColorField
              :model-value="text.color ?? ''"
              size="sm"
              aria-label="Text colour"
              :class="grow"
              @update:model-value="(value: string) => setText({ color: value || null }, 'text-color')"
            />
            <IconButton v-if="text.color" icon="lucide:x" label="Use source colour" size="sm" @click="setText({ color: null })" />
          </div>
        </PropertyRow>

        <p :class="sub">Background</p>
        <PropertyRow label="Fill">
          <div :class="inline">
            <ColorField
              :model-value="screen.layout.background ?? ''"
              size="sm"
              aria-label="Background colour"
              :class="grow"
              @update:model-value="(value: string) => patchLayout({ background: value || null }, 'background')"
            />
            <IconButton v-if="screen.layout.background" icon="lucide:x" label="No background" size="sm" @click="patchLayout({ background: null })" />
          </div>
        </PropertyRow>
      </div>
    </PanelSection>

    <PanelSection title="Mapping" collapsible storage-key="lumen.screens.mapping">
      <div :class="sectionBody">
        <p :class="hint">Saved with the show and applied by the compositor. Image output masks are not rendered; up to four rect or polygon masks are.</p>

        <PropertyRow label="Corner pin">
          <Switch :model-value="pin !== null" size="sm" aria-label="Corner pin" @update:model-value="(on: boolean) => patchMapping({ cornerPin: on ? identityCornerPin() : null })" />
        </PropertyRow>
        <template v-if="pin">
          <PropertyRow v-for="(point, index) in pin" :key="index" :label="pinNames[index]">
            <div :class="grid2">
              <ScreenNumber :value="point.x" label="X" :min="-0.5" :max="1.5" :scale="100" unit="%" :decimals="1" :aria-label="`${pinNames[index]} X`" @change="setPinPoint(index, 'x', $event)" />
              <ScreenNumber :value="point.y" label="Y" :min="-0.5" :max="1.5" :scale="100" unit="%" :decimals="1" :aria-label="`${pinNames[index]} Y`" @change="setPinPoint(index, 'y', $event)" />
            </div>
          </PropertyRow>
        </template>

        <PropertyRow label="Mesh">
          <Switch :model-value="mesh !== null" size="sm" aria-label="Mesh warp" @update:model-value="(on: boolean) => patchMapping({ mesh: on ? meshForCornerPin(4, 3, pin) : null })" />
        </PropertyRow>
        <PropertyRow v-if="mesh" label="Grid">
          <div :class="grid2">
            <ScreenNumber :value="mesh.cols" label="C" :min="2" :max="16" :decimals="0" aria-label="Mesh columns" @change="setMeshSize('cols', $event)" />
            <ScreenNumber :value="mesh.rows" label="R" :min="2" :max="16" :decimals="0" aria-label="Mesh rows" @change="setMeshSize('rows', $event)" />
          </div>
        </PropertyRow>
        <p v-if="mesh" :class="hint">Drag mesh points in the Output view.</p>

        <PropertyRow label="Edge blend">
          <Switch :model-value="blend !== null" size="sm" aria-label="Edge blend" @update:model-value="setBlendOn" />
        </PropertyRow>
        <template v-if="blend">
          <template v-for="side in SIDES" :key="side">
            <PropertyRow :label="side.charAt(0).toUpperCase() + side.slice(1)">
              <div :class="inline">
                <Slider
                  :model-value="blend[side].width"
                  :min="0"
                  :max="0.5"
                  :step="0.005"
                  :aria-label="`${side} blend width`"
                  :class="grow"
                  @update:model-value="(width: number) => setBlend(side, { width }, 'width')"
                />
                <span :class="value">{{ Math.round(blend[side].width * 1000) / 10 }}%</span>
              </div>
            </PropertyRow>
            <PropertyRow v-if="blend[side].width > 0" label="">
              <div :class="grid2">
                <ScreenNumber :value="blend[side].gamma" label="γ" :min="0.1" :max="4" :step="0.1" :decimals="2" :aria-label="`${side} blend gamma`" @change="setBlend(side, { gamma: $event }, 'gamma')" />
                <ScreenNumber :value="blend[side].power" label="P" :min="0.1" :max="4" :step="0.1" :decimals="2" :aria-label="`${side} blend power`" @change="setBlend(side, { power: $event }, 'power')" />
              </div>
            </PropertyRow>
          </template>
        </template>
      </div>
    </PanelSection>

    <PanelSection title="Colour" collapsible storage-key="lumen.screens.colour">
      <template #actions>
        <IconButton icon="lucide:rotate-ccw" label="Reset colour" size="sm" @click="resetColor" />
      </template>
      <div :class="sectionBody">
        <PropertyRow v-for="row in colorRows" :key="row.key" :label="row.label">
          <div :class="inline">
            <Slider
              :model-value="color[row.key]"
              :min="row.min"
              :max="row.max"
              :step="row.step"
              :aria-label="row.label"
              :class="grow"
              @update:model-value="(next: number) => setColor(row.key, next)"
            />
            <span :class="value">{{ color[row.key].toFixed(2) }}</span>
          </div>
        </PropertyRow>
      </div>
    </PanelSection>

    <PanelSection title="Masks" collapsible storage-key="lumen.screens.masks" flush>
      <p v-if="screen.mapping.masks.length === 0" :class="hint">No output masks. Mask editing for screens comes with the mapping pass.</p>
      <template v-else>
        <div v-for="(mask, index) in screen.mapping.masks" :key="index" :class="maskRow">
          <span>Mask {{ index + 1 }}</span>
          <span>{{ mask.kind }}</span>
        </div>
        <p :class="hint">Mask editing for screens comes with the mapping pass.</p>
      </template>
    </PanelSection>
  </Panel>
</template>
