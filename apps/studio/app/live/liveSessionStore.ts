import { liveStateSchema, type LiveState } from '@lumen/schema'
import { z } from 'zod'

export const LIVE_SESSION_FILE = 'live-session.json'
export const LIVE_SESSION_KEY = 'session'
export const LIVE_SESSION_LOCAL_KEY = 'lumen.liveSession'

export interface LiveSessionSnapshot {
  playlistId: string | null
  presentationId: string | null
  state: LiveState
}

export const liveSessionSnapshotSchema = z.object({
  playlistId: z.string().min(1).nullable(),
  presentationId: z.string().min(1).nullable(),
  state: liveStateSchema,
})

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function normalizeLiveSession(value: unknown): LiveSessionSnapshot | null {
  const parsed = liveSessionSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function readLocal(): LiveSessionSnapshot | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return normalizeLiveSession(JSON.parse(localStorage.getItem(LIVE_SESSION_LOCAL_KEY) ?? 'null'))
  } catch {
    return null
  }
}

export async function loadLiveSession(): Promise<LiveSessionSnapshot | null> {
  if (!isTauri()) return readLocal()
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(LIVE_SESSION_FILE)
    return normalizeLiveSession(await store.get(LIVE_SESSION_KEY))
  } catch {
    return null
  }
}

export async function saveLiveSession(snapshot: LiveSessionSnapshot): Promise<void> {
  const parsed = liveSessionSnapshotSchema.safeParse(snapshot)
  if (!parsed.success) return
  if (!isTauri()) {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(LIVE_SESSION_LOCAL_KEY, JSON.stringify(parsed.data))
    } catch {
      // Storage may be unavailable in private windows; the session stays in memory.
    }
    return
  }
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(LIVE_SESSION_FILE)
    await store.set(LIVE_SESSION_KEY, parsed.data)
    await store.save()
  } catch {
    // Persistence is optional; live output continues from memory.
  }
}
