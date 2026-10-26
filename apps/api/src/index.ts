import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authHandler, sessionMiddleware } from './auth'
import { dbMiddleware, type DbFactory } from './db'
import type { Db } from '@lumen/db'
import type { Env } from './env'
import { onError, onNotFound } from './errors'
import { libraryRoutes, workspaceRoutes } from './routes/workspaces'
import { presentationRoutes } from './routes/presentations'
import { syncRoutes } from './routes/sync'
import { mediaRoutes } from './routes/media'
import { liveRoutes } from './routes/live'
import type { AppEnv } from './types'

export interface AppOptions {
  db?: Db
  dbFactory?: DbFactory
  logger?: boolean
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>()

  if (options.logger !== false) app.use(logger())

  app.use('*', async (c, next) => {
    const origins = [c.env.WEB_ORIGIN, c.env.STUDIO_ORIGIN, 'tauri://localhost', 'http://tauri.localhost'].filter(
      (origin): origin is string => Boolean(origin),
    )
    return cors({ origin: origins, credentials: true })(c, next)
  })

  // Cookie-authenticated unsafe requests must come from a trusted origin. Bearer requests are
  // exempt: a third-party page cannot attach the Authorization header.
  app.use('*', async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next()
    if (c.req.header('Authorization')?.startsWith('Bearer ')) return next()
    const origin = c.req.header('Origin')
    const allowed = [c.env.WEB_ORIGIN, c.env.STUDIO_ORIGIN, 'tauri://localhost', 'http://tauri.localhost'].filter(Boolean)
    if (origin && !allowed.includes(origin)) return c.json({ error: { code: 'forbidden', message: 'Untrusted origin' } }, 403)
    return next()
  })

  app.onError(onError)
  app.notFound(onNotFound)

  app.get('/', (c) => c.json({ name: 'lumen-api', status: 'ok' }))
  app.get('/health', (c) => c.text('ok'))

  const protectedPaths = ['/auth/*', '/workspaces/*', '/libraries/*', '/presentations/*', '/sync/*', '/media/*', '/live/*']
  for (const path of protectedPaths) app.use(path, dbMiddleware(options.db, options.dbFactory))
  app.on(['GET', 'POST'], '/auth/*', authHandler)

  const sessionPaths = ['/workspaces/*', '/libraries/*', '/presentations/*', '/sync/*', '/media/*', '/live/*']
  for (const path of sessionPaths) app.use(path, sessionMiddleware)

  app.route('/workspaces', workspaceRoutes)
  app.route('/libraries', libraryRoutes)
  app.route('/presentations', presentationRoutes)
  app.route('/sync', syncRoutes)
  app.route('/media', mediaRoutes)
  app.route('/live', liveRoutes)

  return app
}

const app = createApp()

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>

export type AppType = ReturnType<typeof createApp>
