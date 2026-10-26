import type { DisplayInfo } from './api'

/** Tauri store file shared with MIDI bindings; screens live under their own key. */
export const SETTINGS_FILE = 'settings.json'
export const SCREENS_KEY = 'outputScreens'

/** Stable monitor identity: name plus position, per docs/architecture/05-desktop-output.md. */
export interface ScreenRef {
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface OutputSettings {
  audience: ScreenRef | null
}

export const EMPTY_SETTINGS: OutputSettings = { audience: null }

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function screenRef(display: DisplayInfo): ScreenRef {
  return {
    name: display.name,
    x: display.x,
    y: display.y,
    width: display.width,
    height: display.height,
  }
}

/** Keeps a valid audience screen and drops anything else. */
export function normalizeOutputSettings(value: unknown): OutputSettings {
  if (!value || typeof value !== 'object') return { ...EMPTY_SETTINGS }
  const raw = (value as { audience?: unknown }).audience
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SETTINGS }
  const entry = raw as Partial<ScreenRef>
  if (typeof entry.name !== 'string' || entry.name.length === 0) return { ...EMPTY_SETTINGS }
  if (!finite(entry.x) || !finite(entry.y) || !finite(entry.width) || !finite(entry.height)) {
    return { ...EMPTY_SETTINGS }
  }
  return {
    audience: {
      name: entry.name,
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
    },
  }
}

/** Exact name and position first, then name, then the primary display. */
export function resolveDisplay(
  displays: DisplayInfo[],
  screen: ScreenRef | null,
): DisplayInfo | null {
  if (displays.length === 0) return null
  if (!screen) return defaultAudienceDisplay(displays)
  return (
    displays.find(
      (display) =>
        display.name === screen.name && display.x === screen.x && display.y === screen.y,
    ) ??
    displays.find((display) => display.name === screen.name) ??
    displays.find((display) => display.primary) ??
    displays[0] ??
    null
  )
}

/** Projectors are usually the second display; fall back to the primary laptop screen. */
export function defaultAudienceDisplay(displays: DisplayInfo[]): DisplayInfo | null {
  return displays.find((display) => !display.primary) ?? displays.find((display) => display.primary) ?? displays[0] ?? null
}

export function isAssignedScreen(display: DisplayInfo, screen: ScreenRef | null): boolean {
  return Boolean(screen && display.name === screen.name && display.x === screen.x && display.y === screen.y)
}

export function displayMeta(display: DisplayInfo): string {
  const scale = Number.isInteger(display.scale_factor)
    ? `${display.scale_factor}×`
    : `${display.scale_factor.toFixed(1)}×`
  return `${display.width}×${display.height} · ${scale} · ${display.x},${display.y}`
}

export async function loadOutputSettings(): Promise<OutputSettings> {
  if (!isTauri()) return { ...EMPTY_SETTINGS }
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(SETTINGS_FILE)
    return normalizeOutputSettings(await store.get(SCREENS_KEY))
  } catch {
    return { ...EMPTY_SETTINGS }
  }
}

/** Writes settings. Best-effort: never throws into the UI. */
export async function saveOutputSettings(settings: OutputSettings): Promise<void> {
  if (!isTauri()) return
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(SETTINGS_FILE)
    await store.set(SCREENS_KEY, normalizeOutputSettings(settings))
    await store.save()
  } catch {
    // Persistence is optional; the assignment stays for this session.
  }
}
