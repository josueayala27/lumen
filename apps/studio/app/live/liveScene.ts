import { buildScene, textSlide } from '@lumen/core'
import type {
  OutputMode,
  PresentationDoc,
  Scene,
  SceneAsset,
  SceneLayer,
  Slide,
  Theme,
  Transition,
  TransitionPlan,
} from '@lumen/schema'

/** Minimal media row shape needed to resolve scene assets. */
export interface MediaAssetLike {
  id: string
  kind: string
  sha256: string
  width: number | null
  height: number | null
  localPath: string
  missing: boolean
}

/** A slide addressed by its live position, with the source document when it has one. */
export interface SceneSlideSource {
  doc: PresentationDoc | null
  slideIndex: number
  label: string
}

export const DEFAULT_SCENE_SIZE = { width: 1920, height: 1080 }
export const DEFAULT_TRANSITION: Transition = {
  kind: 'fade',
  durationMs: 300,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
}
const DEFAULT_SAFE_AREA = 0.05
const BLACK = '#000000'

let revisionCounter = 0

/** Monotonic revision shared by every scene sent to an output. */
export function sceneRevision(): number {
  revisionCounter += 1
  return revisionCounter
}

function viewportFor(doc: PresentationDoc): { width: number; height: number; scale: number } {
  return {
    width: doc.settings.width,
    height: doc.settings.height,
    scale: 1,
  }
}

/** Asset ids referenced by a document's backgrounds and media layers. */
export function collectAssetIds(doc: PresentationDoc | null): string[] {
  if (!doc) return []
  const ids = new Set<string>()
  for (const slide of doc.slides) {
    const background = slide.background
    if (background.kind === 'image' || background.kind === 'video') {
      ids.add(background.source.assetId)
    }
    for (const element of slide.elements) {
      if (element.kind === 'image' || element.kind === 'video') {
        ids.add(element.source.assetId)
      }
    }
  }
  return [...ids]
}

function sceneAssetFor(media: MediaAssetLike): SceneAsset | null {
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

/** Resolves the media rows a document references into scene assets. */
export function assetsForDoc(doc: PresentationDoc | null, media: MediaAssetLike[]): SceneAsset[] {
  if (!doc) return []
  const ids = new Set(collectAssetIds(doc))
  return media
    .filter((asset) => ids.has(asset.id))
    .map(sceneAssetFor)
    .filter((asset): asset is SceneAsset => asset !== null)
}

function placeholderDoc(label: string): PresentationDoc {
  return {
    schemaVersion: 1,
    kind: 'presentation',
    title: label,
    themeId: null,
    settings: { aspectRatio: '16:9', ...DEFAULT_SCENE_SIZE, safeArea: DEFAULT_SAFE_AREA },
    slides: [{ ...textSlide(label, null, 'placeholder-slide'), background: { kind: 'transparent' } }],
    song: null,
  }
}

/**
 * Builds the audience scene for a live position. Items without a document (media
 * and headers) fall back to a themed title card so the output never goes stale.
 */
export function sceneForSlide(
  source: SceneSlideSource,
  theme: Theme | null,
  media: MediaAssetLike[],
  revision: number,
): Scene {
  const doc = source.doc
  if (doc) {
    const index = Math.min(Math.max(0, source.slideIndex), doc.slides.length - 1)
    return buildScene(doc, theme, index, viewportFor(doc), {
      assets: assetsForDoc(doc, media),
      fonts: [],
      revision,
      role: 'audience',
    })
  }
  const label = source.label.trim() || 'No slide'
  const placeholder = placeholderDoc(label)
  return buildScene(placeholder, theme, 0, viewportFor(placeholder), {
    assets: [],
    fonts: [],
    revision,
    role: 'audience',
  })
}

function blackLayer(): SceneLayer {
  return {
    kind: 'shape',
    id: 'mode-background',
    frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
    z: -1000,
    opacity: 1,
    fill: BLACK,
    stroke: null,
    strokeWidth: 0,
    radius: 0,
  }
}

function modeSceneBase(revision: number, background: SceneLayer | null): Scene {
  return {
    schemaVersion: 1,
    revision,
    role: 'audience',
    viewport: { ...DEFAULT_SCENE_SIZE, scale: 1 },
    colorSpace: 'srgb',
    background,
    layers: [],
    fonts: [],
    assets: [],
    safeArea: {
      top: DEFAULT_SAFE_AREA,
      right: DEFAULT_SAFE_AREA,
      bottom: DEFAULT_SAFE_AREA,
      left: DEFAULT_SAFE_AREA,
    },
  }
}

/** Black output: an opaque black frame with no slide layers. */
export function blackScene(revision: number): Scene {
  return modeSceneBase(revision, blackLayer())
}

/** Clear output: transparent/background only, per the live engine contract. */
export function clearScene(revision: number): Scene {
  return modeSceneBase(revision, null)
}

/**
 * Logo output has no logo asset yet, so it falls back to the black frame instead
 * of showing the previous slide.
 */
export function logoScene(revision: number): Scene {
  return blackScene(revision)
}

/** Scene for a non-live mode; `live` and `freeze` keep the current frame instead. */
export function modeScene(mode: OutputMode, revision: number): Scene | null {
  switch (mode) {
    case 'black':
      return blackScene(revision)
    case 'clear':
      return clearScene(revision)
    case 'logo':
      return logoScene(revision)
    case 'live':
    case 'freeze':
      return null
  }
}

/** Slide transition first, then the theme transition, then the product default. */
export function effectiveTransition(slide: Slide | null, theme: Theme | null): Transition {
  return slide?.transition ?? theme?.transition ?? DEFAULT_TRANSITION
}

export function isCut(transition: Transition): boolean {
  return transition.kind === 'cut' || transition.durationMs === 0
}

export function transitionPlan(
  from: Scene,
  to: Scene,
  transition: Transition,
): TransitionPlan {
  return {
    fromRevision: from.revision,
    toRevision: to.revision,
    from,
    to,
    kind: transition.kind,
    durationMs: transition.durationMs,
    easing: transition.easing,
  }
}
