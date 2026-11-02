import type { ShowResolveContext } from '@lumen/core'
import type { Screen } from '@lumen/schema'
import type { DisplayInfo } from '~/output/api'

/**
 * Studio glue for the v2 show document. The model itself (composition,
 * screens, clip grid, live state, migration) is pure and lives in
 * `@lumen/core` (`packages/core/src/show.ts`); this module adds what needs the
 * studio: monitor lookup. The browser schematic is in `schematic.ts`.
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
