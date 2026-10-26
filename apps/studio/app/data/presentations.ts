import { newId } from '@lumen/core'
import { presentationDocSchema, type PresentationDoc } from '@lumen/schema'
import { getDatabase, isTauri } from './db'

export interface PresentationRecord {
  id: string
  kind: PresentationDoc['kind']
  doc: PresentationDoc
  createdAt: number
  updatedAt: number
}

export interface PresentationSummary {
  id: string
  kind: PresentationDoc['kind']
  title: string
  slideCount: number
  updatedAt: number
}

interface Row {
  id: string
  kind: string
  title: string
  theme_id: string | null
  doc: string
  created_at: number
  updated_at: number
}

const LOCAL_KEY = 'lumen.presentations'

function readLocal(): PresentationRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as PresentationRecord[]
    return Array.isArray(raw)
      ? raw
          .map((entry) => ({
            ...entry,
            doc: presentationDocSchema.safeParse(entry.doc).success ? entry.doc : null,
          }))
          .filter((entry): entry is PresentationRecord => entry.doc !== null)
      : []
  } catch {
    return []
  }
}

function writeLocal(records: PresentationRecord[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records))
}

function fromRow(row: Row): PresentationRecord | null {
  try {
    const doc = presentationDocSchema.parse(JSON.parse(row.doc))
    return {
      id: row.id,
      kind: doc.kind,
      doc,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

function summary(record: PresentationRecord): PresentationSummary {
  return {
    id: record.id,
    kind: record.kind,
    title: record.doc.title,
    slideCount: record.doc.slides.length,
    updatedAt: record.updatedAt,
  }
}

export async function listPresentations(
  kind?: PresentationDoc['kind'],
): Promise<PresentationSummary[]> {
  const db = await getDatabase()
  if (!db) {
    return readLocal()
      .filter((record) => !kind || record.kind === kind)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summary)
  }
  const rows = kind
    ? await db.select<Row[]>(
        'SELECT * FROM presentations WHERE deleted_at IS NULL AND kind = $1 ORDER BY updated_at DESC',
        [kind],
      )
    : await db.select<Row[]>(
        'SELECT * FROM presentations WHERE deleted_at IS NULL ORDER BY updated_at DESC',
      )
  return rows
    .map(fromRow)
    .filter((record): record is PresentationRecord => record !== null)
    .map(summary)
}

export async function getPresentation(id: string): Promise<PresentationRecord | null> {
  const db = await getDatabase()
  if (!db) return readLocal().find((record) => record.id === id) ?? null
  const rows = await db.select<Row[]>(
    'SELECT * FROM presentations WHERE id = $1 AND deleted_at IS NULL',
    [id],
  )
  const row = rows[0]
  return row ? fromRow(row) : null
}

export async function savePresentation(record: PresentationRecord): Promise<void> {
  const db = await getDatabase()
  if (!db) {
    const records = readLocal().filter((entry) => entry.id !== record.id)
    records.push(record)
    writeLocal(records)
    return
  }
  await db.execute(
    `INSERT INTO presentations (id, kind, title, theme_id, doc, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       title = excluded.title,
       theme_id = excluded.theme_id,
       doc = excluded.doc,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
    [
      record.id,
      record.kind,
      record.doc.title,
      record.doc.themeId,
      JSON.stringify(record.doc),
      record.createdAt,
      record.updatedAt,
    ],
  )
}

export async function deletePresentation(id: string): Promise<void> {
  const db = await getDatabase()
  if (!db) {
    writeLocal(readLocal().filter((record) => record.id !== id))
    return
  }
  await db.execute('UPDATE presentations SET deleted_at = $1, updated_at = $1 WHERE id = $2', [
    Date.now(),
    id,
  ])
}

export async function createPresentation(doc: PresentationDoc): Promise<PresentationRecord> {
  const now = Date.now()
  const record: PresentationRecord = {
    id: newId(doc.kind === 'song' ? 'song' : 'presentation'),
    kind: doc.kind,
    doc,
    createdAt: now,
    updatedAt: now,
  }
  await savePresentation(record)
  return record
}

export function updatedLabel(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} hours ago`
  return `${Math.floor(seconds / 86_400)} days ago`
}

export function localOnly(): boolean {
  return !isTauri()
}
