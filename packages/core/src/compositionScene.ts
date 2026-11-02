import type {
  Composition,
  Frame,
  Layer,
  LayoutText,
  Scene,
  SceneAsset,
  SceneLayer,
  Screen,
  SlideElement,
  SlideSource,
  Source,
} from '@lumen/schema'
import { createComposition, createLayer } from './composition'
import { paintToCss } from './scene'
import { createScreen, frameInRegion, layoutIncludesLayer, regionSize, resolveLayoutText } from './screen'

/**
 * Adapters between render contract v2 (`Composition` + `Screen`) and the v1
 * `Scene` the current renderer draws. See docs/architecture/02-render-contract.md
 * § Migration. Blend modes, effects, masks, shader and capture sources and
 * mapping have no v1 form and are skipped.
 */

export interface CompositionSceneContext {
  /** Scene revision; defaults to the composition revision. */
  revision?: number
}

const LAYER_Z_STEP = 100
const BLACK = '#000000'

/** Output-space frames for re-laid-out text, per preset. */
const TEXT_PRESET_FRAMES = {
  lowerThird: { x: 0.06, y: 0.74, w: 0.88, h: 0.2, rotation: 0 },
  strip: { x: 0.02, y: 0.88, w: 0.96, h: 0.1, rotation: 0 },
} as const

function fullFrame(): Frame {
  return { x: 0, y: 0, w: 1, h: 1, rotation: 0 }
}

function screenBackground(color: string): SceneLayer {
  return {
    kind: 'shape',
    id: 'screen-background',
    frame: fullFrame(),
    z: -1000,
    opacity: 1,
    fill: color,
    stroke: null,
    strokeWidth: 0,
    radius: 0,
  }
}

function layerFrame(layer: Layer): Frame {
  const { x, y, w, h, rotation } = layer.transform
  return { x, y, w, h, rotation }
}

/** Places a slide-space frame inside the layer's box on the canvas. */
function frameInLayer(frame: Frame, box: Frame): Frame {
  return {
    x: box.x + frame.x * box.w,
    y: box.y + frame.y * box.h,
    w: frame.w * box.w,
    h: frame.h * box.h,
    rotation: frame.rotation + box.rotation,
  }
}

function gradientFill(source: Extract<Source, { kind: 'gradient' }>): string {
  if (source.gradient === 'linear') {
    return paintToCss({ kind: 'linear', angle: source.angle, stops: source.stops })
  }
  // The v1 renderer has no radial gradient; use the centre colour.
  return source.stops[0]?.color ?? BLACK
}

function restyleText(
  element: Extract<SlideElement, { kind: 'text' }>,
  text: LayoutText,
  fontScale: number,
): Extract<SceneLayer, { kind: 'text' }> {
  const base = { ...element, fontSize: element.fontSize * fontScale * text.scale }
  const colored = text.color ? { ...base, color: text.color, runs: base.runs.map((run) => ({ ...run, color: null })) } : base
  switch (text.preset) {
    case 'lowerThird':
      return { ...colored, frame: { ...TEXT_PRESET_FRAMES.lowerThird }, fontSize: Math.max(18, colored.fontSize * 0.55), maxLines: 2 }
    case 'strip':
      return { ...colored, frame: { ...TEXT_PRESET_FRAMES.strip }, fontSize: Math.max(14, colored.fontSize * 0.4), maxLines: 1 }
    default:
      return colored
  }
}

function slideLayers(
  layer: Layer,
  source: SlideSource,
  composition: Composition,
  screen: Screen,
  opacity: number,
  z: number,
): SceneLayer[] {
  const text = resolveLayoutText(screen.layout)
  const box = layerFrame(layer)
  // Slide pixels map onto the layer's box on the canvas.
  const fontScale = (box.h * composition.canvas.height) / source.size.height
  const ordered = source.elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
  const out: SceneLayer[] = []
  ordered.forEach(({ element }, index) => {
    const id = `${layer.id}.${element.id}`
    const frame = frameInRegion(frameInLayer(element.frame, box), screen.layout.region)
    const common = { id, z: z + index, opacity: element.opacity * opacity }
    if (element.kind === 'text') {
      if (text.preset === 'hidden') return
      const scaled = restyleText({ ...element, frame }, text, fontScale)
      out.push({ ...scaled, ...common, padding: scaled.padding * fontScale })
      return
    }
    out.push({ ...element, ...common, frame })
  })
  return out
}

function sourceLayers(
  layer: Layer,
  source: Source,
  composition: Composition,
  screen: Screen,
  opacity: number,
  z: number,
): SceneLayer[] {
  const frame = frameInRegion(layerFrame(layer), screen.layout.region)
  const base = { id: layer.id, frame, z, opacity }
  switch (source.kind) {
    case 'video':
      return [
        {
          ...base,
          kind: 'video',
          source: source.asset,
          fit: layer.fit,
          loop: source.loop,
          muted: source.muted,
          volume: source.volume,
          startMs: source.inMs,
        },
      ]
    case 'image':
      return [{ ...base, kind: 'image', source: source.asset, fit: layer.fit, radius: 0 }]
    case 'solid':
      return [{ ...base, kind: 'shape', fill: source.color, stroke: null, strokeWidth: 0, radius: 0 }]
    case 'gradient':
      return [{ ...base, kind: 'shape', fill: gradientFill(source), stroke: null, strokeWidth: 0, radius: 0 }]
    case 'slide':
      return slideLayers(layer, source, composition, screen, opacity, z)
    case 'shader':
    case 'ndi':
    case 'camera':
      return []
  }
}

function assetIdsOf(layers: SceneLayer[]): Set<string> {
  const ids = new Set<string>()
  for (const layer of layers) {
    if (layer.kind === 'image' || layer.kind === 'video') ids.add(layer.source.assetId)
  }
  return ids
}

/**
 * The v1 scene one screen shows: its layers from the composition, bottom to
 * top, cropped to its region and over its background (black when unset).
 * Test patterns are the caller's job; blackout returns a black frame.
 */
export function compositionToScene(
  composition: Composition,
  screen: Screen,
  context: CompositionSceneContext = {},
): Scene {
  const layout = screen.layout
  const sources = new Map(composition.sources.map((source) => [source.id, source]))
  const layers: SceneLayer[] = []
  if (!screen.blackout) {
    composition.layers.forEach((layer, index) => {
      if (!layer.enabled || layer.sourceId === null || !layoutIncludesLayer(layout, layer)) return
      const opacity = layer.opacity * composition.master.opacity
      if (opacity <= 0) return
      const source = sources.get(layer.sourceId)
      if (!source) return
      layers.push(...sourceLayers(layer, source, composition, screen, opacity, (index + 1) * LAYER_Z_STEP))
    })
  }
  const used = assetIdsOf(layers)
  const assets: SceneAsset[] = composition.assets.filter((asset) => used.has(asset.id))
  return {
    schemaVersion: 1,
    revision: context.revision ?? composition.revision,
    role: screen.role,
    viewport: { ...regionSize(composition.canvas, layout.region), scale: 1 },
    colorSpace: 'srgb',
    background: screenBackground(screen.blackout ? BLACK : layout.background ?? BLACK),
    layers,
    fonts: composition.fonts,
    assets,
    safeArea: { ...layout.safeArea },
  }
}

// --- v1 → v2 -----------------------------------------------------------------

export interface SceneToCompositionOptions {
  /** Tag for the layer that holds the slide content: `content` or `lyrics` for songs. */
  contentTag?: string
}

export interface SceneComposition {
  composition: Composition
  /** Default screen from the scene role: audience (also for preview) or stage. */
  screen: Screen
}

function isSlideElement(layer: SceneLayer): layer is SlideElement {
  return layer.kind === 'text' || layer.kind === 'shape' || layer.kind === 'image'
}

/** Source for a v1 background or video layer; slide-only kinds return null. */
function sourceForLayer(layer: SceneLayer, id: string): Source | null {
  switch (layer.kind) {
    case 'shape':
      return { id, name: '', kind: 'solid', color: layer.fill }
    case 'image':
      return { id, name: '', kind: 'image', asset: layer.source }
    case 'video':
      return {
        id,
        name: '',
        kind: 'video',
        asset: layer.source,
        loop: layer.loop,
        inMs: layer.startMs,
        outMs: null,
        rate: 1,
        reverse: false,
        muted: layer.muted,
        volume: layer.volume,
      }
    case 'text':
      return null
  }
}

function fitOf(layer: SceneLayer): Layer['fit'] {
  return layer.kind === 'image' || layer.kind === 'video' ? layer.fit : 'stretch'
}

/**
 * Converts a v1 scene: the background becomes layer 0 with a solid, image or
 * video source; slide layers become one `slide` source on a layer tagged
 * `content` (or `options.contentTag`). Video layers keep their own source.
 */
export function sceneToComposition(scene: Scene, options: SceneToCompositionOptions = {}): SceneComposition {
  const canvas = { width: scene.viewport.width, height: scene.viewport.height }
  const composition = createComposition(canvas)
  composition.revision = scene.revision
  composition.fonts = [...scene.fonts]
  composition.assets = [...scene.assets]
  const elements: SlideElement[] = []

  const background = scene.background
  if (background) {
    const source = sourceForLayer(background, 'source-background')
    if (source) {
      composition.sources.push(source)
      composition.layers.push(
        createLayer({
          id: 'layer-background',
          name: 'Background',
          sourceId: source.id,
          transform: background.frame,
          fit: fitOf(background),
          opacity: background.opacity,
          tags: ['background'],
        }),
      )
    } else if (isSlideElement(background)) {
      elements.push(background)
    }
  }

  const ordered = [...scene.layers].sort((a, b) => a.z - b.z)
  for (const layer of ordered) {
    if (isSlideElement(layer)) {
      elements.push(layer)
      continue
    }
    const source = sourceForLayer(layer, `source-${layer.id}`)
    if (!source) continue
    composition.sources.push(source)
    composition.layers.push(
      createLayer({
        id: `layer-${layer.id}`,
        name: 'Video',
        sourceId: source.id,
        transform: layer.frame,
        fit: fitOf(layer),
        opacity: layer.opacity,
      }),
    )
  }

  if (elements.length > 0) {
    const tag = options.contentTag ?? 'content'
    composition.sources.push({
      id: 'source-content',
      name: '',
      kind: 'slide',
      revision: scene.revision,
      elements,
      safeArea: { ...scene.safeArea },
      size: canvas,
    })
    composition.layers.push(
      createLayer({ id: 'layer-content', name: tag === 'lyrics' ? 'Lyrics' : 'Content', sourceId: 'source-content', tags: [tag] }),
    )
  }

  const stage = scene.role === 'stage'
  const screen = createScreen({
    name: stage ? 'Stage' : 'Audience',
    role: stage ? 'stage' : 'audience',
    size: canvas,
    layout: { safeArea: { ...scene.safeArea } },
  })
  return { composition, screen }
}
