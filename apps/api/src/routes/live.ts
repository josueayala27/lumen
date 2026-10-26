import { schema } from '@lumen/db'
import { signToken } from '@lumen/auth-token'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireRole } from '../access'
import { ApiError } from '../errors'
import type { AppEnv } from '../types'

export const liveRoutes = new Hono<AppEnv>()

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function sessionCode(): string {
  let code = ''
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return code
}

liveRoutes.post('/sessions', zValidator('json', z.object({ workspaceId: z.string().min(1) })), async (c) => {
  const { workspaceId } = c.req.valid('json')
  const { userId } = await requireRole(c, workspaceId, 'operator')
  const code = sessionCode()
  const [session] = await c.var.db
    .insert(schema.liveSessions)
    .values({
      workspaceId,
      code,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    })
    .returning()
  if (!session) throw new ApiError(500, 'internal', 'Could not create live session')
  return c.json({ session: { id: session.id, code, expiresAt: session.expiresAt }, userId }, 201)
})

liveRoutes.post('/sessions/:code/token', async (c) => {
  const code = c.req.param('code').toUpperCase()
  const [session] = await c.var.db
    .select()
    .from(schema.liveSessions)
    .where(eq(schema.liveSessions.code, code))
    .limit(1)
  if (!session || session.expiresAt.getTime() < Date.now()) {
    throw new ApiError(404, 'not_found', 'Live session not found')
  }
  const { userId } = await requireRole(c, session.workspaceId, 'operator')
  const token = await signToken(
    { sub: userId, scope: 'live', workspaceId: session.workspaceId, sessionId: session.id },
    c.env.REALTIME_TOKEN_SECRET,
    300,
  )
  return c.json({ token, session: { id: session.id, code } })
})
