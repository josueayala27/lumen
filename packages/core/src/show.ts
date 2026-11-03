import {
  MAX_SHOW_COLUMNS,
  showDocSchema,
  type ClipContent,
  type Composition,
  type Layout,
  type Mapping,
  type PresentationDoc,
  type CompositionAsset,
  type Screen,
  type ScreenRef,
  type ShowClip,
  type ShowDoc,
  type Source,
  type TextPreset,
  type Theme,
} from '@lumen/schema'
import {
  addCompositionLayer,
  createComposition,
  createLayer,
  moveCompositionLayer,
  removeCompositionLayer,
  type LayerInput,
} from './composition'
import { withCompositionFonts } from './fonts'
import { newId } from './presentation'
import { presentationSlideSource, slideBackgroundMode } from './slide'
import { createScreen, displayTarget, rebaseMesh } from './screen'

/**
 * Show document v2: a composition, its screens and a clip grid
 * (composition layers × columns). Every function here is pure.
 */

export const SHOW_COLUMNS = 8

export function createShowDoc(): ShowDoc {
  const background = createLayer({ name: 'Background', tags: ['background'] })
  const visuals = createLayer({ name: 'Visuals', tags: ['visuals'] })
  const lyrics = createLayer({ name: 'Lyrics', tags: ['lyrics'] })
  const composition = { ...createComposition(), layers: [background, visuals, lyrics] }
  return {
    schemaVersion: 2,
    id: newId('show'),
    name: 'My show',
    composition,
    screens: [
      createScreen({ name: 'Main' }),
      createScreen({
        name: 'LED wall',
        layout: { layers: { mode: 'only', ids: [background.id, visuals.id], tags: [] }, text: { preset: 'hidden', scale: 1, color: null } },
      }),
      createScreen({ name: 'Side screens', layout: { text: { preset: 'lowerThird', scale: 1, color: null } } }),
    ],
    grid: { columns: SHOW_COLUMNS, clips: [] },
  }
}

/** Applies a composition edit to the show. */
export function withComposition(show: ShowDoc, update: (composition: Composition) => Composition): ShowDoc {
  const composition = update(show.composition)
  return composition === show.composition ? show : { ...show, composition }
}

// --- Layers ------------------------------------------------------------------

export function addShowLayer(show: ShowDoc, input: LayerInput = {}, index?: number): ShowDoc {
  return withComposition(show, (composition) => addCompositionLayer(composition, createLayer(input), index))
}

/** Removes a layer, its clips and every layout reference to it. */
export function removeShowLayer(show: ShowDoc, layerId: string): ShowDoc {
  return {
    ...show,
    composition: removeCompositionLayer(show.composition, layerId),
    grid: { ...show.grid, clips: show.grid.clips.filter((clip) => clip.layerId !== layerId) },
    screens: show.screens.map((screen) => {
      const filter = screen.layout.layers
      if (filter.mode === 'all' || !filter.ids.includes(layerId)) return screen
      return {
        ...screen,
        layout: { ...screen.layout, layers: { ...filter, ids: filter.ids.filter((id) => id !== layerId) } },
      }
    }),
  }
}

export function moveShowLayer(show: ShowDoc, layerId: string, index: number): ShowDoc {
  return withComposition(show, (composition) => moveCompositionLayer(composition, layerId, index))
}

// --- Screens -----------------------------------------------------------------

export function addScreen(show: ShowDoc, screen: Screen = createScreen({ name: `Screen ${show.screens.length + 1}` })): ShowDoc {
  return { ...show, screens: [...show.screens, screen] }
}

export function removeScreen(show: ShowDoc, screenId: string): ShowDoc {
  return { ...show, screens: show.screens.filter((screen) => screen.id !== screenId) }
}

export type ScreenPatch = Partial<Omit<Screen, 'id' | 'layout' | 'mapping'>>

export function updateScreen(show: ShowDoc, screenId: string, patch: ScreenPatch): ShowDoc {
  return mapScreen(show, screenId, (screen) => ({ ...screen, ...patch }))
}

export function updateScreenLayout(show: ShowDoc, screenId: string, patch: Partial<Layout>): ShowDoc {
  return mapScreen(show, screenId, (screen) => ({ ...screen, layout: { ...screen.layout, ...patch } }))
}

/**
 * Patches a screen's mapping. A corner-pin change without a mesh in the same
 * patch carries an existing mesh along (`rebaseMesh`): the renderer draws the
 * mesh instead of the pin, so a stale mesh would hide every pin edit.
 */
export function updateScreenMapping(show: ShowDoc, screenId: string, patch: Partial<Mapping>): ShowDoc {
  return mapScreen(show, screenId, (screen) => {
    const mapping = { ...screen.mapping, ...patch }
    const current = screen.mapping
    if ('cornerPin' in patch && !('mesh' in patch) && current.mesh) {
      mapping.mesh = rebaseMesh(current.mesh, current.cornerPin, patch.cornerPin ?? null)
    }
    return { ...screen, mapping }
  })
}

export function moveScreen(show: ShowDoc, screenId: string, index: number): ShowDoc {
  const from = show.screens.findIndex((screen) => screen.id === screenId)
  if (from < 0) return show
  const screens = [...show.screens]
  const [screen] = screens.splice(from, 1)
  screens.splice(Math.min(Math.max(0, index), screens.length), 0, screen!)
  return { ...show, screens }
}

/**
 * Turns one layer on or off for a screen, keeping the composition order. A
 * screen that shows every layer switches to an explicit id list.
 */
export function toggleScreenLayer(show: ShowDoc, screenId: string, layerId: string, on: boolean): ShowDoc {
  return mapScreen(show, screenId, (screen) => {
    const filter = screen.layout.layers
    const current = new Set(
      filter.mode === 'all'
        ? show.composition.layers.map((layer) => layer.id)
        : show.composition.layers.filter((layer) => filter.ids.includes(layer.id) || layer.tags.some((tag) => filter.tags.includes(tag))).map((layer) => layer.id),
    )
    if (on) current.add(layerId)
    else current.delete(layerId)
    const ids = show.composition.layers.map((layer) => layer.id).filter((id) => current.has(id))
    return { ...screen, layout: { ...screen.layout, layers: { mode: 'only', ids, tags: [] } } }
  })
}

function mapScreen(show: ShowDoc, screenId: string, update: (screen: Screen) => Screen): ShowDoc {
  return { ...show, screens: show.screens.map((screen) => (screen.id === screenId ? update(screen) : screen)) }
}

// --- Clip grid ---------------------------------------------------------------

export function clipAt(show: ShowDoc, layerId: string, column: number): ShowClip | null {
  return show.grid.clips.find((clip) => clip.layerId === layerId && clip.column === column) ?? null
}

/** Puts content in a cell, replacing whatever was there. */
export function assignClip(show: ShowDoc, layerId: string, column: number, content: ClipContent, label: string): ShowDoc {
  const clips = show.grid.clips.filter((clip) => !(clip.layerId === layerId && clip.column === column))
  clips.push({ id: newId('clip'), layerId, column, label, content })
  return { ...show, grid: { ...show.grid, clips } }
}

export function removeShowClip(show: ShowDoc, clipId: string): ShowDoc {
  return { ...show, grid: { ...show.grid, clips: show.grid.clips.filter((clip) => clip.id !== clipId) } }
}

/** Moves a clip to another cell; a clip already there is replaced. */
export function moveShowClip(show: ShowDoc, clipId: string, layerId: string, column: number): ShowDoc {
  const clip = show.grid.clips.find((entry) => entry.id === clipId)
  if (!clip) return show
  const clips = show.grid.clips
    .filter((entry) => entry.id !== clipId && !(entry.layerId === layerId && entry.column === column))
    .concat({ ...clip, layerId, column })
  return { ...show, grid: { ...show.grid, clips } }
}

export function updateShowClip(show: ShowDoc, clipId: string, patch: Partial<Pick<ShowClip, 'label' | 'content'>>): ShowDoc {
  return {
    ...show,
    grid: { ...show.grid, clips: show.grid.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)) },
  }
}

/** Sets the column count; clips past the last column are dropped. */
export function setGridColumns(show: ShowDoc, columns: number): ShowDoc {
  const count = Math.min(MAX_SHOW_COLUMNS, Math.max(1, Math.round(columns)))
  return { ...show, grid: { columns: count, clips: show.grid.clips.filter((clip) => clip.column < count) } }
}

// --- Live state --------------------------------------------------------------

/** What is playing right now. Not persisted with the show document. */
export interface ShowLive {
  /** Active clip per layer id. */
  active: Record<string, string | null>
  /** Current slide per presentation clip id. */
  slides: Record<string, number>
}

export function emptyLive(): ShowLive {
  return { active: {}, slides: {} }
}

/** Launches a clip on its layer; launching the playing clip again keeps its slide. */
export function launchClip(live: ShowLive, clip: ShowClip): ShowLive {
  const slides =
    clip.content.kind === 'presentation' && live.active[clip.layerId] !== clip.id
      ? { ...live.slides, [clip.id]: 0 }
      : live.slides
  return { active: { ...live.active, [clip.layerId]: clip.id }, slides }
}

/** Launches every clip in a column; layers with no clip there keep playing. */
export function launchColumn(show: ShowDoc, live: ShowLive, column: number): ShowLive {
  return show.grid.clips.filter((clip) => clip.column === column).reduce((next, clip) => launchClip(next, clip), live)
}

export function clearLayer(live: ShowLive, layerId: string): ShowLive {
  return { ...live, active: { ...live.active, [layerId]: null } }
}

/** Moves a presentation clip to another slide, clamped to the document. */
export function stepLyrics(live: ShowLive, clipId: string, delta: number, slideCount: number): ShowLive {
  const current = live.slides[clipId] ?? 0
  const next = Math.min(Math.max(0, current + delta), Math.max(0, slideCount - 1))
  return { ...live, slides: { ...live.slides, [clipId]: next } }
}

/** Playing clips, bottom to top. */
export function activeClips(show: ShowDoc, live: ShowLive): ShowClip[] {
  return show.composition.layers
    .map((layer) => show.grid.clips.find((clip) => clip.id === live.active[layer.id]) ?? null)
    .filter((clip): clip is ShowClip => clip !== null)
}

// --- Resolving clips into sources --------------------------------------------

/** Media library row shape needed to resolve clips. */
export interface ShowMediaLike {
  id: string
  kind: string
  sha256: string
  width: number | null
  height: number | null
  localPath: string
  missing: boolean
}

export interface ShowResolveContext {
  media: readonly ShowMediaLike[]
  presentation: (id: string) => PresentationDoc | null
  theme: Theme | null
}

/** A media library row as a composition asset; null for kinds a composition cannot draw. */
export function assetForMedia(media: ShowMediaLike): CompositionAsset | null {
  if (media.kind !== 'image' && media.kind !== 'video') return null
  return {
    id: media.id,
    hash: media.sha256,
    kind: media.kind,
    localPath: media.localPath,
    url: null,
    intrinsic: { width: media.width ?? 0, height: media.height ?? 0 },
    state: media.missing ? 'missing' : 'ready',
  }
}

/** Resolves a clip into a source; null when its media or document is missing. */
export function resolveClipSource(
  show: ShowDoc,
  clip: ShowClip,
  live: ShowLive,
  context: ShowResolveContext,
): Source | null {
  const id = `clip-${clip.id}`
  const content = clip.content
  switch (content.kind) {
    case 'source':
      return { ...content.source, id }
    case 'sourceRef':
      return show.composition.sources.find((source) => source.id === content.sourceId) ?? null
    case 'media': {
      const media = context.media.find((entry) => entry.id === content.assetId)
      if (!media || media.missing) return null
      const asset = { assetId: media.id, hash: media.sha256 }
      if (media.kind === 'image') return { id, name: clip.label, kind: 'image', asset }
      if (media.kind !== 'video') return null
      return {
        id,
        name: clip.label,
        kind: 'video',
        asset,
        loop: content.loop,
        inMs: 0,
        outMs: null,
        rate: 1,
        reverse: false,
        muted: true,
        volume: 1,
      }
    }
    case 'presentation': {
      const doc = context.presentation(content.presentationId)
      if (!doc) return null
      const slideIndex = live.slides[clip.id] ?? 0
      const layer = show.composition.layers.find((entry) => entry.id === clip.layerId)
      return presentationSlideSource(id, doc, slideIndex, context.theme, slideIndex, layer ? slideBackgroundMode(layer) : 'keep')
    }
  }
}

function sourceAssetIds(source: Source): string[] {
  switch (source.kind) {
    case 'video':
    case 'image':
      return [source.asset.assetId]
    case 'slide':
      return source.elements.flatMap((element) => (element.kind === 'image' ? [element.source.assetId] : []))
    default:
      return []
  }
}

/**
 * The composition as it plays: each layer with an active clip shows that
 * clip's source; layers without one keep their own source. Assets for every
 * used media file are filled in from the media library.
 */
export function liveComposition(show: ShowDoc, live: ShowLive, context: ShowResolveContext): Composition {
  const composition = show.composition
  const sources = [...composition.sources]
  const layers = composition.layers.map((layer) => {
    const clipId = live.active[layer.id]
    if (!clipId) return layer
    const clip = show.grid.clips.find((entry) => entry.id === clipId && entry.layerId === layer.id)
    if (!clip) return layer
    const source = resolveClipSource(show, clip, live, context)
    if (!source) return { ...layer, sourceId: null }
    if (!sources.some((entry) => entry.id === source.id)) sources.push(source)
    return { ...layer, sourceId: source.id }
  })
  const assets = [...composition.assets]
  const known = new Set(assets.map((asset) => asset.id))
  const used = new Set(
    layers.flatMap((layer) => {
      const source = sources.find((entry) => entry.id === layer.sourceId)
      return source ? sourceAssetIds(source) : []
    }),
  )
  for (const id of used) {
    if (known.has(id)) continue
    const media = context.media.find((entry) => entry.id === id)
    const asset = media ? assetForMedia(media) : null
    if (asset) assets.push(asset)
  }
  return withCompositionFonts({ ...composition, sources, layers, assets })
}

// --- Loading and migration ---------------------------------------------------

export interface ShowLoadOptions {
  /** Monitor for a v1 `displayIndex`, when the displays are known. */
  displayRef?: (index: number) => ScreenRef | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function opacityOf(value: unknown): number {
  const number = Number(value ?? 1)
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 1
}

/** Tags of the default layers (`createShowDoc`), by their v1 name. */
const DEFAULT_LAYER_TAGS: Record<string, string> = { background: 'background', visuals: 'visuals', lyrics: 'lyrics' }

/**
 * Tags for v1 layers, which had none. The default Background, Visuals and
 * Lyrics layers keep the tags a new show gives them, so rundown slides land
 * on Lyrics even when a presentation clip sat on another layer. Only when no
 * layer is named Lyrics does the topmost layer with presentation clips become
 * the `lyrics` layer.
 */
function migratedLayerTags(layers: readonly (Record<string, unknown> & { id: string })[], clips: readonly ShowClip[]): Map<string, string[]> {
  const tags = new Map<string, string[]>()
  for (const layer of layers) {
    const tag = typeof layer.name === 'string' ? DEFAULT_LAYER_TAGS[layer.name.trim().toLowerCase()] : undefined
    if (tag && ![...tags.values()].some((existing) => existing.includes(tag))) tags.set(layer.id, [tag])
  }
  if (![...tags.values()].some((existing) => existing.includes('lyrics'))) {
    const withSlides = new Set(clips.filter((clip) => clip.content.kind === 'presentation').map((clip) => clip.layerId))
    const top = [...layers].reverse().find((layer) => withSlides.has(layer.id))
    if (top) tags.set(top.id, [...(tags.get(top.id) ?? []), 'lyrics'])
  }
  return tags
}

/** Converts a stored v1 show (first clip grid). Returns null for anything else. */
export function migrateShowV1(value: unknown, options: ShowLoadOptions = {}): ShowDoc | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== 'string') return null
  if (!Array.isArray(value.layers) || !Array.isArray(value.clips) || !Array.isArray(value.screens)) return null

  const rawLayers = value.layers.filter(
    (layer): layer is Record<string, unknown> & { id: string } => isRecord(layer) && typeof layer.id === 'string' && typeof layer.name === 'string',
  )
  const layerIds = new Set(rawLayers.map((layer) => layer.id))
  const columns = typeof value.columns === 'number' && value.columns > 0 ? Math.min(MAX_SHOW_COLUMNS, Math.round(value.columns)) : SHOW_COLUMNS

  const clips: ShowClip[] = []
  for (const clip of value.clips) {
    if (!isRecord(clip) || typeof clip.id !== 'string' || typeof clip.layerId !== 'string') continue
    if (!layerIds.has(clip.layerId) || typeof clip.column !== 'number' || !isRecord(clip.source)) continue
    const column = Math.round(clip.column)
    if (column < 0 || column >= columns) continue
    const source = clip.source
    let content: ClipContent
    if (source.kind === 'media' && typeof source.assetId === 'string') {
      content = { kind: 'media', assetId: source.assetId, loop: clip.loop !== false }
    } else if (source.kind === 'lyrics' && typeof source.presentationId === 'string') {
      content = { kind: 'presentation', presentationId: source.presentationId }
    } else continue
    clips.push({ id: clip.id, layerId: clip.layerId, column, label: str(clip.label, ''), content })
  }

  const tags = migratedLayerTags(rawLayers, clips)
  const layers = rawLayers.map((layer) =>
    createLayer({
      id: layer.id,
      name: str(layer.name, 'Layer'),
      opacity: opacityOf(layer.opacity),
      tags: tags.get(layer.id) ?? [],
    }),
  )

  const screens: Screen[] = value.screens
    .filter((screen): screen is Record<string, unknown> & { id: string } => isRecord(screen) && typeof screen.id === 'string')
    .map((screen) => {
      const ids = Array.isArray(screen.layerIds)
        ? layers.map((layer) => layer.id).filter((id) => (screen.layerIds as unknown[]).includes(id))
        : []
      const all = ids.length === layers.length
      const preset: TextPreset = screen.lyrics === 'lowerThird' || screen.lyrics === 'hidden' ? screen.lyrics : 'full'
      const ref = typeof screen.displayIndex === 'number' ? options.displayRef?.(screen.displayIndex) ?? null : null
      const migrated = createScreen({
        id: screen.id,
        name: str(screen.name, 'Screen'),
        target: ref ? displayTarget(ref) : { kind: 'virtual' },
        layout: {
          layers: all ? { mode: 'all' } : { mode: 'only', ids, tags: [] },
          text: { preset, scale: 1, color: null },
        },
      })
      return { ...migrated, testPattern: screen.testPattern ? 'bars' : null }
    })

  return {
    schemaVersion: 2,
    id: value.id,
    name: str(value.name, 'My show'),
    composition: { ...createComposition(), layers },
    screens,
    grid: { columns, clips },
  }
}

/**
 * Accepts a stored show of any known version and returns a valid v2 show, or
 * null. Clips on unknown layers and layout ids for unknown layers are dropped.
 */
export function parseShowDoc(value: unknown, options: ShowLoadOptions = {}): ShowDoc | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion === 1) return migrateShowV1(value, options)
  const parsed = showDocSchema.safeParse(value)
  if (!parsed.success) return null
  const show = parsed.data
  const layerIds = new Set(show.composition.layers.map((layer) => layer.id))
  return {
    ...show,
    grid: {
      ...show.grid,
      clips: show.grid.clips.filter((clip) => layerIds.has(clip.layerId) && clip.column < show.grid.columns),
    },
    screens: show.screens.map((screen) => {
      const filter = screen.layout.layers
      if (filter.mode === 'all') return screen
      return { ...screen, layout: { ...screen.layout, layers: { ...filter, ids: filter.ids.filter((id) => layerIds.has(id)) } } }
    }),
  }
}
