<script setup lang="ts">
import { defaultTheme, paintToCss, validateTheme } from '@lumen/core'
import type { TextStyle, Theme, Transition } from '@lumen/schema'
import { css } from 'styled-system/css'
import { computed, onMounted, ref } from 'vue'
import {
  createTheme,
  deleteTheme,
  listThemes,
  saveTheme,
  type ThemeRecord,
} from '~/data/themes'
import { updatedLabel } from '~/data/presentations'
import ErrorNotice from '~/library/ErrorNotice.vue'
import SkeletonBlock from '~/library/SkeletonBlock.vue'
import ThemePreview from '~/themes/ThemePreview.vue'
import {
  Badge,
  Button,
  ColorField,
  EmptyState,
  Input,
  PropertyRow,
  SegmentedControl,
  Select,
  Swatch,
  type SegmentOption,
  type SelectOption,
} from '~/ui'

const items = ref<ThemeRecord[]>([])
const selectedId = ref<string | null>(null)
const draft = ref<ThemeRecord | null>(null)
const snapshot = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')

const weightOptions: SelectOption<number>[] = [300, 400, 500, 600, 700, 800, 900].map((weight) => ({
  value: weight,
  label: String(weight),
}))

const alignOptions: SegmentOption<TextStyle['align']>[] = [
  { value: 'left', label: 'Left', icon: 'lucide:align-left' },
  { value: 'center', label: 'Center', icon: 'lucide:align-center' },
  { value: 'right', label: 'Right', icon: 'lucide:align-right' },
]

const transitionOptions: SelectOption<Transition['kind']>[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'slide', label: 'Slide' },
  { value: 'zoom', label: 'Zoom' },
]

function fingerprint(record: ThemeRecord): string {
  return JSON.stringify({ id: record.id, theme: record.theme })
}

function cloneRecord(record: ThemeRecord): ThemeRecord {
  return JSON.parse(JSON.stringify(record)) as ThemeRecord
}

const query = ref('')
const filteredItems = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return needle ? items.value.filter((item) => item.theme.name.toLowerCase().includes(needle)) : items.value
})

const dirty = computed(() => (draft.value ? fingerprint(draft.value) !== snapshot.value : false))

const backgroundColor = computed<string>({
  get: () =>
    draft.value?.theme.background.kind === 'solid' ? draft.value.theme.background.color : '#101828',
  set: (color) => {
    if (draft.value) draft.value.theme.background = { kind: 'solid', color }
  },
})

const backgroundSummary = computed(() => {
  const background = draft.value?.theme.background
  if (!background) return ''
  return background.kind === 'solid' ? background.color : background.kind
})

function select(record: ThemeRecord): void {
  selectedId.value = record.id
  draft.value = cloneRecord(record)
  snapshot.value = fingerprint(draft.value)
  error.value = ''
}

async function load(preferredId?: string | null): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    items.value = await listThemes()
    const wanted = preferredId ?? selectedId.value
    const record = items.value.find((entry) => entry.id === wanted) ?? items.value[0] ?? null
    if (record) select(record)
    else {
      selectedId.value = null
      draft.value = null
      snapshot.value = ''
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function create(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    const record = await createTheme(defaultTheme('New theme'))
    await load(record.id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    saving.value = false
  }
}

async function save(): Promise<void> {
  const record = draft.value
  if (!record) return
  const theme = validateTheme(record.theme)
  if (!theme) {
    error.value = 'Theme is invalid. Check the name and styles.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await saveTheme({ ...record, theme, updatedAt: Date.now() })
    await load(record.id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  const record = draft.value
  if (!record) return
  if (typeof window !== 'undefined' && !window.confirm(`Delete theme "${record.theme.name}"?`)) return
  saving.value = true
  error.value = ''
  try {
    await deleteTheme(record.id)
    selectedId.value = null
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    saving.value = false
  }
}

function setStyleNumber(area: 'title' | 'body', key: 'fontSize' | 'lineHeight', value: string): void {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || !draft.value) return
  draft.value.theme.textStyles[area][key] = parsed
}

function setDuration(value: string): void {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || !draft.value) return
  draft.value.theme.transition.durationMs = parsed
}

function previewTheme(theme: Theme): string {
  switch (theme.background.kind) {
    case 'solid':
      return theme.background.color
    case 'gradient':
      return paintToCss(theme.background.paint)
    default:
      return '#101828'
  }
}

onMounted(() => void load())

const root = css({ display: 'flex', h: 'full', minH: '0' })
const listPanel = css({
  display: 'flex',
  flexDirection: 'column',
  w: '[300px]',
  flexShrink: '0',
  minH: '0',
  bg: 'bg.panel',
  borderRightWidth: '1px',
  borderColor: 'border.default',
})
const listHeader = css({ p: '4', borderBottomWidth: '1px', borderColor: 'border.default' })
const eyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const listTitleRow = css({ display: 'flex', alignItems: 'center', gap: '2' })
const title = css({ flex: '1', textStyle: 'display.md', color: 'fg.default' })
const listBody = css({ flex: '1', minH: '0', overflowY: 'auto', p: '2' })
const listItem = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2.5',
  w: 'full',
  px: '2',
  py: '2',
  borderRadius: 'sm',
  borderWidth: '1px',
  borderColor: 'transparent',
  color: 'fg.default',
  textAlign: 'left',
  cursor: 'pointer',
  transitionProperty: 'background, border-color',
  transitionDuration: 'fast',
  _hover: { bg: 'bg.hover' },
  _focusVisible: { bg: 'bg.hover', borderColor: 'accent.default' },
})
const listItemActive = css({ bg: 'bg.subtle', borderColor: 'accent.default' })
const listItemName = css({ flex: '1', minW: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textStyle: 'ui.sm' })
const listItemMeta = css({ display: 'block', textStyle: 'ui.xs', color: 'fg.subtle' })
const skeletonStack = css({ display: 'flex', flexDirection: 'column', gap: '1' })
const editorErrorWrap = css({ px: '5', pt: '4' })
const empty = css({ p: '4', textStyle: 'ui.sm', color: 'fg.muted', lineHeight: 'normal' })
const editor = css({ display: 'flex', flexDirection: 'column', flex: '1', minW: '0', minH: '0' })
const editorHeader = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  px: '5',
  py: '3',
  borderBottomWidth: '1px',
  borderColor: 'border.default',
  bg: 'bg.panel',
})
const editorHeading = css({ flex: '1', minW: '0' })
const editorTitle = css({ textStyle: 'ui.title', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const editorSubtitle = css({ mt: '0.5', textStyle: 'ui.xs', color: 'fg.subtle' })
const editorBody = css({ flex: '1', minH: '0', overflowY: 'auto', px: '5', py: '5' })
const editorInner = css({ maxW: '[640px]' })
const section = css({ mb: '6', pb: '5', borderBottomWidth: '1px', borderColor: 'border.default', _last: { borderBottomWidth: '0', mb: '0', pb: '0' } })
const sectionTitle = css({ mb: '3', textStyle: 'ui.label', color: 'fg.muted', textTransform: 'uppercase' })
const sectionHint = css({ mt: '2', textStyle: 'ui.xs', color: 'fg.subtle', lineHeight: 'normal' })
const rowGroup = css({ display: 'flex', flexDirection: 'column', gap: '2' })
const placeholder = css({ display: 'grid', placeItems: 'center', h: 'full', p: '6', textStyle: 'ui.sm', color: 'fg.muted', textAlign: 'center', lineHeight: 'normal' })
const previewPanel = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '3',
  w: '[380px]',
  flexShrink: '0',
  minH: '0',
  overflowY: 'auto',
  bg: 'bg.panel',
  borderLeftWidth: '1px',
  borderColor: 'border.default',
  p: '4',
})
const previewTitle = css({ textStyle: 'ui.title', color: 'fg.default' })
const previewEyebrow = css({ textStyle: 'ui.label', color: 'accent.default', textTransform: 'uppercase', mb: '1' })
const previewMeta = css({ display: 'flex', flexDirection: 'column', gap: '1.5', p: '3', borderRadius: 'md', bg: 'bg.canvas', borderWidth: '1px', borderColor: 'border.default' })
const metaRow = css({ display: 'flex', justifyContent: 'space-between', gap: '2', textStyle: 'ui.xs', color: 'fg.muted' })
const metaLabel = css({ color: 'fg.subtle' })
const metaValue = css({ textStyle: 'ui.mono', color: 'fg.default', overflow: 'hidden', textOverflow: 'ellipsis' })
const swatchRow = css({ display: 'flex', alignItems: 'center', gap: '2', textStyle: 'ui.xs', color: 'fg.muted' })
</script>

<template>
  <div :class="root">
    <aside :class="listPanel" aria-label="Theme list">
      <header :class="listHeader">
        <p :class="eyebrow">Library</p>
        <div :class="listTitleRow">
          <h1 :class="title">Themes</h1>
          <Badge tone="neutral">{{ items.length }}</Badge>
        </div>
        <Button
          variant="primary"
          size="md"
          block
          icon="lucide:plus"
          :loading="saving"
          :class="css({ mt: '3' })"
          @click="create"
        >
          New from default
        </Button>
        <Input
          v-if="items.length > 5"
          v-model="query"
          live
          type="search"
          size="md"
          placeholder="Filter themes"
          aria-label="Filter themes"
          :class="css({ mt: '2' })"
        />
      </header>
      <div :class="listBody">
        <div v-if="loading" :class="skeletonStack" role="status" aria-label="Loading themes">
          <SkeletonBlock v-for="n in 4" :key="n" height="48px" />
        </div>
        <template v-else>
          <p v-if="items.length > 0 && filteredItems.length === 0" :class="empty">No themes match “{{ query.trim() }}”.</p>
          <button
            v-for="item in filteredItems"
            :key="item.id"
            type="button"
            :class="[listItem, item.id === selectedId ? listItemActive : '']"
            :aria-current="item.id === selectedId ? 'true' : undefined"
            @click="select(item)"
          >
            <Swatch :color="previewTheme(item.theme)" size="lg" />
            <span :class="listItemName">
              {{ item.theme.name }}
              <span :class="listItemMeta">{{ updatedLabel(item.updatedAt) }}</span>
            </span>
          </button>
          <EmptyState
            v-if="items.length === 0"
            size="sm"
            icon="lucide:palette"
            title="No themes yet"
            description="Themes style backgrounds, titles and transitions across every slide."
          />
        </template>
      </div>
    </aside>

    <section :class="editor" aria-label="Theme editor">
      <template v-if="draft">
        <header :class="editorHeader">
          <div :class="editorHeading">
            <h2 :class="editorTitle">{{ draft.theme.name }}</h2>
            <p :class="editorSubtitle">Shared by every presentation that uses this theme.</p>
          </div>
          <Badge v-if="dirty" tone="warning" dot>Unsaved</Badge>
          <Button variant="ghost" size="md" icon="lucide:trash-2" :disabled="saving" @click="remove">Delete</Button>
          <Button variant="primary" size="md" icon="lucide:save" :disabled="!dirty || saving" :loading="saving" @click="save">
            Save
          </Button>
        </header>

        <div :class="editorErrorWrap" v-if="error">
          <ErrorNotice :message="error" title="Theme error" retry-label="Reload" @retry="load()" @dismiss="error = ''" />
        </div>
        <div :class="editorBody">
          <div :class="editorInner">
          <section :class="section">
            <h3 :class="sectionTitle">Identity</h3>
            <div :class="rowGroup">
              <PropertyRow label="Name" for="theme-name">
                <Input id="theme-name" v-model="draft.theme.name" live :size="'md'" aria-label="Theme name" />
              </PropertyRow>
            </div>
          </section>

          <section :class="section">
            <h3 :class="sectionTitle">Background</h3>
            <div :class="rowGroup">
              <PropertyRow label="Colour" for="theme-background">
                <ColorField id="theme-background" v-model="backgroundColor" aria-label="Background colour" />
              </PropertyRow>
              <div :class="swatchRow">
                <Swatch :color="backgroundColor" size="md" />
                <span>{{ backgroundSummary }}</span>
              </div>
            </div>
            <p :class="sectionHint">Solid background colour applied to every slide when the theme is applied.</p>
          </section>

          <section :class="section">
            <h3 :class="sectionTitle">Title style</h3>
            <div :class="rowGroup">
              <PropertyRow label="Colour">
                <ColorField v-model="draft.theme.textStyles.title.color" aria-label="Title colour" />
              </PropertyRow>
              <PropertyRow label="Size">
                <Input
                  :model-value="String(draft.theme.textStyles.title.fontSize)"
                  :size="'md'"
                  aria-label="Title font size"
                  @update:model-value="(value) => setStyleNumber('title', 'fontSize', value)"
                />
              </PropertyRow>
              <PropertyRow label="Weight">
                <Select v-model="draft.theme.textStyles.title.weight" :options="weightOptions" aria-label="Title weight" />
              </PropertyRow>
              <PropertyRow label="Align">
                <SegmentedControl v-model="draft.theme.textStyles.title.align" :options="alignOptions" aria-label="Title alignment" />
              </PropertyRow>
              <PropertyRow label="Line height">
                <Input
                  :model-value="String(draft.theme.textStyles.title.lineHeight)"
                  :size="'md'"
                  aria-label="Title line height"
                  @update:model-value="(value) => setStyleNumber('title', 'lineHeight', value)"
                />
              </PropertyRow>
            </div>
            <p :class="sectionHint">Used by slides labelled “Title”. Other slides use the body style.</p>
          </section>

          <section :class="section">
            <h3 :class="sectionTitle">Body style</h3>
            <div :class="rowGroup">
              <PropertyRow label="Colour">
                <ColorField v-model="draft.theme.textStyles.body.color" aria-label="Body colour" />
              </PropertyRow>
              <PropertyRow label="Size">
                <Input
                  :model-value="String(draft.theme.textStyles.body.fontSize)"
                  :size="'md'"
                  aria-label="Body font size"
                  @update:model-value="(value) => setStyleNumber('body', 'fontSize', value)"
                />
              </PropertyRow>
              <PropertyRow label="Weight">
                <Select v-model="draft.theme.textStyles.body.weight" :options="weightOptions" aria-label="Body weight" />
              </PropertyRow>
              <PropertyRow label="Align">
                <SegmentedControl v-model="draft.theme.textStyles.body.align" :options="alignOptions" aria-label="Body alignment" />
              </PropertyRow>
              <PropertyRow label="Line height">
                <Input
                  :model-value="String(draft.theme.textStyles.body.lineHeight)"
                  :size="'md'"
                  aria-label="Body line height"
                  @update:model-value="(value) => setStyleNumber('body', 'lineHeight', value)"
                />
              </PropertyRow>
            </div>
            <p :class="sectionHint">Applied to every text element when the theme is applied to a presentation.</p>
          </section>

          <section :class="section">
            <h3 :class="sectionTitle">Transition</h3>
            <div :class="rowGroup">
              <PropertyRow label="Kind">
                <Select v-model="draft.theme.transition.kind" :options="transitionOptions" aria-label="Transition kind" />
              </PropertyRow>
              <PropertyRow label="Duration">
                <Input
                  :model-value="String(draft.theme.transition.durationMs)"
                  :size="'md'"
                  aria-label="Transition duration in milliseconds"
                  @update:model-value="setDuration"
                />
              </PropertyRow>
              <PropertyRow label="Easing">
                <Input v-model="draft.theme.transition.easing" live :size="'md'" aria-label="Transition easing" />
              </PropertyRow>
            </div>
            <p :class="sectionHint">Stored on the theme for slides that inherit it.</p>
          </section>
          </div>
        </div>
      </template>
      <template v-else>
        <div v-if="error" :class="editorErrorWrap">
          <ErrorNotice :message="error" title="Could not load themes" @retry="load()" @dismiss="error = ''" />
        </div>
        <EmptyState
          v-if="loading"
          icon="lucide:palette"
          title="Loading themes…"
        />
        <EmptyState
          v-else
          icon="lucide:palette"
          title="Select a theme to edit"
          description="Pick one from the list, or create a new theme from the default dark theme."
        >
          <template #actions>
            <Button variant="primary" icon="lucide:plus" :loading="saving" @click="create">New from default</Button>
          </template>
        </EmptyState>
      </template>
    </section>

    <aside :class="previewPanel" aria-label="Theme preview">
      <div>
        <p :class="previewEyebrow">Live preview</p>
        <h2 :class="previewTitle">{{ draft?.theme.name ?? 'No theme selected' }}</h2>
      </div>
      <ThemePreview v-if="draft" :theme="draft.theme" />
      <div v-if="draft" :class="previewMeta">
        <div :class="metaRow"><span :class="metaLabel">Theme id</span><span :class="metaValue">{{ draft.id }}</span></div>
        <div :class="metaRow"><span :class="metaLabel">Background</span><span :class="metaValue">{{ backgroundSummary }}</span></div>
        <div :class="metaRow"><span :class="metaLabel">Transition</span><span :class="metaValue">{{ draft.theme.transition.kind }} · {{ draft.theme.transition.durationMs }}ms</span></div>
        <div :class="metaRow"><span :class="metaLabel">Updated</span><span :class="metaValue">{{ updatedLabel(draft.updatedAt) }}</span></div>
      </div>
      <p v-else :class="sectionHint">The preview follows the draft as you edit.</p>
    </aside>
  </div>
</template>
