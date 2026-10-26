<script setup lang="ts">
import {
  addLayer,
  applyThemeToDoc,
  canRedo,
  canUndo,
  clampSelection,
  clearSelection,
  copySelectedLayers,
  createEditorState,
  createShapeLayer,
  createTextLayer,
  currentSlide,
  duplicateSelectedLayers,
  orderedElements,
  pasteLayers,
  redo,
  removeSelectedLayers,
  reorderLayer,
  selectLayer,
  selectedElements,
  setSlide,
  setSlideText,
  slideText,
  songFields,
  splitSongLyrics,
  textSlide,
  undo,
  updateDocument,
  updateLayer,
  updateSongDoc,
  type EditorState,
  type ShapeElement,
  type SongFields,
  type TextElement,
} from '@lumen/core'
import type { Element, PresentationDoc } from '@lumen/schema'
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, ColorField, IconButton, Input, Select, Textarea } from '~/ui'
import {
  getPresentation,
  savePresentation,
  type PresentationRecord,
} from '~/data/presentations'
import { listThemes, type ThemeRecord } from '~/data/themes'

const route = useRoute()
const router = useRouter()
const id = computed(() => {
  const value = (route.params as { id?: string | string[] }).id
  return Array.isArray(value) ? (value[0] ?? '') : String(value ?? '')
})
const record = ref<PresentationRecord | null>(null)
const editor = ref<EditorState | null>(null)
const themes = ref<ThemeRecord[]>([])
const themeId = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const savedAt = ref<number | null>(null)

const titleDraft = ref('')
const song = ref<SongFields>({ title: '', author: '', ccli: '', key: '', tempo: null, lyrics: '' })
const tempoText = ref('')
const selected = ref(0)

const isSong = computed(() => record.value?.kind === 'song')
const songSlides = computed(() => splitSongLyrics(song.value.lyrics))
const presentationDoc = computed<PresentationDoc | null>(() => editor.value?.doc ?? null)
const presentationSlides = computed(() => presentationDoc.value?.slides ?? [])
const slideCount = computed(() =>
  isSong.value ? Math.max(1, songSlides.value.length) : Math.max(1, presentationSlides.value.length),
)
const activeSlideIndex = computed(() => {
  if (isSong.value) return Math.min(selected.value, Math.max(0, songSlides.value.length - 1))
  const slideId = editor.value?.slideId
  const index = presentationSlides.value.findIndex((slide) => slide.id === slideId)
  return index < 0 ? 0 : index
})
const activeSlide = computed(() => {
  if (isSong.value || !editor.value) return null
  return currentSlide(editor.value)
})
const currentText = computed(() => {
  if (isSong.value) return songSlides.value[selected.value]?.text ?? ''
  return activeSlide.value ? slideText(activeSlide.value) : ''
})
const currentLabel = computed(() => {
  if (isSong.value) return songSlides.value[selected.value]?.sectionLabel ?? 'Slide'
  return `Slide ${activeSlideIndex.value + 1}`
})
const previewLines = computed(() =>
  isSong.value ? songSlides.value[selected.value]?.lines ?? [] : [],
)
const previewLayers = computed(() =>
  activeSlide.value ? orderedElements(activeSlide.value) : [],
)
const orderedLayers = computed(() => previewLayers.value.slice().reverse())
const selectedLayers = computed(() =>
  editor.value ? selectedElements(editor.value) : [],
)
const singleLayer = computed<Element | null>(() =>
  selectedLayers.value.length === 1 ? selectedLayers.value[0] ?? null : null,
)
const singleTextLayer = computed<TextElement | null>(() => {
  const layer = singleLayer.value
  return layer && layer.kind === 'text' ? layer : null
})
const singleShapeLayer = computed<ShapeElement | null>(() => {
  const layer = singleLayer.value
  return layer && layer.kind === 'shape' ? layer : null
})
const singleTextValue = computed(() =>
  singleTextLayer.value ? singleTextLayer.value.runs.map((run) => run.text).join('\n') : '',
)
const hasSelection = computed(() => (editor.value?.selection.length ?? 0) > 0)
const canPaste = computed(() => (editor.value?.clipboard.length ?? 0) > 0)
const canUndoNow = computed(() => (editor.value ? canUndo(editor.value) : false))
const canRedoNow = computed(() => (editor.value ? canRedo(editor.value) : false))
const themeOptions = computed(() => {
  const options: Array<{ value: string; label: string }> = [
    { value: '', label: 'Document theme' },
    ...themes.value.map((entry) => ({ value: entry.id, label: entry.theme.name })),
  ]
  if (themeId.value && !themes.value.some((entry) => entry.id === themeId.value)) {
    options.push({ value: themeId.value, label: 'Unknown theme' })
  }
  return options
})
const frameFields = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'w', label: 'W' },
  { key: 'h', label: 'H' },
] as const

const signature = computed(() =>
  JSON.stringify({
    title: titleDraft.value,
    song: isSong.value ? song.value : null,
    tempo: isSong.value ? tempoText.value : null,
    doc: isSong.value ? null : presentationDoc.value,
    theme: themeId.value,
  }),
)
const baseline = ref('')
const dirty = computed(() => signature.value !== baseline.value)
const savedLabel = computed(() => {
  if (saving.value) return 'Saving…'
  if (dirty.value) return 'Unsaved changes'
  if (savedAt.value) return 'Saved'
  return 'Local draft'
})

watch(slideCount, (count) => {
  if (selected.value >= count) selected.value = Math.max(0, count - 1)
})

async function loadThemes(): Promise<void> {
  try {
    themes.value = await listThemes()
  } catch {
    themes.value = []
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const found = await getPresentation(id.value)
    if (!found) {
      error.value = 'This presentation was not found.'
      return
    }
    record.value = found
    titleDraft.value = found.doc.title
    if (found.doc.kind === 'song') {
      const fields = songFields(found.doc)
      song.value = { ...fields, title: found.doc.title }
      tempoText.value = fields.tempo === null ? '' : String(fields.tempo)
      editor.value = null
      selected.value = 0
    } else {
      editor.value = createEditorState(found.doc)
      selected.value = 0
    }
    themeId.value = found.doc.themeId ?? ''
    baseline.value = signature.value
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

function parseTempo(): number | null {
  const value = Number(tempoText.value)
  return Number.isFinite(value) && value > 0 ? value : null
}

async function save(): Promise<void> {
  if (!record.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    let nextDoc: PresentationDoc
    if (isSong.value) {
      nextDoc = updateSongDoc(record.value.doc, {
        ...song.value,
        title: titleDraft.value,
        tempo: parseTempo(),
      })
      nextDoc = { ...nextDoc, themeId: record.value.doc.themeId }
    } else {
      if (!editor.value) return
      nextDoc = {
        ...editor.value.doc,
        title: titleDraft.value.trim() || 'Untitled presentation',
      }
    }

    if (themeId.value && themeId.value !== nextDoc.themeId) {
      const found = themes.value.find((entry) => entry.id === themeId.value)
      if (found) nextDoc = applyThemeToDoc(nextDoc, found.theme, found.id)
    } else if (!themeId.value && nextDoc.themeId !== null) {
      nextDoc = { ...nextDoc, themeId: null }
    }
    nextDoc = { ...nextDoc, title: titleDraft.value.trim() || nextDoc.title }

    record.value = { ...record.value, doc: nextDoc, updatedAt: Date.now() }
    await savePresentation(record.value)
    if (!isSong.value && editor.value) {
      editor.value = clampSelection({ ...editor.value, doc: nextDoc })
    }
    savedAt.value = Date.now()
    themeId.value = nextDoc.themeId ?? ''
    baseline.value = signature.value
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    saving.value = false
  }
}

function selectSlide(index: number): void {
  if (isSong.value) {
    selected.value = index
    return
  }
  const slide = presentationSlides.value[index]
  if (!slide || !editor.value) return
  editor.value = setSlide(editor.value, slide.id)
}

function addSlide(): void {
  if (isSong.value || !editor.value) return
  const slide = textSlide('New slide')
  editor.value = updateDocument(
    editor.value,
    (doc) => ({ ...doc, slides: [...doc.slides, slide] }),
    slide.id,
  )
}

function removeSlide(index: number): void {
  if (isSong.value || !editor.value) return
  const slides = presentationSlides.value
  if (slides.length <= 1) return
  const removed = slides[index]
  if (!removed) return
  const remaining = slides.filter((_, entry) => entry !== index)
  const fallback = remaining[Math.min(index, remaining.length - 1)]
  if (!fallback) return
  editor.value = updateDocument(
    editor.value,
    (doc) => ({ ...doc, slides: doc.slides.filter((slide) => slide.id !== removed.id) }),
    fallback.id,
  )
}

function stepSlide(index: number, delta: number): void {
  if (isSong.value || !editor.value) return
  const slides = presentationSlides.value
  const target = index + delta
  if (target < 0 || target >= slides.length) return
  const moved = slides[index]
  if (!moved) return
  const next = [...slides]
  const [entry] = next.splice(index, 1)
  if (!entry) return
  next.splice(target, 0, entry)
  editor.value = updateDocument(editor.value, (doc) => ({ ...doc, slides: next }), moved.id)
}

function updateSlideText(value: string): void {
  const state = editor.value
  const slide = state ? currentSlide(state) : null
  if (!state || !slide) return
  editor.value = updateDocument(state, (doc) => ({
    ...doc,
    slides: doc.slides.map((entry) =>
      entry.id === slide.id ? setSlideText(entry, value) : entry,
    ),
  }))
}

function setSongText(value: string): void {
  song.value = { ...song.value, lyrics: value }
}

function addTextLayer(): void {
  if (!editor.value) return
  editor.value = addLayer(editor.value, createTextLayer({ text: 'New text' }))
}

function addShapeLayer(): void {
  if (!editor.value) return
  editor.value = addLayer(editor.value, createShapeLayer())
}

function selectLayerRow(layer: string, event: MouseEvent): void {
  if (!editor.value) return
  const additive = event.shiftKey || event.metaKey || event.ctrlKey
  editor.value = selectLayer(editor.value, layer, additive)
}

function isLayerSelected(layer: string): boolean {
  return editor.value?.selection.includes(layer) ?? false
}

function moveSelection(delta: number): void {
  const state = editor.value
  const slide = state ? currentSlide(state) : null
  if (!state || !slide) return
  const ids = orderedElements(slide)
    .filter((element) => state.selection.includes(element.id))
    .map((element) => element.id)
  const ordered = delta > 0 ? ids.reverse() : ids
  let next = state
  for (const layer of ordered) next = reorderLayer(next, layer, delta)
  editor.value = next
}

function duplicateSelection(): void {
  if (!editor.value) return
  editor.value = duplicateSelectedLayers(editor.value)
}

function deleteSelection(): void {
  if (!editor.value) return
  editor.value = removeSelectedLayers(editor.value)
}

function copySelection(): void {
  if (!editor.value) return
  editor.value = copySelectedLayers(editor.value)
}

function pasteClipboard(): void {
  if (!editor.value) return
  editor.value = pasteLayers(editor.value)
}

function undoEdit(): void {
  if (!editor.value) return
  editor.value = undo(editor.value)
}

function redoEdit(): void {
  if (!editor.value) return
  editor.value = redo(editor.value)
}

function clearSelectionEdit(): void {
  if (!editor.value) return
  editor.value = clearSelection(editor.value)
}

function updateSingleLayer(update: (element: Element) => Element): void {
  const state = editor.value
  const layer = singleLayer.value
  if (!state || !layer) return
  editor.value = updateLayer(state, layer.id, update)
}

function setLayerText(value: string): void {
  updateSingleLayer((element) =>
    element.kind === 'text'
      ? {
          ...element,
          runs: [{ text: value, bold: false, italic: false, underline: false, color: null }],
        }
      : element,
  )
}

function setLayerFontSize(raw: string): void {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return
  updateSingleLayer((element) =>
    element.kind === 'text'
      ? { ...element, style: { ...element.style, fontSize: value } }
      : element,
  )
}

function setLayerColor(value: string): void {
  if (!value) return
  updateSingleLayer((element) =>
    element.kind === 'text'
      ? { ...element, style: { ...element.style, color: value } }
      : element,
  )
}

function setShapeColor(value: string): void {
  if (!value) return
  updateSingleLayer((element) =>
    element.kind === 'shape' ? { ...element, fill: { kind: 'solid', color: value } } : element,
  )
}

function setShapeRadius(raw: string): void {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return
  updateSingleLayer((element) => (element.kind === 'shape' ? { ...element, radius: value } : element))
}

function frameValue(key: 'x' | 'y' | 'w' | 'h'): string {
  return singleLayer.value ? String(singleLayer.value.frame[key]) : ''
}

function setFrameField(key: 'x' | 'y' | 'w' | 'h', raw: string): void {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  const minimum = key === 'w' || key === 'h' ? 0.01 : 0
  const clamped = Math.min(1, Math.max(minimum, value))
  updateSingleLayer((element) => ({ ...element, frame: { ...element.frame, [key]: clamped } }))
}

function layerLabel(layer: Element): string {
  if (layer.kind === 'text') {
    const text = layer.runs.map((run) => run.text).join(' ').trim()
    return text || 'Text'
  }
  if (layer.kind === 'shape') return 'Shape'
  if (layer.kind === 'image') return 'Image'
  return 'Video'
}

function layerIcon(layer: Element): string {
  if (layer.kind === 'text') return 'lucide:type'
  if (layer.kind === 'shape') return 'lucide:square'
  if (layer.kind === 'image') return 'lucide:image'
  return 'lucide:video'
}

function textLines(layer: TextElement): string[] {
  return layer.runs.map((run) => run.text).join('\n').split('\n')
}

function layerStyle(layer: Element): Record<string, string> {
  return {
    left: `${(layer.frame.x * 100).toFixed(3)}%`,
    top: `${(layer.frame.y * 100).toFixed(3)}%`,
    width: `${(layer.frame.w * 100).toFixed(3)}%`,
    height: `${(layer.frame.h * 100).toFixed(3)}%`,
    transform: layer.frame.rotation ? `rotate(${layer.frame.rotation}deg)` : 'none',
    opacity: String(layer.opacity),
    zIndex: String(layer.z + 1),
  }
}

function textLayerStyle(layer: TextElement): Record<string, string> {
  return {
    color: layer.style.color,
    fontSize: `${((layer.style.fontSize / 1920) * 100).toFixed(3)}cqw`,
    fontWeight: String(layer.style.weight),
    fontStyle: layer.style.italic ? 'italic' : 'normal',
    lineHeight: String(layer.style.lineHeight),
    letterSpacing: `${((layer.style.letterSpacing / 1920) * 100).toFixed(3)}cqw`,
    textAlign: layer.style.align,
    justifyContent:
      layer.layout.vAlign === 'top'
        ? 'flex-start'
        : layer.layout.vAlign === 'bottom'
          ? 'flex-end'
          : 'center',
  }
}

function shapeLayerStyle(layer: ShapeElement): Record<string, string> {
  const fill = layer.fill
  const background =
    fill.kind === 'solid'
      ? fill.color
      : fill.kind === 'linear'
        ? `linear-gradient(${fill.angle}deg, ${fill.stops
            .map((stop) => `${stop.color} ${(stop.at * 100).toFixed(1)}%`)
            .join(', ')})`
        : 'transparent'
  return {
    background,
    borderRadius: `${((layer.radius / 1920) * 100).toFixed(3)}cqw`,
    borderWidth: `${((layer.strokeWidth / 1920) * 100).toFixed(3)}cqw`,
    borderStyle: layer.stroke ? 'solid' : 'none',
    borderColor: layer.stroke?.kind === 'solid' ? layer.stroke.color : 'transparent',
  }
}

function slideLine(index: number): string {
  const slide = presentationSlides.value[index]
  return slide ? slideText(slide) || 'Empty' : ''
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function onKeydown(event: KeyboardEvent): void {
  if (isSong.value || !editor.value) return
  const mod = event.metaKey || event.ctrlKey
  const typing = isTypingTarget(event.target)
  const key = event.key.toLowerCase()

  if (mod && key === 'z' && !typing) {
    event.preventDefault()
    if (event.shiftKey) redoEdit()
    else undoEdit()
    return
  }
  if (typing) return
  if (mod && key === 'c') {
    event.preventDefault()
    copySelection()
    return
  }
  if (mod && key === 'v') {
    event.preventDefault()
    pasteClipboard()
    return
  }
  if (mod && key === 'd') {
    event.preventDefault()
    duplicateSelection()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
    return
  }
  if (event.key === 'Escape') clearSelectionEdit()
}

function back(): void {
  void router.push('/')
}

async function present(): Promise<void> {
  if (dirty.value) await save()
  if (error.value) return
  await router.push({ path: '/live', query: { presentation: id.value } })
}

onMounted(() => {
  void load()
  void loadThemes()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const root = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: '0', bg: 'bg.app' })
const toolbar = css({ display: 'flex', alignItems: 'center', gap: '2', h: 'toolbar', px: '4', flexShrink: '0', borderBottomWidth: '1px', borderColor: 'border.default', bg: 'bg.panel' })
const titleInput = css({ w: '[min(420px,40vw)]' })
const spacer = css({ flex: '1' })
const status = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const body = css({ display: 'flex', flex: '1', minH: '0' })
const rail = css({ w: '[220px]', flexShrink: '0', bg: 'bg.panel', borderRightWidth: '1px', borderColor: 'border.default', display: 'flex', flexDirection: 'column', minH: '0' })
const railHead = css({ p: '3', borderBottomWidth: '1px', borderColor: 'border.default', display: 'flex', alignItems: 'center', gap: '2' })
const railTitle = css({ flex: '1', textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase' })
const railList = css({ flex: '1', minH: '0', overflowY: 'auto', p: '2', display: 'flex', flexDirection: 'column', gap: '1' })
const slideButton = css({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '2',
  p: '2',
  borderRadius: 'sm',
  textAlign: 'left',
  color: 'fg.muted',
  borderWidth: '1px',
  borderColor: 'transparent',
  _hover: { bg: 'bg.hover', color: 'fg.default' },
})
const slideActive = css({ bg: 'bg.subtle', color: 'fg.default', borderColor: 'accent.default' })
const slideIndex = css({ textStyle: 'ui.mono', fontSize: '[11px]', color: 'fg.subtle', flexShrink: '0' })
const slidePreview = css({ minW: '0', flex: '1' })
const slideLabel = css({ textStyle: 'ui.xs', color: 'fg.subtle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const slideLineStyle = css({ textStyle: 'ui.xs', color: 'fg.muted', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const stage = css({ flex: '1', minW: '0', minH: '0', display: 'grid', placeItems: 'center', p: '8', overflow: 'auto' })
const slide = css({
  position: 'relative',
  w: 'full',
  maxW: '[1100px]',
  aspectRatio: 'video',
  borderRadius: 'md',
  overflow: 'hidden',
  borderWidth: '1px',
  borderColor: 'border.default',
  containerType: '[inline-size]',
  background: '[token(gradients.graphite)]',
})
const songPage = css({ display: 'grid', placeItems: 'center', h: 'full', p: '10', textAlign: 'center' })
const slideTextStyle = css({ display: 'flex', flexDirection: 'column', gap: '2', fontSize: '[clamp(20px,2.4vw,42px)]', fontWeight: 'semibold', lineHeight: '[1.15]', color: 'ink.0', textShadow: '[0_2px_18px_rgba(0,0,0,0.5)]' })
const layerBox = css({ position: 'absolute', minW: '0', minH: '0' })
const layerSelected = css({ boxShadow: '[0_0_0_2px_token(colors.accent.default)]' })
const textLayerBox = css({ display: 'flex', flexDirection: 'column', w: 'full', h: 'full', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })
const shapeLayerBox = css({ w: 'full', h: 'full' })
const mediaPlaceholder = css({ display: 'grid', placeItems: 'center', w: 'full', h: 'full', color: 'fg.subtle', textStyle: 'ui.xs', borderWidth: '1px', borderStyle: 'dashed', borderColor: 'border.default' })
const emptyStage = css({ display: 'grid', placeItems: 'center', h: 'full', textStyle: 'ui.sm', color: 'fg.muted' })
const inspector = css({ w: '[320px]', flexShrink: '0', bg: 'bg.panel', borderLeftWidth: '1px', borderColor: 'border.default', p: '4', overflowY: 'auto' })
const sectionTitle = css({ textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase', mb: '2', mt: '4', _first: { mt: '0' } })
const field = css({ display: 'flex', flexDirection: 'column', gap: '1.5', mb: '3' })
const fieldLabel = css({ textStyle: 'ui.xs', color: 'fg.muted' })
const row = css({ display: 'flex', alignItems: 'center', gap: '2', mb: '2' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle', lineHeight: 'normal' })
const empty = css({ display: 'grid', placeItems: 'center', h: 'full', p: '6', textStyle: 'ui.sm', color: 'fg.muted' })
const layerList = css({ display: 'flex', flexDirection: 'column', gap: '1', mb: '2' })
const layerRow = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  p: '1.5',
  w: 'full',
  borderRadius: 'sm',
  textAlign: 'left',
  color: 'fg.muted',
  borderWidth: '1px',
  borderColor: 'transparent',
  _hover: { bg: 'bg.hover', color: 'fg.default' },
})
const layerRowActive = css({ bg: 'bg.subtle', color: 'fg.default', borderColor: 'accent.default' })
const layerIconStyle = css({ flexShrink: '0', color: 'fg.subtle' })
const layerName = css({ flex: '1', minW: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textStyle: 'ui.xs' })
const layerKind = css({ textStyle: 'ui.xs', fontSize: '[9px]', color: 'fg.subtle', textTransform: 'uppercase' })
const frameGrid = css({ display: 'grid', gridTemplateColumns: '[repeat(2,minmax(0,1fr))]', gap: '2' })
</script>

<template>
  <div :class="root">
    <div :class="toolbar">
      <IconButton icon="lucide:arrow-left" label="Back to library" @click="back" />
      <Input v-model="titleDraft" :class="titleInput" size="sm" live aria-label="Presentation title" />
      <span :class="status">{{ savedLabel }}</span>
      <span :class="spacer" />
      <IconButton icon="lucide:undo-2" label="Undo" :disabled="!canUndoNow" @click="undoEdit" />
      <IconButton icon="lucide:redo-2" label="Redo" :disabled="!canRedoNow" @click="redoEdit" />
      <span :class="status">{{ isSong ? 'Song' : 'Presentation' }}</span>
      <Button variant="secondary" size="sm" icon="lucide:play" :disabled="saving" @click="present">Present</Button>
      <Button variant="primary" size="sm" icon="lucide:save" :disabled="!dirty || saving" @click="save">Save</Button>
    </div>

    <div v-if="loading" :class="empty">Loading…</div>
    <div v-else-if="error" :class="empty">{{ error }}</div>

    <div v-else-if="record" :class="body">
      <aside :class="rail" aria-label="Slides">
        <div :class="railHead">
          <span :class="railTitle">{{ slideCount }} slides</span>
          <IconButton v-if="!isSong" icon="lucide:plus" label="Add slide" size="sm" @click="addSlide" />
        </div>
        <div :class="railList">
          <button
            v-for="index in slideCount"
            :key="index"
            type="button"
            :class="[slideButton, index - 1 === activeSlideIndex ? slideActive : '']"
            @click="selectSlide(index - 1)"
          >
            <span :class="slideIndex">{{ String(index).padStart(2, '0') }}</span>
            <span :class="slidePreview">
              <span :class="slideLabel">{{
                isSong ? (songSlides[index - 1]?.sectionLabel ?? 'Slide') : `Slide ${index}`
              }}</span>
              <span :class="slideLineStyle">{{
                isSong ? (songSlides[index - 1]?.lines[0] ?? 'Empty') : slideLine(index - 1)
              }}</span>
            </span>
          </button>
        </div>
      </aside>

      <section :class="stage" aria-label="Slide preview">
        <div :class="slide">
          <div v-if="isSong" :class="songPage">
            <div :class="slideTextStyle">
              <span v-for="(line, index) in previewLines" :key="index">{{ line }}</span>
            </div>
          </div>
          <template v-else>
            <div v-if="previewLayers.length === 0" :class="emptyStage">No layers on this slide</div>
            <div
              v-for="layer in previewLayers"
              :key="layer.id"
              :class="[layerBox, isLayerSelected(layer.id) ? layerSelected : '']"
              :style="layerStyle(layer)"
            >
              <div v-if="layer.kind === 'text'" :class="textLayerBox" :style="textLayerStyle(layer)">
                <span v-for="(line, index) in textLines(layer)" :key="index">{{ line }}</span>
              </div>
              <div v-else-if="layer.kind === 'shape'" :class="shapeLayerBox" :style="shapeLayerStyle(layer)" />
              <div v-else :class="mediaPlaceholder">{{ layer.kind }}</div>
            </div>
          </template>
        </div>
      </section>

      <aside :class="inspector" aria-label="Editor inspector">
        <template v-if="isSong">
          <h2 :class="sectionTitle">Song details</h2>
          <div :class="field">
            <span :class="fieldLabel">Author</span>
            <Input v-model="song.author" size="sm" live aria-label="Song author" />
          </div>
          <div :class="row">
            <div :class="field">
              <span :class="fieldLabel">CCLI</span>
              <Input v-model="song.ccli" size="sm" live aria-label="CCLI number" />
            </div>
            <div :class="field">
              <span :class="fieldLabel">Key</span>
              <Input v-model="song.key" size="sm" live aria-label="Song key" />
            </div>
          </div>
          <div :class="field">
            <span :class="fieldLabel">Tempo</span>
            <Input v-model="tempoText" size="sm" live placeholder="BPM" aria-label="Song tempo" />
          </div>

          <h2 :class="sectionTitle">Lyrics</h2>
          <div :class="field">
            <Textarea
              :model-value="song.lyrics"
              live
              :min-rows="14"
              :max-rows="30"
              placeholder="[Verse 1]&#10;Amazing grace how sweet the sound"
              aria-label="Song lyrics"
              @update:model-value="setSongText"
            />
            <span :class="hint">Use [Section] markers. Slides split at 4 lines or 42 characters.</span>
          </div>
        </template>

        <template v-else>
          <h2 :class="sectionTitle">Slide text</h2>
          <div :class="field">
            <Textarea
              :model-value="currentText"
              live
              :min-rows="6"
              :max-rows="18"
              aria-label="Slide text"
              @update:model-value="updateSlideText"
            />
            <div :class="row">
              <Button variant="ghost" size="sm" icon="lucide:chevron-up" @click="stepSlide(activeSlideIndex, -1)">Up</Button>
              <Button variant="ghost" size="sm" icon="lucide:chevron-down" @click="stepSlide(activeSlideIndex, 1)">Down</Button>
              <span :class="spacer" />
              <Button variant="ghost" size="sm" icon="lucide:trash-2" @click="removeSlide(activeSlideIndex)">Delete</Button>
            </div>
          </div>

          <h2 :class="sectionTitle">Layers</h2>
          <div :class="row">
            <Button variant="ghost" size="sm" icon="lucide:type" @click="addTextLayer">Text</Button>
            <Button variant="ghost" size="sm" icon="lucide:square" @click="addShapeLayer">Shape</Button>
          </div>
          <div :class="layerList" role="listbox" aria-label="Layers" aria-multiselectable="true">
            <button
              v-for="layer in orderedLayers"
              :key="layer.id"
              type="button"
              role="option"
              :aria-selected="isLayerSelected(layer.id)"
              :class="[layerRow, isLayerSelected(layer.id) ? layerRowActive : '']"
              @click="selectLayerRow(layer.id, $event)"
            >
              <Icon :name="layerIcon(layer)" :class="layerIconStyle" />
              <span :class="layerName">{{ layerLabel(layer) }}</span>
              <span :class="layerKind">{{ layer.kind }}</span>
            </button>
            <p v-if="orderedLayers.length === 0" :class="hint">No layers on this slide.</p>
          </div>
          <div :class="row">
            <IconButton icon="lucide:chevron-up" label="Bring forward" size="sm" :disabled="!hasSelection" @click="moveSelection(1)" />
            <IconButton icon="lucide:chevron-down" label="Send backward" size="sm" :disabled="!hasSelection" @click="moveSelection(-1)" />
            <IconButton icon="lucide:copy" label="Duplicate" size="sm" :disabled="!hasSelection" @click="duplicateSelection" />
            <IconButton icon="lucide:clipboard" label="Copy" size="sm" :disabled="!hasSelection" @click="copySelection" />
            <IconButton icon="lucide:clipboard-paste" label="Paste" size="sm" :disabled="!canPaste" @click="pasteClipboard" />
            <span :class="spacer" />
            <IconButton icon="lucide:trash-2" label="Delete layer" size="sm" :disabled="!hasSelection" @click="deleteSelection" />
          </div>

          <template v-if="singleTextLayer">
            <h2 :class="sectionTitle">Text layer</h2>
            <div :class="field">
              <span :class="fieldLabel">Content</span>
              <Textarea
                :model-value="singleTextValue"
                live
                :min-rows="4"
                :max-rows="12"
                aria-label="Layer text"
                @update:model-value="setLayerText"
              />
            </div>
            <div :class="row">
              <div :class="field">
                <span :class="fieldLabel">Size</span>
                <Input
                  :model-value="String(singleTextLayer.style.fontSize)"
                  live
                  aria-label="Font size"
                  @update:model-value="setLayerFontSize"
                />
              </div>
              <div :class="field">
                <span :class="fieldLabel">Color</span>
                <ColorField
                  :model-value="singleTextLayer.style.color"
                  aria-label="Text color"
                  @update:model-value="setLayerColor"
                />
              </div>
            </div>
          </template>
          <template v-else-if="singleShapeLayer">
            <h2 :class="sectionTitle">Shape layer</h2>
            <div :class="row">
              <div :class="field">
                <span :class="fieldLabel">Fill</span>
                <ColorField
                  :model-value="singleShapeLayer.fill.kind === 'solid' ? singleShapeLayer.fill.color : '#6366f1'"
                  aria-label="Shape fill"
                  @update:model-value="setShapeColor"
                />
              </div>
              <div :class="field">
                <span :class="fieldLabel">Radius</span>
                <Input
                  :model-value="String(singleShapeLayer.radius)"
                  live
                  aria-label="Shape radius"
                  @update:model-value="setShapeRadius"
                />
              </div>
            </div>
          </template>
          <p v-else-if="selectedLayers.length > 1" :class="hint">
            {{ selectedLayers.length }} layers selected
          </p>

          <template v-if="singleLayer">
            <h2 :class="sectionTitle">Frame</h2>
            <div :class="frameGrid">
              <div v-for="axis in frameFields" :key="axis.key" :class="field">
                <span :class="fieldLabel">{{ axis.label }}</span>
                <Input
                  :model-value="frameValue(axis.key)"
                  live
                  :aria-label="axis.label"
                  @update:model-value="setFrameField(axis.key, $event)"
                />
              </div>
            </div>
          </template>
        </template>

        <h2 :class="sectionTitle">Theme</h2>
        <div :class="field">
          <Select v-model="themeId" :options="themeOptions" aria-label="Presentation theme" />
          <span :class="hint">Applied to every slide when you save.</span>
        </div>

        <h2 :class="sectionTitle">Slide</h2>
        <p :class="hint">{{ currentLabel }} · {{ slideCount }} total</p>
      </aside>
    </div>
  </div>
</template>
