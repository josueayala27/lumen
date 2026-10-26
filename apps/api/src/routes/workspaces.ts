import { schema } from '@lumen/db'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { memberRole, requireRole } from '../access'
import { ApiError } from '../errors'
import { requireUser } from '../auth'
import type { AppEnv } from '../types'

export const workspaceRoutes = new Hono<AppEnv>()

workspaceRoutes.get('/', async (c) => {
  const user = requireUser(c)
  const rows = await c.var.db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      slug: schema.workspaces.slug,
      plan: schema.workspaces.plan,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, user.id))
  return c.json({ workspaces: rows })
})

workspaceRoutes.post(
  '/',
  zValidator('json', z.object({ name: z.string().min(1).max(120), slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(64) })),
  async (c) => {
    const user = requireUser(c)
    const body = c.req.valid('json')
    const workspace = await c.var.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.workspaces)
        .values({ name: body.name, slug: body.slug })
        .returning()
      if (!created) throw new ApiError(500, 'internal', 'Could not create workspace')
      await tx.insert(schema.workspaceMembers).values({ workspaceId: created.id, userId: user.id, role: 'owner' })
      await tx.insert(schema.workspaceRevs).values({ workspaceId: created.id, rev: 0 })
      return created
    })
    return c.json({ workspace }, 201)
  },
)

workspaceRoutes.get('/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  const user = requireUser(c)
  const role = await memberRole(c, workspaceId, user.id)
  if (!role) throw new ApiError(404, 'not_found', 'Workspace not found')
  const [workspace] = await c.var.db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1)
  if (!workspace) throw new ApiError(404, 'not_found', 'Workspace not found')
  return c.json({ workspace, role })
})

workspaceRoutes.get('/:workspaceId/members', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await requireRole(c, workspaceId, 'viewer')
  const rows = await c.var.db
    .select({
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId))
  return c.json({ members: rows })
})

export const libraryRoutes = new Hono<AppEnv>()

libraryRoutes.get('/', async (c) => {
  requireUser(c)
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) throw new ApiError(400, 'bad_request', 'workspaceId is required')
  await requireRole(c, workspaceId, 'viewer')
  const rows = await c.var.db.select().from(schema.libraries).where(eq(schema.libraries.workspaceId, workspaceId))
  return c.json({ libraries: rows })
})

libraryRoutes.post(
  '/',
  zValidator('json', z.object({ workspaceId: z.string().min(1), name: z.string().min(1).max(120), kind: z.string().max(40).default('general') })),
  async (c) => {
    const body = c.req.valid('json')
    await requireRole(c, body.workspaceId, 'editor')
    const [library] = await c.var.db
      .insert(schema.libraries)
      .values({ workspaceId: body.workspaceId, name: body.name, kind: body.kind })
      .returning()
    return c.json({ library }, 201)
  },
)
