import { invoke } from '@tauri-apps/api/core'
import { newId } from '@lumen/core'
import { getDatabase, isTauri } from './db'

export type MediaKind = 'image' | 'video' | 'audio'

export interface MediaAsset {
  id: string
  kind: MediaKind
  name: string
  sha256: string
  mime: string
  size: number
  durationMs: number | null
  width: number | null
  height: number | null
  localPath: string
  createdAt: number
  updatedAt: number
  /** The managed file is gone; the row is kept so it can be relinked. */
  missing: boolean
}

/** Metadata returned by the `import_media` command. */
interface ImportedMedia {
  kind: MediaKind
  name: string
  sha256: string
  mime: string
  size: number
  durationMs: number | null
  width: number | null
  height: number | null
  localPath: string
}

interface Row {
  id: string
  kind: string
  name: string
  sha256: string
  mime: string
  size: number
  duration_ms: number | null
  width: number | null
  height: number | null
  local_path: string
  created_at: number
  updated_at: number
}

const LOCAL_KEY = 'lumen.media'

function isMediaKind(value: string): value is MediaKind {
  return value === 'image' || value === 'video' || value === 'audio'
}

function fromRow(row: Row, missing: boolean): MediaAsset | null {
  if (!isMediaKind(row.kind)) return null
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    sha256: row.sha256,
    mime: row.mime,
    size: row.size,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    localPath: row.local_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    missing,
  }
}

function readLocal(): MediaAsset[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as MediaAsset[]
    return Array.isArray(raw)
      ? raw.filter(
          (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            typeof entry.localPath === 'string' &&
            isMediaKind(entry.kind),
        )
      : []
  } catch {
    return []
  }
}

function writeLocal(assets: MediaAsset[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LOCAL_KEY, JSON.stringify(assets))
}

async function mediaFilesStatus(paths: string[]): Promise<boolean[]> {
  if (!isTauri() || paths.length === 0) return paths.map(() => false)
  return invoke<boolean[]>('media_files_status', { paths })
}

/** Media bin rows, newest first, with a live missing-file flag. */
export async function listMediaAssets(): Promise<MediaAsset[]> {
  const db = await getDatabase()
  if (!db) return readLocal().map((asset) => ({ ...asset, missing: false }))
  const rows = await db.select<Row[]>(
    'SELECT * FROM media_assets WHERE deleted_at IS NULL ORDER BY updated_at DESC',
  )
  const assets = rows
    .map((row) => fromRow(row, false))
    .filter((asset): asset is MediaAsset => asset !== null)
  let status: boolean[] = assets.map(() => true)
  try {
    status = await mediaFilesStatus(assets.map((asset) => asset.localPath))
  } catch {
    status = assets.map(() => false)
  }
  return assets.map((asset, index) => ({ ...asset, missing: !(status[index] ?? false) }))
}

/** Copies a local file into the app-managed media folder and stores its row. */
export async function importMediaFile(sourcePath: string): Promise<MediaAsset> {
  if (!isTauri()) throw new Error('Importing media requires the desktop app.')
  const imported = await invoke<ImportedMedia>('import_media', { path: sourcePath })
  const db = await getDatabase()
  if (!db) throw new Error('The local library database is unavailable.')
  const now = Date.now()

  const existing = await db.select<Row[]>(
    `SELECT * FROM media_assets
     WHERE sha256 = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC LIMIT 1`,
    [imported.sha256],
  )
  const prior = existing[0]
  if (prior) {
    await db.execute(
      `UPDATE media_assets
       SET name = $1, mime = $2, local_path = $3, updated_at = $4
       WHERE id = $5`,
      [imported.name, imported.mime, imported.localPath, now, prior.id],
    )
    const asset = fromRow(
      { ...prior, name: imported.name, mime: imported.mime, local_path: imported.localPath, updated_at: now },
      false,
    )
    if (!asset) throw new Error('The stored media row is invalid.')
    return asset
  }

  const asset: MediaAsset = {
    id: newId('media'),
    kind: imported.kind,
    name: imported.name,
    sha256: imported.sha256,
    mime: imported.mime,
    size: imported.size,
    durationMs: imported.durationMs,
    width: imported.width,
    height: imported.height,
    localPath: imported.localPath,
    createdAt: now,
    updatedAt: now,
    missing: false,
  }
  await db.execute(
    `INSERT INTO media_assets
       (id, kind, name, sha256, mime, size, duration_ms, width, height, local_path, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)`,
    [
      asset.id,
      asset.kind,
      asset.name,
      asset.sha256,
      asset.mime,
      asset.size,
      asset.durationMs,
      asset.width,
      asset.height,
      asset.localPath,
      asset.createdAt,
      asset.updatedAt,
    ],
  )
  return asset
}

/** Removes the managed file and soft-deletes the row. */
export async function deleteMediaAsset(id: string): Promise<void> {
  const db = await getDatabase()
  if (!db) {
    writeLocal(readLocal().filter((asset) => asset.id !== id))
    return
  }
  const rows = await db.select<Row[]>(
    'SELECT * FROM media_assets WHERE id = $1 AND deleted_at IS NULL',
    [id],
  )
  const row = rows[0]
  if (row && isTauri()) {
    await invoke('delete_media_file', { path: row.local_path })
  }
  const now = Date.now()
  await db.execute('UPDATE media_assets SET deleted_at = $1, updated_at = $1 WHERE id = $2', [
    now,
    id,
  ])
}

const thumbnails = new Map<string, string | null>()

/** PNG data URL for an image; videos have no poster until a decoder exists. */
export async function mediaThumbnail(asset: MediaAsset): Promise<string | null> {
  if (!isTauri() || asset.kind !== 'image' || asset.missing) return null
  const key = asset.localPath
  if (thumbnails.has(key)) return thumbnails.get(key) ?? null
  let thumbnail: string | null = null
  try {
    thumbnail = await invoke<string | null>('media_thumbnail', {
      path: asset.localPath,
      maxEdge: 320,
    })
  } catch {
    thumbnail = null
  }
  thumbnails.set(key, thumbnail)
  return thumbnail
}

/** `m:ss` for video and audio durations. */
export function formatMediaDuration(durationMs: number | null): string {
  if (!durationMs || durationMs < 0) return ''
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
