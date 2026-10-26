import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export type Db = NodePgDatabase<typeof schema>

export interface DbHandle {
  db: Db
  close: () => Promise<void>
}

/**
 * Creates a request-scoped client. On Workers, pass the Hyperdrive connection string and keep the
 * pool small; Hyperdrive owns the real pool. On Node (tests/scripts), use a direct Neon URL.
 */
export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 3,
    // Neon + Hyperdrive pool in front of Postgres; prepared statements are not portable across
    // pooled connections.
    statement_timeout: 30_000,
  })
  pool.on('error', (error) => {
    console.error('postgres pool error', error)
  })
  return { db: drizzle(pool, { schema }), close: () => pool.end() }
}
