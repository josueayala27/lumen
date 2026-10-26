import { newId } from '@lumen/core'
import { playlistDocSchema, type PlaylistDoc, type PlaylistItem } from '@lumen/schema'
import { getDatabase } from './db'

export interface PlaylistRecord {
  id: string
  doc: PlaylistDoc
  createdAt: number
  updatedAt: number
}

export interface PlaylistSummary {
  id: string
  name: string
  itemCount: number
  presentationCount: number
  updatedAt: number
}

interface Row {
  id: string
  name: string
  doc: string
  created_at: number
  updated_at: number
}

const LOCAL_KEY = 'lumen.playlists'

export function newPlaylistDoc(name = 'New playlist'): PlaylistDoc {
  return {
    schemaVersion: 1,
    name: name.trim() || 'New playlist',
    items: [],
  }
}

export function normalizePlaylistDoc(value: unknown): PlaylistDoc | null {
  const parsed = playlistDocSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function addPresentationItem(
  doc: PlaylistDoc,
  presentationId: string,
  label = '',
): PlaylistDoc {
  const item: PlaylistItem = {
    kind: 'presentation',
    id: newId('item'),
    presentationId,
    label,
  }
  return { ...doc, items: [...doc.items, item] }
}

export function removePlaylistItem(doc: PlaylistDoc, itemId: string): PlaylistDoc {
  const items = doc.items.filter((item) => item.id !== itemId)
  return items.length === doc.items.length ? doc : { ...doc, items }
}

export function movePlaylistItem(doc: PlaylistDoc, itemId: string, delta: number): PlaylistDoc {
  const index = doc.items.findIndex((item) => item.id === itemId)
  if (index === -1 || delta === 0) return doc
  const target = Math.min(doc.items.length - 1, Math.max(0, index + delta))
  if (target === index) return doc
  const items = [...doc.items]
  const [entry] = items.splice(index, 1)
  if (!entry) return doc
  items.splice(target, 0, entry)
  return { ...doc, items }
}

function readLocal(): PlaylistRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as PlaylistRecord[]
    if (!Array.isArray(raw)) return []
    return raw
      .map((entry) => {
        const doc = normalizePlaylistDoc(entry.doc)
        return doc ? { ...entry, doc } : null
      })
      .filter((entry): entry is PlaylistRecord => entry !== null)
  } catch {
    return []
  }
}

function writeLocal(records: PlaylistRecord[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records))
}

function fromRow(row: Row): PlaylistRecord | null {
  try {
    const doc = normalizePlaylistDoc(JSON.parse(row.doc))
    if (!doc) return null
    return {
      id: row.id,
      doc,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

function summary(record: PlaylistRecord): PlaylistSummary {
  return {
    id: record.id,
    name: record.doc.name,
    itemCount: record.doc.items.length,
    presentationCount: record.doc.items.filter((item) => item.kind === 'presentation').length,
    updatedAt: record.updatedAt,
  }
}

export async function listPlaylists(): Promise<PlaylistSummary[]> {
  const db = await getDatabase()
  if (!db) {
    return readLocal()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summary)
  }
  const rows = await db.select<Row[]>(
    'SELECT * FROM playlists WHERE deleted_at IS NULL ORDER BY updated_at DESC',
  )
  return rows
    .map(fromRow)
    .filter((record): record is PlaylistRecord => record !== null)
    .map(summary)
}

export async function getPlaylist(id: string): Promise<PlaylistRecord | null> {
  const db = await getDatabase()
  if (!db) return readLocal().find((record) => record.id === id) ?? null
  const rows = await db.select<Row[]>(
    'SELECT * FROM playlists WHERE id = $1 AND deleted_at IS NULL',
    [id],
  )
  const row = rows[0]
  return row ? fromRow(row) : null
}

export async function savePlaylist(record: PlaylistRecord): Promise<void> {
  const doc = playlistDocSchema.parse(record.doc)
  const db = await getDatabase()
  if (!db) {
    const records = readLocal().filter((entry) => entry.id !== record.id)
    records.push({ ...record, doc })
    writeLocal(records)
    return
  }
  await db.execute(
    `INSERT INTO playlists (id, name, doc, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, NULL)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       doc = excluded.doc,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
    [record.id, doc.name, JSON.stringify(doc), record.createdAt, record.updatedAt],
  )
}

export async function deletePlaylist(id: string): Promise<void> {
  const db = await getDatabase()
  if (!db) {
    writeLocal(readLocal().filter((record) => record.id !== id))
    return
  }
  await db.execute('UPDATE playlists SET deleted_at = $1, updated_at = $1 WHERE id = $2', [
    Date.now(),
    id,
  ])
}

export async function createPlaylist(doc: PlaylistDoc = newPlaylistDoc()): Promise<PlaylistRecord> {
  const now = Date.now()
  const record: PlaylistRecord = {
    id: newId('playlist'),
    doc: playlistDocSchema.parse(doc),
    createdAt: now,
    updatedAt: now,
  }
  await savePlaylist(record)
  return record
}
