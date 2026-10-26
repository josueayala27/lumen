import type Database from '@tauri-apps/plugin-sql'

const DB_PATH = 'sqlite:lumen.db'
let database: Promise<Database | null> | null = null

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function migrate(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS presentations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      theme_id TEXT,
      doc TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `)
  await db.execute(`
    CREATE INDEX IF NOT EXISTS presentations_kind_updated_idx
    ON presentations (kind, updated_at DESC)
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      doc TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `)
  await db.execute(`
    CREATE INDEX IF NOT EXISTS playlists_updated_idx
    ON playlists (updated_at DESC)
  `)
}

export async function getDatabase(): Promise<Database | null> {
  if (!isTauri()) return null
  if (!database) {
    database = (async () => {
      const { default: Sql } = await import('@tauri-apps/plugin-sql')
      const db = await Sql.load(DB_PATH)
      await migrate(db)
      return db
    })().catch((error) => {
      console.error('[lumen] database open failed', error)
      database = null
      return null
    })
  }
  return database
}
