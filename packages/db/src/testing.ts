import type { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

/** In-memory Postgres for api/db tests. Mirrors the production schema. */
export function createTestDb(client: PGlite) {
  return drizzle(client, { schema })
}
