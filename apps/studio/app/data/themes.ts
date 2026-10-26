import { newId, validateTheme } from '@lumen/core'
import type { Theme } from '@lumen/schema'

export interface ThemeRecord {
  id: string
  theme: Theme
  createdAt: number
  updatedAt: number
}

export const THEMES_FILE = 'themes.json'
export const THEMES_KEY = 'themes'
export const THEMES_LOCAL_KEY = 'lumen.themes'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function normalizeRecord(value: unknown): ThemeRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ThemeRecord>
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  const theme = validateTheme(raw.theme)
  if (!theme) return null
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt
  return { id: raw.id, theme, createdAt, updatedAt }
}

function normalizeList(value: unknown): ThemeRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is ThemeRecord => record !== null)
}

function readLocal(): ThemeRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return normalizeList(JSON.parse(localStorage.getItem(THEMES_LOCAL_KEY) ?? '[]'))
  } catch {
    return []
  }
}

function writeLocal(records: ThemeRecord[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(THEMES_LOCAL_KEY, JSON.stringify(records))
}

async function readTauri(): Promise<ThemeRecord[]> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(THEMES_FILE)
  return normalizeList(await store.get(THEMES_KEY))
}

async function readRecords(): Promise<ThemeRecord[]> {
  if (!isTauri()) return readLocal()
  try {
    return await readTauri()
  } catch {
    return []
  }
}

async function writeTauri(records: ThemeRecord[]): Promise<void> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(THEMES_FILE)
  await store.set(THEMES_KEY, records)
  await store.save()
}

/** All themes, newest first. Corrupt rows are skipped. */
export async function listThemes(): Promise<ThemeRecord[]> {
  const records = await readRecords()
  return records.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getTheme(id: string): Promise<ThemeRecord | null> {
  const records = await readRecords()
  return records.find((record) => record.id === id) ?? null
}

/** Upserts a theme. Invalid themes cannot be persisted. */
export async function saveTheme(record: ThemeRecord): Promise<void> {
  const theme = validateTheme(record.theme)
  if (!theme) throw new Error('Theme is invalid')
  const next: ThemeRecord = { ...record, theme, updatedAt: record.updatedAt }
  // Read raw: a failed read must not silently overwrite stored themes.
  const records = isTauri() ? await readTauri() : readLocal()
  const merged = [...records.filter((entry) => entry.id !== next.id), next]
  if (isTauri()) {
    await writeTauri(merged)
    return
  }
  writeLocal(merged)
}

export async function deleteTheme(id: string): Promise<void> {
  const records = isTauri() ? await readTauri() : readLocal()
  const merged = records.filter((record) => record.id !== id)
  if (isTauri()) {
    await writeTauri(merged)
    return
  }
  writeLocal(merged)
}

/** Creates and persists a theme from a template (usually `defaultTheme()`). */
export async function createTheme(theme: Theme, now = Date.now()): Promise<ThemeRecord> {
  const record: ThemeRecord = {
    id: newId('theme'),
    theme,
    createdAt: now,
    updatedAt: now,
  }
  await saveTheme(record)
  return record
}
