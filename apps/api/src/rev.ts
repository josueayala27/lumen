import { schema } from '@lumen/db'
import { sql } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AppEnv } from './types'

/** Allocates the next monotonic revision for a workspace. Every synced row records it. */
export async function nextRev(c: Context<AppEnv>, workspaceId: string): Promise<number> {
  const [row] = await c.var.db
    .insert(schema.workspaceRevs)
    .values({ workspaceId, rev: 1 })
    .onConflictDoUpdate({
      target: schema.workspaceRevs.workspaceId,
      set: { rev: sql`${schema.workspaceRevs.rev} + 1` },
    })
    .returning({ rev: schema.workspaceRevs.rev })
  if (!row) throw new Error('Could not allocate workspace revision')
  return row.rev
}
