import {
  defaultEffectParams,
  type Composition,
  type Effect,
  type EffectKind,
  type Layer,
  type LayerTransform,
  type Mask,
  type Size,
  type Source,
} from '@lumen/schema'
import { newId } from './presentation'
import { DEFAULT_CANVAS } from './screen'

/**
 * Pure composition edits. None of them bump `revision`; the caller that
 * commits the change does (see `touchComposition`).
 */

export const FULL_TRANSFORM: LayerTransform = { x: 0, y: 0, w: 1, h: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 }

export function createComposition(canvas: Size = DEFAULT_CANVAS): Composition {
  return {
    schemaVersion: 2,
    revision: 0,
    canvas: { ...canvas },
    colorSpace: 'srgb',
    sources: [],
    layers: [],
    master: { opacity: 1, effects: [] },
    fonts: [],
    assets: [],
  }
}

/** Raises the revision so the renderer diffs the change. */
export function touchComposition(composition: Composition, revision = composition.revision + 1): Composition {
  return { ...composition, revision }
}

export interface LayerInput extends Partial<Omit<Layer, 'transform'>> {
  transform?: Partial<LayerTransform>
}

export function createLayer(input: LayerInput = {}): Layer {
  return {
    id: input.id ?? newId('layer'),
    name: input.name ?? 'Layer',
    sourceId: input.sourceId ?? null,
    enabled: input.enabled ?? true,
    transform: { ...FULL_TRANSFORM, ...input.transform },
    fit: input.fit ?? 'cover',
    opacity: clamp01(input.opacity ?? 1),
    blend: input.blend ?? 'normal',
    effects: input.effects ?? [],
    mask: input.mask ?? null,
    tags: input.tags ?? [],
  }
}

export function createEffect(kind: EffectKind, id = newId('effect')): Effect {
  return { id, kind, enabled: true, params: defaultEffectParams(kind) }
}

// --- Layers ------------------------------------------------------------------

/** Adds a layer on top, or at `index` (0 is the bottom). */
export function addCompositionLayer(composition: Composition, layer: Layer = createLayer(), index?: number): Composition {
  const layers = [...composition.layers]
  layers.splice(index === undefined ? layers.length : clampIndex(index, layers.length), 0, layer)
  return { ...composition, layers }
}

export function removeCompositionLayer(composition: Composition, layerId: string): Composition {
  return { ...composition, layers: composition.layers.filter((layer) => layer.id !== layerId) }
}

/** Moves a layer to `index` in the bottom-to-top stack. */
export function moveCompositionLayer(composition: Composition, layerId: string, index: number): Composition {
  const from = composition.layers.findIndex((layer) => layer.id === layerId)
  if (from < 0) return composition
  const layers = [...composition.layers]
  const [layer] = layers.splice(from, 1)
  layers.splice(clampIndex(index, layers.length), 0, layer!)
  return { ...composition, layers }
}

export type LayerPatch = Partial<Omit<Layer, 'id' | 'transform'>> & { transform?: Partial<LayerTransform> }

export function updateCompositionLayer(composition: Composition, layerId: string, patch: LayerPatch): Composition {
  return mapLayer(composition, layerId, (layer) => ({
    ...layer,
    ...patch,
    transform: patch.transform ? { ...layer.transform, ...patch.transform } : layer.transform,
    opacity: patch.opacity === undefined ? layer.opacity : clamp01(patch.opacity),
  }))
}

/** Points a layer at a source in the composition, or at nothing. */
export function setLayerSource(composition: Composition, layerId: string, sourceId: string | null): Composition {
  if (sourceId !== null && !composition.sources.some((source) => source.id === sourceId)) return composition
  return mapLayer(composition, layerId, (layer) => ({ ...layer, sourceId }))
}

export function setLayerMask(composition: Composition, layerId: string, mask: Mask | null): Composition {
  return mapLayer(composition, layerId, (layer) => ({ ...layer, mask }))
}

// --- Effects -----------------------------------------------------------------

export function addLayerEffect(composition: Composition, layerId: string, effect: Effect): Composition {
  return mapLayer(composition, layerId, (layer) => ({ ...layer, effects: [...layer.effects, effect] }))
}

export function updateLayerEffect(
  composition: Composition,
  layerId: string,
  effectId: string,
  patch: Partial<Omit<Effect, 'id' | 'kind'>>,
): Composition {
  return mapLayer(composition, layerId, (layer) => ({
    ...layer,
    effects: layer.effects.map((effect) =>
      effect.id === effectId
        ? { ...effect, ...patch, params: patch.params ? { ...effect.params, ...patch.params } : effect.params }
        : effect,
    ),
  }))
}

export function removeLayerEffect(composition: Composition, layerId: string, effectId: string): Composition {
  return mapLayer(composition, layerId, (layer) => ({
    ...layer,
    effects: layer.effects.filter((effect) => effect.id !== effectId),
  }))
}

export function moveLayerEffect(composition: Composition, layerId: string, effectId: string, index: number): Composition {
  return mapLayer(composition, layerId, (layer) => {
    const from = layer.effects.findIndex((effect) => effect.id === effectId)
    if (from < 0) return layer
    const effects = [...layer.effects]
    const [effect] = effects.splice(from, 1)
    effects.splice(clampIndex(index, effects.length), 0, effect!)
    return { ...layer, effects }
  })
}

// --- Sources -----------------------------------------------------------------

/** Adds a source, replacing one with the same id. */
export function addSource(composition: Composition, source: Source): Composition {
  const exists = composition.sources.some((entry) => entry.id === source.id)
  return {
    ...composition,
    sources: exists
      ? composition.sources.map((entry) => (entry.id === source.id ? source : entry))
      : [...composition.sources, source],
  }
}

/** Patches a source; the kind cannot change. */
export function updateSource(composition: Composition, sourceId: string, patch: Partial<Source>): Composition {
  return {
    ...composition,
    sources: composition.sources.map((source) =>
      source.id === sourceId ? ({ ...source, ...patch, id: source.id, kind: source.kind } as Source) : source,
    ),
  }
}

/** Removes a source and clears every layer that used it. */
export function removeSource(composition: Composition, sourceId: string): Composition {
  return {
    ...composition,
    sources: composition.sources.filter((source) => source.id !== sourceId),
    layers: composition.layers.map((layer) => (layer.sourceId === sourceId ? { ...layer, sourceId: null } : layer)),
  }
}

export function sourceById(composition: Composition, sourceId: string | null): Source | null {
  if (sourceId === null) return null
  return composition.sources.find((source) => source.id === sourceId) ?? null
}

// --- Master ------------------------------------------------------------------

export function setMasterOpacity(composition: Composition, opacity: number): Composition {
  return { ...composition, master: { ...composition.master, opacity: clamp01(opacity) } }
}

// --- Helpers -----------------------------------------------------------------

function mapLayer(composition: Composition, layerId: string, update: (layer: Layer) => Layer): Composition {
  let changed = false
  const layers = composition.layers.map((layer) => {
    if (layer.id !== layerId) return layer
    changed = true
    return update(layer)
  })
  return changed ? { ...composition, layers } : composition
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(0, Math.round(index)), length)
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
}
