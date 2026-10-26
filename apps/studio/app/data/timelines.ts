import { newId, nominalFps } from '@lumen/core'
import {
  showTimelineSchema,
  type FrameRate,
  type ShowTimeline,
  type TimelineTrack,
} from '@lumen/schema'
import { isTauri } from './db'

export interface TimelineRecord {
  id: string
  doc: ShowTimeline
  createdAt: number
  updatedAt: number
}

export interface TimelineSummary {
  id: string
  name: string
  frameRate: FrameRate
  durationFrames: number
  trackCount: number
  clipCount: number
  markerCount: number
  updatedAt: number
}

export const TIMELINES_FILE = 'timelines.json'
export const TIMELINES_KEY = 'timelines'
export const TIMELINES_LOCAL_KEY = 'lumen.timelines'

const DEFAULT_DURATION_SECONDS = 60

export function newShowTimeline(
  name = 'New timeline',
  frameRate: FrameRate = '30',
  durationFrames = Math.round(nominalFps(frameRate) * DEFAULT_DURATION_SECONDS),
): ShowTimeline {
  const tracks = (['slide', 'media', 'audio', 'macro'] as const).map((kind) => ({
    id: newId('track'),
    kind,
    name: kind === 'slide' ? 'Slides' : kind === 'media' ? 'Media' : kind === 'audio' ? 'Audio' : 'Macros',
    clips: [],
  }))
  return showTimelineSchema.parse({
    schemaVersion: 1,
    id: newId('timeline'),
    name: name.trim() || 'New timeline',
    frameRate,
    durationFrames: Math.max(1, Math.round(durationFrames)),
    tracks,
    markers: [],
  })
}

export function normalizeTimeline(value: unknown): ShowTimeline | null {
  const parsed = showTimelineSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function normalizeRecord(value: unknown): TimelineRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<TimelineRecord>
  const doc = normalizeTimeline(raw.doc)
  if (!doc) return null
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt
  return { id: doc.id, doc, createdAt, updatedAt }
}

function normalizeList(value: unknown): TimelineRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is TimelineRecord => record !== null)
}

function readLocal(): TimelineRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return normalizeList(JSON.parse(localStorage.getItem(TIMELINES_LOCAL_KEY) ?? '[]'))
  } catch {
    return []
  }
}

function writeLocal(records: TimelineRecord[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(TIMELINES_LOCAL_KEY, JSON.stringify(records))
}

async function readTauri(): Promise<TimelineRecord[]> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(TIMELINES_FILE)
  return normalizeList(await store.get(TIMELINES_KEY))
}

async function writeTauri(records: TimelineRecord[]): Promise<void> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(TIMELINES_FILE)
  await store.set(TIMELINES_KEY, records)
  await store.save()
}

async function readRecords(): Promise<TimelineRecord[]> {
  if (!isTauri()) return readLocal()
  try {
    return await readTauri()
  } catch {
    return []
  }
}

function summary(record: TimelineRecord): TimelineSummary {
  return {
    id: record.id,
    name: record.doc.name,
    frameRate: record.doc.frameRate,
    durationFrames: record.doc.durationFrames,
    trackCount: record.doc.tracks.length,
    clipCount: record.doc.tracks.reduce((count, track) => count + track.clips.length, 0),
    markerCount: record.doc.markers.length,
    updatedAt: record.updatedAt,
  }
}

/** All timelines, newest first. Corrupt records are skipped. */
export async function listTimelines(): Promise<TimelineSummary[]> {
  const records = await readRecords()
  return records
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summary)
}

export async function getTimeline(id: string): Promise<TimelineRecord | null> {
  const records = await readRecords()
  return records.find((record) => record.id === id) ?? null
}

/** Upserts a timeline. The document is validated before it reaches storage. */
export async function saveTimeline(record: TimelineRecord): Promise<void> {
  const doc = showTimelineSchema.parse(record.doc)
  const next: TimelineRecord = { ...record, id: doc.id, doc }
  // Read raw: a failed read must not silently overwrite stored timelines.
  const records = isTauri() ? await readTauri() : readLocal()
  const merged = [...records.filter((entry) => entry.id !== next.id), next]
  if (isTauri()) {
    await writeTauri(merged)
    return
  }
  writeLocal(merged)
}

export async function deleteTimeline(id: string): Promise<void> {
  const records = isTauri() ? await readTauri() : readLocal()
  const merged = records.filter((record) => record.id !== id)
  if (isTauri()) {
    await writeTauri(merged)
    return
  }
  writeLocal(merged)
}

/** Creates and persists a timeline from the default track layout. */
export async function createTimeline(
  name = 'New timeline',
  now = Date.now(),
): Promise<TimelineRecord> {
  const doc = newShowTimeline(name)
  const record: TimelineRecord = {
    id: doc.id,
    doc,
    createdAt: now,
    updatedAt: now,
  }
  await saveTimeline(record)
  return record
}

/** Track layout used when a stored timeline has no track of the requested kind. */
export function newTrack(kind: TimelineTrack['kind']): TimelineTrack {
  return {
    id: newId('track'),
    kind,
    name: kind === 'slide' ? 'Slides' : kind === 'media' ? 'Media' : kind === 'audio' ? 'Audio' : kind === 'layer' ? 'Layers' : 'Macros',
    muted: false,
    locked: false,
    presentationId: null,
    slideIndex: null,
    elementId: null,
    clips: [],
    properties: [],
  }
}
