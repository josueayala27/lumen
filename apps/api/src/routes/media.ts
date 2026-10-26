import { schema } from '@lumen/db'
import { zValidator } from '@hono/zod-validator'
import { AwsClient } from 'aws4fetch'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { libraryWorkspace, requireRole } from '../access'
import { ApiError } from '../errors'
import type { AppEnv } from '../types'

export const mediaRoutes = new Hono<AppEnv>()

const uploadSchema = z.object({
  libraryId: z.string().min(1),
  name: z.string().min(1).max(240),
  mime: z.string().min(3).max(120),
  size: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(['image', 'video', 'audio']),
})

mediaRoutes.post('/upload-url', zValidator('json', uploadSchema), async (c) => {
  const body = c.req.valid('json')
  const workspaceId = await libraryWorkspace(c, body.libraryId)
  await requireRole(c, workspaceId, 'editor')

  const [existing] = await c.var.db
    .select()
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.sha256, body.sha256))
    .limit(1)
  if (existing) return c.json({ asset: existing, upload: null })

  const key = `${workspaceId}/asset/${body.sha256}`
  const env = c.env
  const canUpload = env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
  if (!canUpload) {
    return c.json({ asset: null, upload: null, reason: 'r2_not_configured' })
  }

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: 'auto',
  })
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`)
  const signed = await client.sign(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': body.mime },
    aws: { signQuery: true },
  })

  const [asset] = await c.var.db
    .insert(schema.mediaAssets)
    .values({
      libraryId: body.libraryId,
      kind: body.kind,
      name: body.name,
      sha256: body.sha256,
      mime: body.mime,
      size: body.size,
      r2Key: key,
    })
    .returning()

  return c.json({ asset, upload: { url: signed.url, method: 'PUT', headers: { 'Content-Type': body.mime }, key } }, 201)
})
