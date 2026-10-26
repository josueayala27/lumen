import { timelineSchema, type FrameRate, type TimelineDoc } from '@lumen/schema'

export const TIMELINE_FILE = 'timeline.json'
export const TIMELINE_KEY = 'timeline'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function newTimeline(rate: FrameRate = '29.97df'): TimelineDoc {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return {
    schemaVersion: 1,
    id: `timeline_${suffix}`,
    name: 'Service timeline',
    frameRate: rate,
    cues: [],
  }
}

export function normalizeTimeline(value: unknown): TimelineDoc | null {
  const parsed = timelineSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export async function loadTimeline(): Promise<TimelineDoc | null> {
  if (!isTauri()) return null
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(TIMELINE_FILE)
    return normalizeTimeline(await store.get(TIMELINE_KEY))
  } catch {
    return null
  }
}

export async function saveTimeline(timeline: TimelineDoc): Promise<void> {
  if (!isTauri()) return
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(TIMELINE_FILE)
    await store.set(TIMELINE_KEY, timeline)
    await store.save()
  } catch {
    // Persistence is optional; the timeline stays in memory for this session.
  }
}
