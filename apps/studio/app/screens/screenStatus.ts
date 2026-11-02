import type { Screen } from '@lumen/schema'
import type { DisplayInfo, OutputWindow } from '~/output/api'
import { displayForScreen } from '~/show/showModel'

export type ScreenStatusKind = 'off' | 'virtual' | 'offline' | 'ready' | 'live'

export interface ScreenStatus {
  kind: ScreenStatusKind
  label: string
}

/**
 * Where a screen stands: disabled, virtual (preview only), its monitor is not
 * connected, connected with no output window, or showing on an open output.
 */
export function screenStatus(
  screen: Screen,
  displays: readonly DisplayInfo[],
  outputFor: (index: number) => OutputWindow | null | undefined,
): ScreenStatus {
  if (!screen.enabled) return { kind: 'off', label: 'Off' }
  if (screen.target.kind === 'virtual') return { kind: 'virtual', label: 'Virtual' }
  if (screen.target.kind === 'ndi') return { kind: 'offline', label: 'NDI' }
  const display = displayForScreen(displays, screen)
  if (!display) return { kind: 'offline', label: 'Offline' }
  return outputFor(display.index) ? { kind: 'live', label: 'Live' } : { kind: 'ready', label: 'Ready' }
}

/** Short description of a screen's target for the list and inspector. */
export function targetLabel(screen: Screen): string {
  switch (screen.target.kind) {
    case 'display':
      return screen.target.ref.name
    case 'ndi':
      return `NDI · ${screen.target.name}`
    default:
      return 'Virtual'
  }
}
