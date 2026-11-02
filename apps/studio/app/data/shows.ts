import { createShowDoc, parseShowDoc, type ShowLoadOptions } from '@lumen/core'
import type { ShowDoc } from '@lumen/schema'
import { screenRef } from '~/output/screens'
import { isTauri } from './db'

export const SHOWS_FILE = 'shows.json'
export const SHOW_KEY = 'current'
export const SHOW_LOCAL_KEY = 'lumen.show'

/** Monitor lookup for migrating v1 shows, which stored a display index. */
async function loadOptions(): Promise<ShowLoadOptions> {
  try {
    const { listDisplays } = await import('~/output/api')
    const displays = await listDisplays()
    return {
      displayRef: (index) => {
        const display = displays.find((entry) => entry.index === index)
        return display ? screenRef(display) : null
      },
    }
  } catch {
    return {}
  }
}

/**
 * The current show, migrated to v2 when it was saved as v1, or a new default
 * show when none is stored or it is corrupt.
 */
export async function loadShow(): Promise<ShowDoc> {
  try {
    if (!isTauri()) {
      if (typeof localStorage === 'undefined') return createShowDoc()
      return parseShowDoc(JSON.parse(localStorage.getItem(SHOW_LOCAL_KEY) ?? 'null')) ?? createShowDoc()
    }
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(SHOWS_FILE)
    const stored = await store.get(SHOW_KEY)
    const options = (stored as { schemaVersion?: unknown } | null)?.schemaVersion === 1 ? await loadOptions() : {}
    return parseShowDoc(stored, options) ?? createShowDoc()
  } catch {
    return createShowDoc()
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
