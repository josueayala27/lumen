import { compositionToScene, createScreen, type ShowResolveContext } from '@lumen/core'
import type { Composition, Scene, SceneLayer, Screen, Theme } from '@lumen/schema'
import { blackScene, sceneForSlide } from '~/live/liveScene'
import type { DisplayInfo } from '~/output/api'

/**
 * Studio glue for the v2 show document. The model itself (composition,
 * screens, clip grid, live state, migration) is pure and lives in
 * `@lumen/core` (`packages/core/src/show.ts`); this module adds what needs the
 * studio: the browser schematic scene and monitor lookup.
 */

export {
  SHOW_COLUMNS,
  activeClips,
  assignClip,
  clearLayer,
  clipAt,
  createShowDoc,
  emptyLive,
  launchClip,
  launchColumn,
  liveComposition,
  parseShowDoc,
  removeShowClip,
  stepLyrics,
  toggleScreenLayer,
  updateScreen,
  updateScreenLayout,
  withComposition,
  type ShowLive,
} from '@lumen/core'
export type { ClipContent, ShowClip, ShowDoc, Screen, TextPreset } from '@lumen/schema'

/** Data the composer needs from the libraries. */
export interface ComposeContext extends ShowResolveContext {
  revision: number
}

const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1, rotation: 0 }

/**
 * Colour bars, a centre cross and the screen name, as a v1 scene for the
 * browser schematic. The desktop app draws test patterns in Rust from the
 * screen's `testPattern` field.
 */
export function testPatternScene(screen: Screen, context: { theme: Theme | null; revision: number }): Scene {
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

/**
 * The v1 scene the browser fallback draws as a schematic for one screen (or
 * the bare canvas when `screen` is null). The desktop app renders the
 * composition through the compositor instead; this is the only studio use of
 * the v1 adapter outside the preload path.
 */
export function schematicScene(
  composition: Composition,
  screen: Screen | null,
  context: { theme: Theme | null; revision?: number } = { theme: null },
): Scene {
  const target = screen ?? createScreen({ id: 'canvas', name: 'Canvas', size: composition.canvas })
  if (target.testPattern) return testPatternScene(target, { theme: context.theme, revision: context.revision ?? composition.revision })
  return compositionToScene(composition, target, { revision: context.revision })
}

/** The connected monitor a screen targets: exact name and position first, then name. */
export function displayForScreen(displays: readonly DisplayInfo[], screen: Screen): DisplayInfo | null {
  if (screen.target.kind !== 'display') return null
  const ref = screen.target.ref
  return (
    displays.find((display) => display.name === ref.name && display.x === ref.x && display.y === ref.y) ??
    displays.find((display) => display.name === ref.name) ??
    null
  )
}
