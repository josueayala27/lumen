import { schema } from '@lumen/db'
import { presentationDocSchema } from '@lumen/schema'
import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { libraryWorkspace, requireRole } from './access'
import { requireUser } from './auth'
import { ApiError } from './errors'
import { nextRev } from './rev'
import type { AppEnv } from './types'

export const presentationRoutes = new Hono<AppEnv>()

const createSchema = z.object({
  libraryId: z.string().min(1),
  doc: presentationDocSchema,
})
const updateSchema = z.object({
  doc: presentationDocSchema,
  baseRev: z.number().int().nonnegative(),
})

presentationRoutes.get('/', async (c) => {
  const user = requireUser(c)
  const libraryId = c.req.query('libraryId')
  if (!libraryId) throw new ApiError(400, 'bad_request', 'libraryId is required')
  const workspaceId = await libraryWorkspace(c, libraryId)
  await requireRole(c, workspaceId, 'viewer')
  void user
  const rows = await c.var.db
    .select({
      id: schema.presentations.id,
      libraryId: schema.presentations.libraryId,
      kind: schema.presentations.kind,
      title: schema.presentations.title,
      themeId: schema.presentations.themeId,
      serverRev: schema.presentations.serverRev,
      updatedAt: schema.presentations.updatedAt,
    })
    .from(schema.presentations)
    .where(and(eq(schema.presentations.libraryId, libraryId), isNull(schema.presentations.deletedAt)))
  return c.json({ presentations: rows })
})

presentationRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json')
  const workspaceId = await libraryWorkspace(c, body.libraryId)
  await requireRole(c, workspaceId, 'editor')
  const rev = await nextRev(c, workspaceId)
  const [presentation] = await c.var.db
    .insert(schema.presentations)
    .values({
      libraryId: body.libraryId,
      kind: body.doc.kind,
      title: body.doc.title,
      themeId: body.doc.themeId,
      doc: body.doc,
      serverRev: rev,
      clientUpdatedAt: new Date(),
    })
    .returning()
  return c.json({ presentation, serverRev: rev }, 201)
})

presentationRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await c.var.db
    .select({ presentation: schema.presentations, workspaceId: schema.libraries.workspaceId })
    .from(schema.presentations)
    .innerJoin(schema.libraries, eq(schema.libraries.id, schema.presentations.libraryId))
    .where(and(eq(schema.presentations.id, id), isNull(schema.presentations.deletedAt)))
    .limit(1)
  if (!row) throw new ApiError(404, 'not_found', 'Presentation not found')
  await requireRole(c, row.workspaceId, 'viewer')
  return c.json({ presentation: row.presentation })
})

presentationRoutes.patch('/:id', zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [row] = await c.var.db
    .select({ presentation: schema.presentations, workspaceId: schema.libraries.workspaceId })
    .from(schema.presentations)
    .innerJoin(schema.libraries, eq(schema.libraries.id, schema.presentations.libraryId))
    .where(and(eq(schema.presentations.id, id), isNull(schema.presentations.deletedAt)))
    .limit(1)
  if (!row) throw new ApiError(404, 'not_found', 'Presentation not found')
  await requireRole(c, row.workspaceId, 'editor')

  if (row.presentation.serverRev !== body.baseRev) {
    return c.json(
      {
        error: {
          code: 'conflict' as const,
          message: 'This presentation changed on another device',
        },
        server: { presentation: row.presentation },
      },
      409,
    )
  }

  const rev = await nextRev(c, row.workspaceId)
  const [presentation] = await c.var.db
    .update(schema.presentations)
    .set({
      doc: body.doc,
      title: body.doc.title,
      kind: body.doc.kind,
      themeId: body.doc.themeId,
      version: row.presentation.version + 1,
      clientUpdatedAt: new Date(),
      serverRev: rev,
    })
    .where(eq(schema.presentations.id, id))
    .returning()
  return c.json({ presentation, serverRev: rev })
})

presentationRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await c.var.db
    .select({ presentation: schema.presentations, workspaceId: schema.libraries.workspaceId })
    .from(schema.presentations)
    .innerJoin(schema.libraries, eq(schema.libraries.id, schema.presentations.libraryId))
    .where(and(eq(schema.presentations.id, id), isNull(schema.presentations.deletedAt)))
    .limit(1)
  if (!row) throw new ApiError(404, 'not_found', 'Presentation not found')
  await requireRole(c, row.workspaceId, 'editor')
  const rev = await nextRev(c, row.workspaceId)
  await c.var.db
    .update(schema.presentations)
    .set({ deletedAt: new Date(), serverRev: rev })
    .where(eq(schema.presentations.id, id))
  return c.json({ ok: true, serverRev: rev })
})
