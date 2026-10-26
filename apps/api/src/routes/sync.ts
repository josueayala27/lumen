import { schema } from '@lumen/db'
import { zValidator } from '@hono/zod-validator'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireRole } from './access'
import { ApiError } from './errors'
import { nextRev } from './rev'
import type { AppEnv } from './types'

export const syncRoutes = new Hono<AppEnv>()

const SYNced = ['presentation', 'theme', 'playlist', 'media'] as const
type SyncEntity = (typeof SYNced)[number]

const pushSchema = z.object({
  workspaceId: z.string().min(1),
  ops: z
    .array(
      z.object({
        opId: z.string().min(8).max(80),
        entity: z.enum(SYNced),
        id: z.string().min(1),
        baseRev: z.number().int().nonnegative(),
        clientUpdatedAt: z.number().int().nonnegative(),
        payload: z.unknown(),
      }),
    )
    .max(50),
})

syncRoutes.get('/pull', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  const since = Number(c.req.query('since') ?? 0)
  if (!workspaceId) throw new ApiError(400, 'bad_request', 'workspaceId is required')
  await requireRole(c, workspaceId, 'viewer')

  const libraries = await c.var.db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.workspaceId, workspaceId))
  const libraryIds = libraries.map((row) => row.id)
  if (!libraryIds.length) return c.json({ rev: since, changes: [] })

  const [presentations, themes, playlists] = await Promise.all([
    c.var.db
      .select()
      .from(schema.presentations)
      .where(and(inArray(schema.presentations.libraryId, libraryIds), gt(schema.presentations.serverRev, since))),
    c.var.db.select().from(schema.themes).where(and(inArray(schema.themes.libraryId, libraryIds), gt(schema.themes.serverRev, since))),
    c.var.db
      .select()
      .from(schema.playlists)
      .where(and(inArray(schema.playlists.libraryId, libraryIds), gt(schema.playlists.serverRev, since))),
  ])

  const changes = [
    ...presentations.map((row) => ({ entity: 'presentation' as const, row })),
    ...themes.map((row) => ({ entity: 'theme' as const, row })),
    ...playlists.map((row) => ({ entity: 'playlist' as const, row })),
  ].sort((a, b) => a.row.serverRev - b.row.serverRev)

  const rev = changes.reduce((max, change) => Math.max(max, change.row.serverRev), since)
  return c.json({ rev, changes })
})

syncRoutes.post('/push', zValidator('json', pushSchema), async (c) => {
  const body = c.req.valid('json')
  await requireRole(c, body.workspaceId, 'editor')

  const applied: { opId: string; id: string; serverRev: number }[] = []
  const conflicts: { opId: string; id: string; serverRev: number }[] = []

  for (const op of body.ops) {
    if (op.entity !== 'presentation') {
      conflicts.push({ opId: op.opId, id: op.id, serverRev: 0 })
      continue
    }
    const existingOp = await c.var.db
      .select({ result: schema.syncOps.result })
      .from(schema.syncOps)
      .where(eq(schema.syncOps.opId, op.opId))
      .limit(1)
    if (existingOp.length) continue

    const [current] = await c.var.db
      .select({ serverRev: schema.presentations.serverRev })
      .from(schema.presentations)
      .where(eq(schema.presentations.id, op.id))
      .limit(1)

    if (!current || current.serverRev !== op.baseRev) {
      await c.var.db.insert(schema.syncConflicts).values({
        workspaceId: body.workspaceId,
        entity: op.entity,
        entityId: op.id,
        baseRev: op.baseRev,
        localDoc: op.payload as object,
      })
      await c.var.db.insert(schema.syncOps).values({
        opId: op.opId,
        workspaceId: body.workspaceId,
        entity: op.entity,
        entityId: op.id,
        baseRev: op.baseRev,
        result: 'conflict',
      })
      conflicts.push({ opId: op.opId, id: op.id, serverRev: current?.serverRev ?? 0 })
      continue
    }

    const rev = await nextRev(c, body.workspaceId)
    await c.var.db
      .update(schema.presentations)
      .set({ doc: op.payload, clientUpdatedAt: new Date(op.clientUpdatedAt), serverRev: rev, version: sql`${schema.presentations.version} + 1` })
      .where(eq(schema.presentations.id, op.id))
    await c.var.db.insert(schema.syncOps).values({
      opId: op.opId,
      workspaceId: body.workspaceId,
      entity: op.entity,
      entityId: op.id,
      baseRev: op.baseRev,
      result: 'applied',
    })
    applied.push({ opId: op.opId, id: op.id, serverRev: rev })
  }

  return c.json({ applied, conflicts })
})
