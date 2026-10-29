import { defaultShow, normalizeShow, type ShowDoc } from '~/show/showModel'
import { isTauri } from './db'

export const SHOWS_FILE = 'shows.json'
export const SHOW_KEY = 'current'
export const SHOW_LOCAL_KEY = 'lumen.show'

/** The current show, or a new default show when none is stored or it is corrupt. */
export async function loadShow(): Promise<ShowDoc> {
  try {
    if (!isTauri()) {
      if (typeof localStorage === 'undefined') return defaultShow()
      return normalizeShow(JSON.parse(localStorage.getItem(SHOW_LOCAL_KEY) ?? 'null')) ?? defaultShow()
    }
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(SHOWS_FILE)
    return normalizeShow(await store.get(SHOW_KEY)) ?? defaultShow()
  } catch {
    return defaultShow()
  }
}

export async function saveShow(show: ShowDoc): Promise<void> {
  if (!isTauri()) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SHOW_LOCAL_KEY, JSON.stringify(show))
    return
  }
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(SHOWS_FILE)
  await store.set(SHOW_KEY, show)
  await store.save()
}
