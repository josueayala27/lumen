import { newId } from '@lumen/core'
import type { PresentationDoc, Scene, SceneLayer, Theme } from '@lumen/schema'
import {
  DEFAULT_SCENE_SIZE,
  blackScene,
  sceneAssetFor,
  sceneForSlide,
  type MediaAssetLike,
} from '~/live/liveScene'

/**
 * A show is a clip grid (layers × columns) plus the screens it plays on.
 * Layers stack bottom to top. Each screen has a layout: which layers it shows
 * and how lyrics appear on it. This is the first cut of the live-visuals model
 * in `docs/architecture/07-roadmap.md`; it renders through the current scene
 * contract.
 */

export type ClipSource =
  | { kind: 'media'; assetId: string }
  | { kind: 'lyrics'; presentationId: string }

export interface ShowLayer {
  id: string
  name: string
  /** 0..1, multiplied into every clip on the layer. */
  opacity: number
}

export interface ShowClip {
  id: string
  layerId: string
  column: number
  label: string
  source: ClipSource
  loop: boolean
}

export type LyricsStyle = 'full' | 'lowerThird' | 'hidden'

export interface ShowScreen {
  id: string
  name: string
  /** Display index the screen opens on, or null while unassigned. */
  displayIndex: number | null
  /** Layer ids this screen shows. */
  layerIds: string[]
  lyrics: LyricsStyle
  testPattern: boolean
}

export interface ShowDoc {
  schemaVersion: 1
  id: string
  name: string
  columns: number
  layers: ShowLayer[]
  clips: ShowClip[]
  screens: ShowScreen[]
}

/** What is playing right now. Not persisted with the show document. */
export interface ShowLive {
  /** Active clip per layer id. */
  active: Record<string, string | null>
  /** Current slide per lyrics clip id. */
  slides: Record<string, number>
}

export const SHOW_COLUMNS = 8

export function defaultShow(): ShowDoc {
  const background: ShowLayer = { id: newId('layer'), name: 'Background', opacity: 1 }
  const visuals: ShowLayer = { id: newId('layer'), name: 'Visuals', opacity: 1 }
  const lyrics: ShowLayer = { id: newId('layer'), name: 'Lyrics', opacity: 1 }
  const all = [background.id, visuals.id, lyrics.id]
  return {
    schemaVersion: 1,
    id: newId('show'),
    name: 'My show',
    columns: SHOW_COLUMNS,
    layers: [background, visuals, lyrics],
    clips: [],
    screens: [
      { id: newId('screen'), name: 'Main', displayIndex: null, layerIds: all, lyrics: 'full', testPattern: false },
      { id: newId('screen'), name: 'LED wall', displayIndex: null, layerIds: [background.id, visuals.id], lyrics: 'hidden', testPattern: false },
      { id: newId('screen'), name: 'Side screens', displayIndex: null, layerIds: all, lyrics: 'lowerThird', testPattern: false },
    ],
  }
}

export function emptyLive(): ShowLive {
  return { active: {}, slides: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Accepts a stored show; returns null for anything that is not one. */
export function normalizeShow(value: unknown): ShowDoc | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== 'string') return null
  if (!Array.isArray(value.layers) || !Array.isArray(value.clips) || !Array.isArray(value.screens)) return null
  const layers = value.layers.filter(
    (layer): layer is ShowLayer => isRecord(layer) && typeof layer.id === 'string' && typeof layer.name === 'string',
  )
  const layerIds = new Set(layers.map((layer) => layer.id))
  return {
    schemaVersion: 1,
    id: value.id,
    name: typeof value.name === 'string' && value.name ? value.name : 'My show',
    columns: typeof value.columns === 'number' && value.columns > 0 ? Math.min(32, Math.round(value.columns)) : SHOW_COLUMNS,
    layers: layers.map((layer) => ({ ...layer, opacity: clamp01(Number(layer.opacity ?? 1)) })),
    clips: value.clips.filter(
      (clip): clip is ShowClip =>
        isRecord(clip) &&
        typeof clip.id === 'string' &&
        typeof clip.layerId === 'string' &&
        layerIds.has(clip.layerId) &&
        typeof clip.column === 'number' &&
        isRecord(clip.source),
    ),
    screens: value.screens
      .filter((screen): screen is ShowScreen => isRecord(screen) && typeof screen.id === 'string')
      .map((screen) => ({
        ...screen,
        layerIds: Array.isArray(screen.layerIds) ? screen.layerIds.filter((id) => layerIds.has(id)) : [],
        lyrics: screen.lyrics === 'lowerThird' || screen.lyrics === 'hidden' ? screen.lyrics : 'full',
        testPattern: Boolean(screen.testPattern),
        displayIndex: typeof screen.displayIndex === 'number' ? screen.displayIndex : null,
      })),
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
}

export function clipAt(show: ShowDoc, layerId: string, column: number): ShowClip | null {
  return show.clips.find((clip) => clip.layerId === layerId && clip.column === column) ?? null
}

/** Puts a source in a cell, replacing whatever was there. */
export function assignClip(show: ShowDoc, layerId: string, column: number, source: ClipSource, label: string): ShowDoc {
  const clips = show.clips.filter((clip) => !(clip.layerId === layerId && clip.column === column))
  clips.push({ id: newId('clip'), layerId, column, label, source, loop: true })
  return { ...show, clips }
}

export function removeClip(show: ShowDoc, clipId: string): ShowDoc {
  return { ...show, clips: show.clips.filter((clip) => clip.id !== clipId) }
}

export function setLayerOpacity(show: ShowDoc, layerId: string, opacity: number): ShowDoc {
  return {
    ...show,
    layers: show.layers.map((layer) => (layer.id === layerId ? { ...layer, opacity: clamp01(opacity) } : layer)),
  }
}

export function updateScreen(show: ShowDoc, screenId: string, patch: Partial<Omit<ShowScreen, 'id'>>): ShowDoc {
  return {
    ...show,
    screens: show.screens.map((screen) => (screen.id === screenId ? { ...screen, ...patch } : screen)),
  }
}

/** Launches a clip on its layer; launching the playing clip again keeps it. */
export function launchClip(live: ShowLive, clip: ShowClip): ShowLive {
  const slides = clip.source.kind === 'lyrics' && live.active[clip.layerId] !== clip.id
    ? { ...live.slides, [clip.id]: 0 }
    : live.slides
  return { active: { ...live.active, [clip.layerId]: clip.id }, slides }
}

/** Launches every clip in a column; layers with no clip there keep playing. */
export function launchColumn(show: ShowDoc, live: ShowLive, column: number): ShowLive {
  return show.clips
    .filter((clip) => clip.column === column)
    .reduce((next, clip) => launchClip(next, clip), live)
}

export function clearLayer(live: ShowLive, layerId: string): ShowLive {
  return { ...live, active: { ...live.active, [layerId]: null } }
}

/** Moves the lyrics clip on a layer to another slide, clamped to the document. */
export function stepLyrics(live: ShowLive, clipId: string, delta: number, slideCount: number): ShowLive {
  const current = live.slides[clipId] ?? 0
  const next = Math.min(Math.max(0, current + delta), Math.max(0, slideCount - 1))
  return { ...live, slides: { ...live.slides, [clipId]: next } }
}

export function activeClips(show: ShowDoc, live: ShowLive): ShowClip[] {
  return show.layers
    .map((layer) => show.clips.find((clip) => clip.id === live.active[layer.id]) ?? null)
    .filter((clip): clip is ShowClip => clip !== null)
}

/** Data the composer needs from the libraries. */
export interface ComposeContext {
  media: MediaAssetLike[]
  presentation: (id: string) => PresentationDoc | null
  theme: Theme | null
  revision: number
}

const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1, rotation: 0 }
const LOWER_THIRD = { x: 0.06, y: 0.74, w: 0.88, h: 0.2, rotation: 0 }
const LAYER_Z_STEP = 100

function mediaLayer(clip: ShowClip, asset: MediaAssetLike, opacity: number, z: number): SceneLayer | null {
  const base = {
    id: `show-${clip.id}`,
    frame: FULL_FRAME,
    z,
    opacity,
    source: { assetId: asset.id, hash: asset.sha256 },
    fit: 'cover' as const,
  }
  if (asset.kind === 'video') {
    return { ...base, kind: 'video', loop: clip.loop, muted: true, volume: 1, startMs: 0 }
  }
  if (asset.kind === 'image') return { ...base, kind: 'image', radius: 0 }
  return null
}

/** Text layers of a lyrics slide, restyled for the screen. */
function lyricsLayers(
  clip: ShowClip,
  doc: PresentationDoc,
  slideIndex: number,
  style: LyricsStyle,
  opacity: number,
  z: number,
  context: ComposeContext,
): SceneLayer[] {
  if (style === 'hidden' || doc.slides.length === 0) return []
  const scene = sceneForSlide({ doc, slideIndex, label: '' }, context.theme, [], context.revision)
  return scene.layers
    .filter((layer) => layer.kind === 'text')
    .map((layer, index) => {
      if (layer.kind !== 'text') return layer
      const restyled =
        style === 'lowerThird'
          ? { ...layer, frame: LOWER_THIRD, fontSize: Math.max(18, layer.fontSize * 0.55), maxLines: 2 }
          : layer
      return { ...restyled, id: `show-${clip.id}-${index}`, z: z + index, opacity: layer.opacity * opacity }
    })
}

/** Colour bars, a centre cross and the screen name for lining up projectors. */
export function testPatternScene(screen: ShowScreen, context: ComposeContext): Scene {
  const label = sceneForSlide({ doc: null, slideIndex: 0, label: screen.name }, context.theme, [], context.revision)
  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000']
  const shape = (id: string, frame: typeof FULL_FRAME, fill: string, z: number): SceneLayer => ({
    kind: 'shape',
    id,
    frame,
    z,
    opacity: 1,
    fill,
    stroke: null,
    strokeWidth: 0,
    radius: 0,
  })
  const layers: SceneLayer[] = bars.map((fill, index) =>
    shape(`pattern-bar-${index}`, { x: index / bars.length, y: 0, w: 1 / bars.length, h: 1, rotation: 0 }, fill, 0),
  )
  layers.push(shape('pattern-h', { x: 0, y: 0.4995, w: 1, h: 0.001, rotation: 0 }, '#808080', 10))
  layers.push(shape('pattern-v', { x: 0.4995, y: 0, w: 0.001, h: 1, rotation: 0 }, '#808080', 10))
  layers.push(shape('pattern-plate', { x: 0.3, y: 0.42, w: 0.4, h: 0.16, rotation: 0 }, '#000000', 20))
  for (const layer of label.layers) {
    if (layer.kind === 'text') {
      layers.push({ ...layer, id: `pattern-label-${layer.id}`, frame: { x: 0.3, y: 0.42, w: 0.4, h: 0.16, rotation: 0 }, z: 30 })
    }
  }
  return { ...blackScene(context.revision), layers, background: null, fonts: label.fonts }
}

/** The scene one screen shows: its layers, bottom to top, over black. */
export function composeScreenScene(show: ShowDoc, live: ShowLive, screen: ShowScreen, context: ComposeContext): Scene {
  if (screen.testPattern) return testPatternScene(screen, context)
  const scene = blackScene(context.revision)
  const layers: SceneLayer[] = []
  const assets = new Map<string, NonNullable<ReturnType<typeof sceneAssetFor>>>()
  show.layers.forEach((layer, index) => {
    if (!screen.layerIds.includes(layer.id) || layer.opacity <= 0) return
    const clip = show.clips.find((entry) => entry.id === live.active[layer.id])
    if (!clip) return
    const z = (index + 1) * LAYER_Z_STEP
    if (clip.source.kind === 'media') {
      const { assetId } = clip.source
      const asset = context.media.find((entry) => entry.id === assetId)
      if (!asset || asset.missing) return
      const sceneLayer = mediaLayer(clip, asset, layer.opacity, z)
      const sceneAsset = sceneAssetFor(asset)
      if (!sceneLayer || !sceneAsset) return
      layers.push(sceneLayer)
      assets.set(sceneAsset.id, sceneAsset)
      return
    }
    const doc = context.presentation(clip.source.presentationId)
    if (!doc) return
    layers.push(...lyricsLayers(clip, doc, live.slides[clip.id] ?? 0, screen.lyrics, layer.opacity, z, context))
  })
  return { ...scene, viewport: { ...DEFAULT_SCENE_SIZE, scale: 1 }, layers, assets: [...assets.values()] }
}
