import { isMacPlatform, matchesShortcut } from '~/ui'

/** What a key press does to the stage window. */
export type StageWindowAction = 'close' | 'toggle-fullscreen' | 'exit-fullscreen'

/**
 * Stage window keys: Mod+W closes, F or Mod+Ctrl+F toggles fullscreen, Escape
 * leaves fullscreen. Escape never closes, so a stray key press cannot take the
 * performers' display away.
 */
export function stageKeyAction(event: KeyboardEvent, fullscreen: boolean, mac: boolean = isMacPlatform()): StageWindowAction | null {
  if (matchesShortcut(event, 'Mod+W', mac)) return 'close'
  if (matchesShortcut(event, 'F', mac) || matchesShortcut(event, 'Mod+Ctrl+F', mac)) return 'toggle-fullscreen'
  if (fullscreen && matchesShortcut(event, 'Escape', mac)) return 'exit-fullscreen'
  return null
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Closes the stage window: the native window in the desktop app, the popup in a browser. */
export async function closeStageWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
    return
  }
  window.close()
}

/** Sets fullscreen on the stage window and returns the new state. */
export async function setStageFullscreen(on: boolean): Promise<boolean> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setFullscreen(on)
    return on
  }
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen()
  if (!on && document.fullscreenElement) await document.exitFullscreen()
  return on
}
