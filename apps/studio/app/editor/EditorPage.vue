<script setup lang="ts">
import {
  slideText,
  songFields,
  splitSongLyrics,
  updatePresentationDoc,
  updateSongDoc,
  type SongFields,
} from '@lumen/core'
import { css } from 'styled-system/css'
import { Icon } from '#components'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, IconButton, Input, Textarea } from '~/ui'
import {
  getPresentation,
  savePresentation,
  type PresentationRecord,
} from '~/data/presentations'

const route = useRoute()
const router = useRouter()
const id = computed(() => {
  const value = (route.params as { id?: string | string[] }).id
  return Array.isArray(value) ? (value[0] ?? '') : String(value ?? '')
})
const record = ref<PresentationRecord | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const savedAt = ref<number | null>(null)

const titleDraft = ref('')
const song = ref<SongFields>({ title: '', author: '', ccli: '', key: '', tempo: null, lyrics: '' })
const tempoText = ref('')
const slideTexts = ref<string[]>([])
const selected = ref(0)

const isSong = computed(() => record.value?.kind === 'song')
const songSlides = computed(() => splitSongLyrics(song.value.lyrics))
const slideCount = computed(() =>
  isSong.value ? Math.max(1, songSlides.value.length) : Math.max(1, slideTexts.value.length),
)
const currentText = computed(() => {
  if (isSong.value) return songSlides.value[selected.value]?.text ?? ''
  return slideTexts.value[selected.value] ?? ''
})
const currentLabel = computed(() => {
  if (isSong.value) return songSlides.value[selected.value]?.sectionLabel ?? 'Slide'
  return `Slide ${selected.value + 1}`
})
const previewLines = computed(() =>
  isSong.value
    ? songSlides.value[selected.value]?.lines ?? []
    : currentText.value.split('\n').filter((line) => line.length > 0),
)
const signature = computed(() =>
  JSON.stringify({
    title: titleDraft.value,
    song: song.value,
    tempo: tempoText.value,
    slides: slideTexts.value,
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
      slideTexts.value = []
    } else {
      slideTexts.value = found.doc.slides.map((slide) => slideText(slide))
    }
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
    const doc = isSong.value
      ? updateSongDoc(record.value.doc, {
          ...song.value,
          title: titleDraft.value,
          tempo: parseTempo(),
        })
      : updatePresentationDoc(record.value.doc, {
          title: titleDraft.value,
          slideTexts: slideTexts.value,
        })
    record.value = { ...record.value, doc, updatedAt: Date.now() }
    await savePresentation(record.value)
    savedAt.value = Date.now()
    baseline.value = signature.value
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    saving.value = false
  }
}

function addSlide(): void {
  slideTexts.value = [...slideTexts.value, 'New slide']
  selected.value = slideTexts.value.length - 1
}

function removeSlide(index: number): void {
  if (slideTexts.value.length <= 1) return
  slideTexts.value = slideTexts.value.filter((_, entry) => entry !== index)
  if (selected.value >= slideTexts.value.length) selected.value = slideTexts.value.length - 1
}

function stepSlide(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= slideTexts.value.length) return
  const next = [...slideTexts.value]
  const [entry] = next.splice(index, 1)
  if (entry === undefined) return
  next.splice(target, 0, entry)
  slideTexts.value = next
  selected.value = target
}

function updateSlideText(value: string): void {
  const next = [...slideTexts.value]
  next[selected.value] = value
  slideTexts.value = next
}

function setSongText(value: string): void {
  song.value = { ...song.value, lyrics: value }
}

function back(): void {
  void router.push('/')
}

async function present(): Promise<void> {
  if (dirty.value) await save()
  if (error.value) return
  await router.push({ path: '/live', query: { presentation: id.value } })
}

onMounted(load)

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
const slideLine = css({ textStyle: 'ui.xs', color: 'fg.muted', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
const stage = css({ flex: '1', minW: '0', minH: '0', display: 'grid', placeItems: 'center', p: '8', overflow: 'auto' })
const slide = css({ w: 'full', maxW: '[1100px]', aspectRatio: 'video', borderRadius: 'md', overflow: 'hidden', borderWidth: '1px', borderColor: 'border.default', display: 'grid', placeItems: 'center', p: '10', textAlign: 'center', background: '[token(gradients.graphite)]' })
const slideTextStyle = css({ display: 'flex', flexDirection: 'column', gap: '2', fontSize: '[clamp(20px,2.4vw,42px)]', fontWeight: 'semibold', lineHeight: '[1.15]', color: 'ink.0', textShadow: '[0_2px_18px_rgba(0,0,0,0.5)]' })
const inspector = css({ w: '[320px]', flexShrink: '0', bg: 'bg.panel', borderLeftWidth: '1px', borderColor: 'border.default', p: '4', overflowY: 'auto' })
const sectionTitle = css({ textStyle: 'ui.label', color: 'fg.subtle', textTransform: 'uppercase', mb: '2', mt: '4', _first: { mt: '0' } })
const field = css({ display: 'flex', flexDirection: 'column', gap: '1.5', mb: '3' })
const fieldLabel = css({ textStyle: 'ui.xs', color: 'fg.muted' })
const row = css({ display: 'flex', alignItems: 'center', gap: '2' })
const hint = css({ textStyle: 'ui.xs', color: 'fg.subtle', lineHeight: 'normal' })
const empty = css({ display: 'grid', placeItems: 'center', h: 'full', p: '6', textStyle: 'ui.sm', color: 'fg.muted' })
</script>

<template>
  <div :class="root">
    <div :class="toolbar">
      <IconButton icon="lucide:arrow-left" label="Back to library" @click="back" />
      <Input v-model="titleDraft" :class="titleInput" size="sm" live aria-label="Presentation title" />
      <span :class="status">{{ savedLabel }}</span>
      <span :class="spacer" />
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
            :class="[slideButton, index - 1 === selected ? slideActive : '']"
            @click="selected = index - 1"
          >
            <span :class="slideIndex">{{ String(index).padStart(2, '0') }}</span>
            <span :class="slidePreview">
              <span :class="slideLabel">{{
                isSong ? (songSlides[index - 1]?.sectionLabel ?? 'Slide') : `Slide ${index}`
              }}</span>
              <span :class="slideLine">{{
                isSong ? (songSlides[index - 1]?.lines[0] ?? 'Empty') : (slideTexts[index - 1] ?? '')
              }}</span>
            </span>
          </button>
        </div>
      </aside>

      <section :class="stage" aria-label="Slide preview">
        <div :class="slide">
          <div :class="slideTextStyle">
            <span v-for="(line, index) in previewLines" :key="index">{{ line }}</span>
          </div>
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
              :min-rows="10"
              :max-rows="24"
              aria-label="Slide text"
              @update:model-value="updateSlideText"
            />
            <div :class="row">
              <Button variant="ghost" size="sm" icon="lucide:chevron-up" @click="stepSlide(selected, -1)">Up</Button>
              <Button variant="ghost" size="sm" icon="lucide:chevron-down" @click="stepSlide(selected, 1)">Down</Button>
              <span :class="spacer" />
              <Button variant="ghost" size="sm" icon="lucide:trash-2" @click="removeSlide(selected)">Delete</Button>
            </div>
          </div>
        </template>

        <h2 :class="sectionTitle">Slide</h2>
        <p :class="hint">{{ currentLabel }} · {{ slideCount }} total</p>
      </aside>
    </div>
  </div>
</template>
