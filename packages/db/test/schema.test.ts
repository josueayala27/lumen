import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../src/testing'
import * as schema from '../src/schema'

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/0000_ancient_argent.sql', import.meta.url)),
  'utf8',
)

describe('database schema', () => {
  it('applies the initial migration and stores a presentation', async () => {
    const client = await PGlite.create()
    await client.exec(migration)
    const db = createTestDb(client)

    await db.insert(schema.user).values({ id: 'user_1', name: 'Ada', email: 'ada@example.com' })
    await db.insert(schema.workspaces).values({ id: 'workspace_1', name: 'Riverside', slug: 'riverside' })
    await db.insert(schema.workspaceMembers).values({ workspaceId: 'workspace_1', userId: 'user_1', role: 'owner' })
    await db.insert(schema.libraries).values({ id: 'library_1', workspaceId: 'workspace_1', name: 'Sunday' })
    await db.insert(schema.presentations).values({
      id: 'presentation_1',
      libraryId: 'library_1',
      kind: 'song',
      title: 'Great Are You Lord',
      doc: { schemaVersion: 1, kind: 'song', title: 'Great Are You Lord', slides: [] },
      serverRev: 4,
    })

    const [row] = await db.select().from(schema.presentations).where(eq(schema.presentations.id, 'presentation_1'))
    expect(row?.title).toBe('Great Are You Lord')
    expect(row?.serverRev).toBe(4)
    await client.close()
  })
})
